"use strict";

/**
 * OmpWeb native desktop app (Electron).
 *
 * Hosts the omp-web Next standalone server on an internal port and presents
 * it in a real native window: Dock icon, application menu, tray icon,
 * external links open in the system browser. Quitting the app stops the
 * server. The `ompweb` CLI (browser launch) and `ompweb-desktop` (hidden
 * server launcher) are untouched.
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// Internal port for the hosted server (dev 30178 / cli 30177 stay free).
const APP_PORT = Number(process.env.OMP_WEB_APP_PORT || 30179);
const HOST = "127.0.0.1";
const APP_URL = `http://${HOST}:${APP_PORT}`;

const pkgDir = path.join(__dirname, "..");

const APP_LOG_MAX_BYTES = 256 * 1024;

function appLog(message) {
  try {
    const logPath = path.join(app.getPath("userData"), "omp-app.log");
    // Rotate: a runaway server loop must never grow the log without bound.
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > APP_LOG_MAX_BYTES) {
      fs.writeFileSync(logPath, "");
    }
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
  } catch { /* best effort */ }
}

process.on("uncaughtException", (error) => {
  appLog("uncaught: " + (error instanceof Error ? error.stack || error.message : String(error)));
});
process.on("unhandledRejection", (reason) => {
  appLog("unhandledRejection: " + String(reason));
});

let mainWindow = null;
let tray = null;
let serverProcess = null;
let quitting = false;

/** Locate a real node binary so the hosted server never shows up as a
 *  second app instance in the Dock (spawning the Electron binary, even with
 *  ELECTRON_RUN_AS_NODE, makes macOS treat it as another OmpWeb). */
function resolveNodeBin() {
  const isWin = process.platform === "win32";
  const candidates = [
    process.env.OMP_WEB_NODE_BIN,
    // Windows: standard install dirs + nvm-windows
    ...(isWin ? [
      process.env.ProgramFiles ? `${process.env.ProgramFiles}/nodejs/node.exe` : null,
      process.env["ProgramFiles(x86)"] ? `${process.env["ProgramFiles(x86)"]}/nodejs/node.exe` : null,
      process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Programs/nodejs/node.exe` : null,
      process.env.APPDATA ? `${process.env.APPDATA}/nvm/current/node.exe` : null,
    ] : [
      "/usr/local/bin/node",
      "/opt/homebrew/bin/node",
      "/usr/bin/node",
      process.env.HOME ? `${process.env.HOME}/.bun/bin/node` : null,
      process.env.HOME ? `${process.env.HOME}/.nvm/current/bin/node` : null,
      process.env.HOME ? `${process.env.HOME}/.npm-global/bin/node` : null,
    ]),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate)) return candidate; } catch { /* keep looking */ }
  }
  return process.execPath;
}

/** Start the Next standalone server (self-contained server.js + node_modules). */
function startServer() {
  const standaloneDir = app.isPackaged
    ? path.join(process.resourcesPath, "standalone")
    : path.join(pkgDir, ".next", "standalone");
  const serverJs = path.join(standaloneDir, "server.js");
  if (!fs.existsSync(serverJs)) {
    appLog("standalone server.js missing at " + serverJs);
    console.error("Standalone build missing at", serverJs);
    return;
  }
  const nodeBin = resolveNodeBin();
  const nodeIsElectron = nodeBin === process.execPath;
  serverProcess = spawn(nodeBin, [serverJs], {
    cwd: standaloneDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      // Only needed when falling back to the Electron binary.
      ...(nodeIsElectron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      PORT: String(APP_PORT),
      HOSTNAME: HOST,
      OMP_WEB_PACKAGE_DIR: pkgDir,
    },
  });
  serverProcess.stderr?.on("data", (chunk) => {
    const text = chunk.toString();
    process.stderr.write(text);
    appLog("server: " + text.slice(0, 500));
  });
  serverProcess.on("error", (error) => {
    appLog("spawn error: " + (error instanceof Error ? error.message : String(error)));
    serverProcess = null;
    if (!quitting) app.quit();
  });
  serverProcess.on("exit", () => {
    serverProcess = null;
    if (!quitting) app.quit();
  });
}

function waitForServer(attempt = 0, loadWhenReady = true) {
  if (quitting) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  fetch(APP_URL, { signal: controller.signal })
    .then(() => {
      clearTimeout(timer);
      if (loadWhenReady && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(APP_URL);
      }
    })
    .catch(() => {
      clearTimeout(timer);
      // BUGFIX: loadWhenReady must stay a flag — the previous version passed
      // it as the setTimeout delay (false = immediate), retried with
      // loadWhenReady=700 (truthy), and loaded the app URL over the splash.
      if (attempt < 60) setTimeout(() => waitForServer(attempt + 1, loadWhenReady), 700);
    });
}

/** First-launch: the MAIN window plays the logo video full-screen, then
 *  fades into the app UI. Returns true when the launch animation runs. */
function isFirstLaunchSplash() {
  const pref = readSplashPref();
  if (pref === "off") return false;
  const markPath = path.join(app.getPath("userData"), "splash-shown");
  if (pref === "once" && fs.existsSync(markPath)) return false;
  const splashFile = path.join(pkgDir, "desktop", "splash.html");
  const splashVideo = app.isPackaged
    ? path.join(process.resourcesPath, "splash.mp4")
    : path.join(pkgDir, "templates", "desktop", "splash.mp4");
  if (!fs.existsSync(splashFile) || !fs.existsSync(splashVideo)) {
    try { fs.writeFileSync(markPath, "1"); } catch { /* best effort */ }
    return false;
  }
  try { fs.writeFileSync(markPath, "1"); } catch { /* best effort */ }
  // Mark immediately so a crash mid-animation still skips it next time.
  splashFile_ = splashFile;
  splashVideo_ = splashVideo;
  return true;
}

let splashFile_ = null;
let splashVideo_ = null;

function createWindow() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "..", "public", "icon.png"));
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 800,
    minHeight: 560,
    title: "OmpWeb",
    icon,
    autoHideMenuBar: false,
    backgroundColor: "#faf9f6",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.setIcon?.(icon);

  // Open external links (github, npm, ...) in the system browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(APP_URL)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  mainWindow.webContents.on("console-message", (_e, _lvl, message) => appLog("window console: " + String(message).slice(0, 200)));
  mainWindow.webContents.on("did-finish-load", () => appLog("window loaded: " + mainWindow.webContents.getURL()));
  // Cold-start race: the splash page navigates to APP_URL on its own timer,
  // but on slow machines (first run, Windows Defender scanning the freshly
  // installed standalone) the server may not be listening yet — the app then
  // sits on a blank page until a manual refresh. Retry the navigation a few
  // times until the server answers.
  let splashReloads = 0;
  mainWindow.webContents.on("did-fail-load", (_event, code, desc, url) => {
    appLog(`did-fail-load ${code} ${desc} ${url}`);
    if (!url.startsWith(APP_URL)) return;
    if (splashReloads >= 8) return;
    splashReloads += 1;
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (!quitting) mainWindow.loadURL(APP_URL);
    }, 1200);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    splashReloads = 0;
  });
}

function createTray() {
  // macOS: logo as a template image (auto black on light / white on dark).
  // Linux/Windows: template images are meaningless — use the color logo.
  const isMac = process.platform === "darwin";
  const iconPath = path.join(__dirname, "..", "public", isMac ? "trayTemplate.png" : "icon.png");
  const image = nativeImage.createFromPath(iconPath);
  if (isMac) image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip("OmpWeb");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开 OmpWeb", click: () => { if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); waitForServer(); } else { mainWindow.show(); mainWindow.focus(); } } },
    { type: "separator" },
    { label: "在浏览器中打开", click: () => shell.openExternal(APP_URL) },
    { type: "separator" },
    { label: "退出", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      waitForServer();
    } else if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createAppMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ label: app.name, submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ] }] : []),
    { label: "编辑", role: "editMenu" },
    { label: "视图", role: "viewMenu" },
    { label: "窗口", role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  });

  app.whenReady().then(() => {
    createAppMenu();
    startServer();
    const splashFirst = isFirstLaunchSplash();
    createWindow();
    createTray();
    if (splashFirst) {
      // Full-window launch animation: splash page plays the video, fades,
      // then navigates to APP_URL by itself.
      waitForServer(0, false);
      void mainWindow?.loadFile(splashFile_, { query: { video: splashVideo_, app: APP_URL } });
    } else {
      waitForServer();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      waitForServer();
    }
  });

  // A true desktop app: closing the window quits (tray stays for convenience,
  // but the hosted server must never outlive the app).
  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", () => {
    quitting = true;
  });

  app.on("will-quit", () => {
    if (serverProcess) {
      try { serverProcess.kill("SIGTERM"); } catch { /* already dead */ }
      serverProcess = null;
    }
  });
}

// Splash animation preference: "always" | "once" | "off" (default "once").
const SPLASH_PREF_PATH = () => path.join(app.getPath("userData"), "splash-pref.json");
function readSplashPref() {
  try {
    const raw = JSON.parse(fs.readFileSync(SPLASH_PREF_PATH(), "utf8"));
    if (raw && (raw.mode === "always" || raw.mode === "once" || raw.mode === "off")) return raw.mode;
  } catch { /* missing/corrupt -> default */ }
  return "once";
}
function writeSplashPref(mode) {
  try { fs.writeFileSync(SPLASH_PREF_PATH(), JSON.stringify({ mode })); } catch { /* best effort */ }
}

// Native folder picker (macOS / Windows / Linux all use Electron's dialog).
ipcMain.handle("select-directory", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});

// Splash animation preference (used by the Settings UI).
ipcMain.handle("get-splash-pref", () => readSplashPref());
ipcMain.handle("set-splash-pref", (_event, mode) => {
  if (mode === "always" || mode === "once" || mode === "off") writeSplashPref(mode);
  return readSplashPref();
});

// Renderer -> main helpers (window controls, open external).
ipcMain.on("window-control", (_event, action) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (action === "minimize") mainWindow.minimize();
  else if (action === "maximize") mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  else if (action === "close") mainWindow.close();
});

// ---------------------------------------------------------------------------
// Desktop self-update (electron-updater). Only active in packaged builds;
// dev runs use the plain CLI update flows. The renderer drives it from the
// System & Updates tab: check -> download (progress) -> apply (restart).
// ---------------------------------------------------------------------------
let autoUpdater = null;
if (app.isPackaged) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { autoUpdater: updater } = require("electron-updater");
    autoUpdater = updater;
    autoUpdater.autoDownload = false; // user confirms before downloading
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.autoRunAppAfterInstall = true;

    const broadcast = (status, detail) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("desktop-update-status", { status, ...(detail ?? {}) });
      }
    };
    autoUpdater.on("checking-for-update", () => broadcast("checking"));
    autoUpdater.on("update-available", (info) => broadcast("available", { version: info.version }));
    autoUpdater.on("update-not-available", () => broadcast("up-to-date"));
    autoUpdater.on("download-progress", (progress) => broadcast("downloading", { percent: Math.round(progress.percent ?? 0) }));
    autoUpdater.on("update-downloaded", (info) => broadcast("downloaded", { version: info.version }));
    autoUpdater.on("error", (error) => {
      appLog("updater: " + (error instanceof Error ? error.message : String(error)));
      broadcast("error", { message: error instanceof Error ? error.message : String(error) });
    });

    ipcMain.handle("desktop-update-check", () => {
      autoUpdater.checkForUpdates().catch((error) => appLog("updater check: " + error.message));
      return true;
    });
    ipcMain.handle("desktop-update-download", () => {
      autoUpdater.downloadUpdate().catch((error) => appLog("updater download: " + error.message));
      return true;
    });
    ipcMain.handle("desktop-update-apply", () => {
      // quitAndInstall restarts the app into the new version — the user sees
      // the app close and reopen with the update applied.
      autoUpdater.quitAndInstall(false, true);
      return true;
    });
  } catch (error) {
    appLog("updater init failed: " + (error instanceof Error ? error.message : String(error)));
  }
}

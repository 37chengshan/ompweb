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
// Listening on 0.0.0.0 is what makes phone/PC pairing work over the LAN;
// the pairing gate (proxy.ts) denies every remote /api request without a
// paired-device cookie, and token issuance is loopback-only, so exposing
// the port is safe.
const HOST = "0.0.0.0";
const APP_URL = `http://127.0.0.1:${APP_PORT}`;

const pkgDir = path.join(__dirname, "..");

const APP_LOG_MAX_BYTES = 256 * 1024;

// Lightweight startup page shown while the standalone server cold-starts
// (no splash animation runs). Inline data URL: zero files, zero network.
const STARTUP_PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; }
  body { background: #faf9f6; color: #2b2b2b; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; font-family: -apple-system, "Segoe UI", system-ui, sans-serif; }
  .logo { font-size: 26px; font-weight: 700; letter-spacing: 0.5px; }
  .logo span { color: #c98a1b; }
  .bar { width: 180px; height: 3px; border-radius: 2px; background: #e8e4dc; overflow: hidden; }
  .bar i { display: block; height: 100%; width: 40%; background: #c98a1b; border-radius: 2px; animation: slide 1.1s ease-in-out infinite; }
  @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(450%); } }
  .hint { font-size: 12px; color: #8a867e; }
</style>
</head>
<body>
  <div class="logo">Omp<span>Web</span></div>
  <div class="bar"><i></i></div>
  <div class="hint">正在启动…</div>
</body>
</html>`)}`;

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

/** Terminate the spawned server and its whole child tree, and WAIT until it
 *  is really gone. kill() alone terminates only the node process and returns
 *  immediately — its orphaned children (and, on Windows, the terminating
 *  process's file handles) can outlive it and lock files the updater must
 *  replace, which makes the NSIS installer ask the user to close the app by
 *  hand. */
function stopServerTree() {
  if (!serverProcess) return Promise.resolve();
  const child = serverProcess;
  serverProcess = null;
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    child.once("exit", done);
    if (process.platform === "win32") {
      try {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      } catch {
        try { child.kill("SIGKILL"); } catch { /* already dead */ }
      }
    } else {
      try { child.kill("SIGTERM"); } catch { /* already dead */ }
    }
    // Safety net: never hang the quit/install flow on a stuck child.
    setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* already dead */ } done(); }, 3000);
  });
}

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
async function startServer() {
  const standaloneDir = app.isPackaged
    ? path.join(process.resourcesPath, "standalone")
    : path.join(pkgDir, ".next", "standalone");
  const serverJs = path.join(standaloneDir, "server.js");
  if (!fs.existsSync(serverJs)) {
    appLog("standalone server.js missing at " + serverJs);
    console.error("Standalone build missing at", serverJs);
    return;
  }
  // Port pre-check: a stale zombie process on APP_PORT used to make the app
  // exit silently (EADDRINUSE), looking like a crash on launch.
  if (!(await isPortFree())) {
    dialog.showErrorBox(
      "端口被占用",
      `OmpWeb 需要的内部端口 ${APP_PORT} 已被其他程序占用。\n\n请关闭占用该端口的程序后重新启动 OmpWeb。`,
    );
    app.quit();
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
  serverProcess.on("exit", (code, signal) => {
    serverProcess = null;
    if (quitting) return;
    if (code !== 0) {
      dialog.showErrorBox(
        "服务启动失败",
        `内部服务器异常退出 (code=${code}, signal=${signal ?? "none"})。\n\n请查看应用日志后重试。`,
      );
    }
    app.quit();
  });
}

/** True when nothing listens on 127.0.0.1:APP_PORT yet. */
function isPortFree() {
  const net = require("net");
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (free) => { socket.destroy(); resolve(free); };
    socket.setTimeout(800);
    socket.once("connect", () => done(false));
    socket.once("timeout", () => done(true));
    socket.once("error", () => done(true));
    socket.connect(APP_PORT, "127.0.0.1");
  });
}

function waitForServer(attempt = 0, loadWhenReady = true) {
  if (quitting) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  fetch(APP_URL, { signal: controller.signal })
    .then(() => {
      clearTimeout(timer);
      // The splash page waits for this signal before navigating (so the
      // transition never lands on a cold server); the non-splash startup
      // page ignores it.
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send("server-ready");
      }
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
  // Version-scoped mark: the animation plays once per installed version, so
  // an in-place upgrade (which keeps userData, including the old splash-shown
  // file) shows it again instead of skipping silently forever.
  const markPath = path.join(app.getPath("userData"), `splash-shown-${app.getVersion()}`);
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
  // Exponential backoff (1.2s, 2.4s, ... up to ~10 attempts ≈ 30s) instead of
  // a fixed 1.2s x 8: first-run cold starts (Windows Defender scanning the
  // freshly installed standalone) can take longer than 9.6s and previously
  // exhausted the retries into a permanent blank window.
  let splashReloads = 0;
  mainWindow.webContents.on("did-fail-load", (_event, code, desc, url) => {
    appLog(`did-fail-load ${code} ${desc} ${url}`);
    if (!url.startsWith(APP_URL)) return;
    if (splashReloads >= 10) return;
    const attempt = splashReloads;
    splashReloads += 1;
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (!quitting) mainWindow.loadURL(APP_URL);
    }, Math.min(1200 * Math.pow(2, attempt), 30000));
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

  app.whenReady().then(async () => {
    createAppMenu();
    await startServer();
    if (quitting) return;
    const splashFirst = isFirstLaunchSplash();
    createWindow();
    createTray();
    if (splashFirst) {
      // Full-window launch animation: splash page plays the video, fades,
      // then navigates to APP_URL by itself.
      waitForServer(0, false);
      void mainWindow?.loadFile(splashFile_, { query: { video: splashVideo_, app: APP_URL } });
    } else {
      // No animation: show the startup page immediately so the window is
      // never blank while the standalone server cold-starts, then load the
      // app once it answers.
      void mainWindow?.loadURL(STARTUP_PAGE);
      waitForServer();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      void mainWindow?.loadURL(STARTUP_PAGE);
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
    // Fire-and-forget: normal quits do not race an installer (updates never
    // auto-install on quit), but the server tree should still not outlive
    // the app as orphans.
    void stopServerTree();
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
    // Auto-check shortly after launch (quietly — only "available" and
    // "downloaded" reach the renderer, so the user is prompted when an
    // update exists instead of having to open Settings).
    const autoCheckTimer = setTimeout(() => {
      autoUpdater.checkForUpdates().catch((error) => appLog("updater auto-check: " + error.message));
    }, 8000);
    autoUpdater.on("checking-for-update", () => clearTimeout(autoCheckTimer));
    ipcMain.handle("desktop-update-download", () => {
      autoUpdater.downloadUpdate().catch((error) => appLog("updater download: " + error.message));
      return true;
    });
    ipcMain.handle("desktop-update-apply", async () => {
      // quitAndInstall restarts the app into the new version — the user sees
      // the app close and reopen with the update applied.
      // The spawned server child must be fully dead FIRST: on Windows the
      // NSIS installer prompts "cannot close the application, close it
      // manually" when the server still holds file handles inside the
      // install directory, because kill() terminates only node.exe itself
      // and quitAndInstall races its shutdown.
      await stopServerTree();
      autoUpdater.quitAndInstall(false, true);
      return true;
    });
  } catch (error) {
    appLog("updater init failed: " + (error instanceof Error ? error.message : String(error)));
  }
}

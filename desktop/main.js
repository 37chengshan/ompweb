"use strict";

/**
 * OmpWeb native desktop app (Electron).
 *
 * Spawns the omp-web Next server (production build) on an internal port and
 * hosts it in a real native window: Dock icon, application menu, tray icon,
 * external links open in the system browser. Quitting the app stops the
 * server. The `ompweb` CLI (browser launch) and `ompweb-desktop` (hidden
 * server launcher) are untouched.
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// Internal port for the hosted server (dev 30178 / cli 30177 stay free).
const APP_PORT = Number(process.env.OMP_WEB_APP_PORT || 30179);
const HOST = "127.0.0.1";
const APP_URL = `http://${HOST}:${APP_PORT}`;

const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");

let mainWindow = null;
let tray = null;
let serverProcess = null;
let quitting = false;

function nextBin() {
  try {
    return require.resolve("next/dist/bin/next", { paths: [pkgDir] });
  } catch {
    return null;
  }
}

/** Start the Next production server; resolves when it accepts connections. */
function startServer() {
  if (!fs.existsSync(nextDir) || !fs.existsSync(path.join(nextDir, "BUILD_ID"))) {
    console.error("Build artifacts not found. Run `npm run build` first (or `npm run dev` and use the browser).");
    return;
  }
  const bin = nextBin();
  if (!bin) {
    console.error("Could not resolve next.");
    return;
  }
  serverProcess = spawn(process.execPath, [bin, "start", "-p", String(APP_PORT), "-H", HOST], {
    cwd: pkgDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      OMP_WEB_PACKAGE_DIR: pkgDir,
      OMP_WEB_LAUNCHER_PID: String(process.pid),
      OMP_WEB_PORT: String(APP_PORT),
      OMP_WEB_HOSTNAME: HOST,
    },
  });
  serverProcess.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  serverProcess.on("exit", () => {
    serverProcess = null;
    if (!quitting) app.quit();
  });
}

function waitForServer(attempt = 0) {
  if (quitting) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  fetch(APP_URL, { signal: controller.signal })
    .then(() => {
      clearTimeout(timer);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(APP_URL);
      }
    })
    .catch(() => {
      clearTimeout(timer);
      if (attempt < 60) setTimeout(() => waitForServer(attempt + 1), 700);
    });
}

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

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, "..", "public", "icon.png");
  let image = nativeImage.createFromPath(iconPath);
  image = image.resize({ width: 18, height: 18 });
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
    createWindow();
    createTray();
    waitForServer();
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

// Renderer -> main helpers (window controls, open external).
ipcMain.on("window-control", (_event, action) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (action === "minimize") mainWindow.minimize();
  else if (action === "maximize") mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  else if (action === "close") mainWindow.close();
});

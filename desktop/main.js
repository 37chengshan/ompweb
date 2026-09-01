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
const { StartupTracker, createHealthProbe } = require("./startup");

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

/**
 * Dedicated failure page (doc 14 T1.4): error text, log location, retry and
 * quit. Retry re-runs the server; on success the page's server-ready
 * listener navigates to the app itself.
 */
function startupErrorPage(reason, detail) {
  const message = detail || reason || "内部服务未能就绪";
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
  html, body { margin: 0; height: 100%; }
  body { background: #1b1916; color: #EBE6DC; display: flex; align-items: center; justify-content: center; font-family: -apple-system, "Segoe UI", system-ui, sans-serif; }
  .card { max-width: 440px; padding: 28px; background: #241f1c; border: 1px solid #3a342e; border-radius: 12px; }
  h1 { font-size: 17px; margin: 0 0 10px; }
  p { font-size: 13px; color: #A39B8E; line-height: 1.6; margin: 6px 0; word-break: break-word; }
  code { font-size: 11px; color: #c98a1b; word-break: break-all; }
  .row { display: flex; gap: 10px; margin-top: 16px; }
  button { flex: 1; padding: 9px 0; border-radius: 8px; border: 1px solid #3a342e; background: #2c2622; color: #EBE6DC; cursor: pointer; font-size: 13px; }
  button.primary { background: #c98a1b; border-color: #c98a1b; color: #1b1916; font-weight: 600; }
</style></head><body><div class="card">
  <h1>OmpWeb 启动失败</h1>
  <p>${message}</p>
  <p>日志位置：<code>${appLogPath()}</code></p>
  <div class="row">
    <button id="retry" class="primary">重试</button>
    <button id="quit">退出</button>
  </div>
</div>
<script>
  const bridge = window.ompWebDesktop;
  document.getElementById("retry").onclick = () => {
    const btn = document.getElementById("retry");
    btn.disabled = true; btn.textContent = "正在重试…";
    bridge.retryStartup().then((r) => {
      if (r && r.ok) return;
      btn.disabled = false; btn.textContent = "重试";
    }).catch(() => { btn.disabled = false; btn.textContent = "重试"; });
  };
  document.getElementById("quit").onclick = () => { if (bridge) bridge.close(); else window.close(); };
  if (bridge && bridge.onServerReady) bridge.onServerReady(() => { location.href = ${JSON.stringify(APP_URL)}; });
</script></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

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

// The hosted Next process is deliberately a singleton. Every Electron window
// (and the browser URL opened from the tray) talks to this same port, so a
// terminal/RPC session created in one window stays available in the others.
let mainWindow = null;
let tray = null;
let serverProcess = null;
let quitting = false;
let serverReady = false;
// Startup state machine (doc 14 T1.3): spawning → listening →
// assets_warmed → shell_mounted → session_interactive, with terminal
// failed. Every transition is stamped into omp-app.log; the report is
// queryable by the renderer for the diagnostics surface.
const startup = new StartupTracker({ log: appLog });
let serverRetries = 0;

/** Absolute path of the rotating app log, shown on failure pages (T1.4). */
function appLogPath() {
  return path.join(app.getPath("userData"), "omp-app.log");
}

/**
 * Terminal failure handling (doc 14 T1.4): stamp the state machine, then
 * surface an actionable error — in-page panel for the splash (which listens
 * for server-error), a full error page for the plain startup page, or a
 * dialog when no window is available. Never a silent hang.
 */
function failStartup(reason, detail, meta) {
  serverReady = false;
  startup.fail(reason, { detail, ...(meta || {}) });
  appLog(`startup failed: ${reason} ${detail || ""}`);
  const payload = { reason, detail, logPath: appLogPath() };
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    const currentUrl = mainWindow.webContents.getURL();
    if (currentUrl.includes("splash.html") || currentUrl.startsWith("data:text/html;charset=utf-8,%3C!doctype")) {
      // Splash page: show the in-page error panel (it listens for
      // server-error). The plain startup page also falls here via its data:
      // URL — navigate it to the dedicated error page instead.
      if (currentUrl.startsWith("data:text/html")) {
        void mainWindow.loadURL(startupErrorPage(reason, detail));
      } else {
        mainWindow.webContents.send("server-error", payload);
      }
    } else {
      // Residual page (failed APP_URL navigation, blank webContents, ...):
      // no listener is guaranteed — navigate the dedicated error page so the
      // failure is never silent (T1.4).
      void mainWindow.loadURL(startupErrorPage(reason, detail));
    }
  } else {
    dialog.showErrorBox("OmpWeb 启动失败", `${detail || reason}\n\n日志：${appLogPath()}`);
  }
}

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

function resolveOmpBin() {
  const candidates = [
    process.env.OMP_WEB_OMP_BIN,
    process.env.HOME ? `${process.env.HOME}/.bun/bin/omp` : null,
    process.env.HOME ? `${process.env.HOME}/.local/bin/omp` : null,
    "/opt/homebrew/bin/omp",
    "/usr/local/bin/omp",
    "/usr/bin/omp",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/** Start the Next standalone server (self-contained server.js + node_modules). */
async function startServer() {
  serverReady = false;
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
  const ompBin = resolveOmpBin();
  const runtimePath = [
    process.env.PATH,
    process.env.HOME ? `${process.env.HOME}/.bun/bin` : null,
    process.env.HOME ? `${process.env.HOME}/.local/bin` : null,
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ].filter(Boolean).join(path.delimiter);
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
      PATH: runtimePath,
      ...(ompBin ? { OMP_WEB_OMP_BIN: ompBin } : {}),
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
    if (code !== 0 && !serverReady) {
      // Startup-phase crash: surface the actionable failure page (T1.4)
      // instead of an uncontextual dialog; retry re-runs startServer.
      failStartup("server-exit", `内部服务器异常退出 (code=${code}, signal=${signal ?? "none"})`, { code, signal });
      return;
    }
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

function waitForServer(loadWhenReady = true) {
  if (quitting) return;
  const probe = createHealthProbe({
    appUrl: APP_URL,
    expectedAppVersion: app.getVersion(),
    fetchFn: fetch,
    maxAttempts: 60,
    backoffMs: 700,
  });
  void probe.wait({ onAttempt: (r) => { if (!r.ready) appLog(`probe attempt=${r.attempt} not-ready reason=${r.reason}${r.error ? " err=" + r.error : ""}`); } }).then((result) => {
    if (quitting) return;
    if (!result.ready) {
      // T1.7: readiness requires the dedicated /api/health endpoint to
      // answer ok with the current app version — 404/500/version mismatch
      // are all failures. Attempts exhausted → terminal failure page.
      failStartup("server-timeout", `${result.reason}${result.got ? " got=" + result.got : ""}`, { attempts: result.attempt });
      return;
    }
    startup.record("listening", { attempts: result.attempt, elapsedMs: result.elapsedMs, ompReady: result.ompReady });
    serverReady = true;
    // The splash page waits for this signal before navigating (so the
    // transition never lands on a cold server); the non-splash startup
    // page ignores it.
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("server-ready");
    }
    if (loadWhenReady && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(APP_URL);
    }
  });
}

ipcMain.handle("desktop-server-ready-state", () => serverReady);
// Startup retry (T1.4): re-run the server after a failure page/splash error
// panel. Max 3 user retries, then the app quits (no silent hang).
ipcMain.handle("startup-retry", async () => {
  if (quitting) return { ok: false, reason: "quitting" };
  if (serverReady && serverProcess) return { ok: true, alreadyReady: true };
  if (serverRetries >= 3) { app.quit(); return { ok: false, reason: "retries-exhausted" }; }
  serverRetries += 1;
  startup.record("spawning", { retry: serverRetries });
  serverReady = false;
  await startServer();
  if (!serverProcess) {
    failStartup("spawn-failed", "standalone server did not start");
    return { ok: false, reason: "spawn-failed" };
  }
  // The splash/error page listens for server-ready and navigates itself.
  waitForServer(false);
  return { ok: true };
});
// Renderer-reported stages (Web UI / splash): shell_mounted,
// session_interactive, assets_warmed.
ipcMain.on("startup-stage", (_event, stage) => {
  try {
    startup.record(stage);
  } catch (error) {
    appLog("startup-stage rejected: " + String(stage) + " " + (error instanceof Error ? error.message : String(error)));
  }
});
ipcMain.handle("get-startup-report", () => startup.report());

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

function appUrlForSession(sessionId) {
  if (!sessionId) return APP_URL;
  const url = new URL(APP_URL);
  url.searchParams.set("session", sessionId);
  return url.toString();
}

function firstLiveWindow() {
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null;
}

/**
 * Create a renderer window without starting another web server. `primary`
 * identifies the startup/tray window only; secondary session windows use the
 * same APP_URL and therefore the same in-memory RPC and terminal registries.
 */
function createWindow({ primary = true, sessionId = null } = {}) {
  const icon = nativeImage.createFromPath(path.join(__dirname, "..", "public", "icon.png"));
  const window = new BrowserWindow({
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

  if (primary) mainWindow = window;
  window.setIcon?.(icon);

  // Open external links (github, npm, ...) in the system browser, never in-app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(APP_URL)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  window.webContents.on("console-message", (_e, _lvl, message) => appLog("window console: " + String(message).slice(0, 200)));
  window.webContents.on("did-finish-load", () => appLog("window loaded: " + window.webContents.getURL()));
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
  window.webContents.on("did-fail-load", (_event, code, desc, url) => {
    appLog(`did-fail-load ${code} ${desc} ${url}`);
    if (!url.startsWith(APP_URL)) return;
    if (splashReloads >= 10) {
      // Retry budget exhausted: surface the failure page instead of leaving
      // a blank window (T1.4). The page's retry button restarts the server.
      failStartup("did-fail-load", `页面加载失败 (${code} ${desc})`, { url });
      return;
    }
    const attempt = splashReloads;
    splashReloads += 1;
    setTimeout(() => {
      if (window.isDestroyed()) return;
      if (!quitting) void window.loadURL(appUrlForSession(sessionId));
    }, Math.min(1200 * Math.pow(2, attempt), 30000));
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
    splashReloads = 0;
  });
  return window;
}

/** Open a session in a second native window on the already-running server. */
ipcMain.handle("open-session-window", (event, rawSessionId) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow || senderWindow.isDestroyed() || !event.sender.getURL().startsWith(APP_URL)) {
    return { ok: false, reason: "untrusted-renderer" };
  }
  const sessionId = typeof rawSessionId === "string" ? rawSessionId.trim() : "";
  if (!sessionId || sessionId.length > 160 || !/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    return { ok: false, reason: "invalid-session" };
  }
  if (!serverReady) return { ok: false, reason: "server-not-ready" };

  const window = createWindow({ primary: false, sessionId });
  appLog(`opened session window id=${sessionId} window=${window.id}`);
  void window.loadURL(appUrlForSession(sessionId));
  return { ok: true, windowId: window.id };
});

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
    { label: "打开 OmpWeb", click: () => { const window = firstLiveWindow(); if (!window) { createWindow(); waitForServer(); } else { window.show(); window.focus(); } } },
    { type: "separator" },
    { label: "在浏览器中打开", click: () => shell.openExternal(APP_URL) },
    { type: "separator" },
    { label: "退出", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("click", () => {
    const window = firstLiveWindow();
    if (!window) {
      createWindow();
      waitForServer();
    } else if (window.isVisible()) {
      window.hide();
    } else {
      window.show();
      window.focus();
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
    { label: "窗口", submenu: [
      { label: "新建会话窗口", accelerator: "CmdOrCtrl+Shift+N", click: () => {
        if (!serverReady) {
          const currentWindow = firstLiveWindow();
          if (currentWindow) currentWindow.focus();
          return;
        }
        const window = createWindow({ primary: false });
        void window.loadURL(APP_URL);
      } },
      { type: "separator" },
      { role: "minimize" },
      { role: "zoom" },
      ...(isMac ? [{ type: "separator" }, { role: "front" }] : []),
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = firstLiveWindow();
    if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
  });

  app.whenReady().then(async () => {
    createAppMenu();
    const splashFirst = isFirstLaunchSplash();
    // Show the window BEFORE awaiting the server (T1.9): createWindow and the
    // startup page/splash render immediately; the standalone server cold-
    // starts in the background and the health probe gates navigation. This
    // keeps window appearance independent of isPortFree/spawn latency.
    createWindow();
    createTray();
    if (splashFirst) {
      // Full-window launch animation: splash page plays the video, fades,
      // then navigates to APP_URL by itself.
      waitForServer(false);
      void mainWindow?.loadFile(splashFile_, { query: { video: splashVideo_, app: APP_URL } });
    } else {
      // No animation: show the startup page immediately so the window is
      // never blank while the standalone server cold-starts, then load the
      // app once it answers.
      void mainWindow?.loadURL(STARTUP_PAGE);
      waitForServer();
    }
    await startServer();
    if (quitting) return;
    if (!serverProcess) {
      failStartup("spawn-failed", "standalone server did not start");
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

// Windows first-run preference: NSIS creates the requested Desktop/Start Menu
// shortcuts; this lets the in-app setup flow optionally register launch at
// sign-in without exposing arbitrary shell execution to the renderer.
ipcMain.handle("get-auto-launch", () => {
  if (process.platform !== "win32") return { supported: false, enabled: false };
  return { supported: true, enabled: app.getLoginItemSettings().openAtLogin };
});
ipcMain.handle("set-auto-launch", (_event, enabled) => {
  if (process.platform !== "win32") return { supported: false, enabled: false };
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), openAsHidden: false });
  return { supported: true, enabled: app.getLoginItemSettings().openAtLogin };
});

// Splash animation preference (used by the Settings UI).
ipcMain.handle("get-splash-pref", () => readSplashPref());
ipcMain.handle("set-splash-pref", (_event, mode) => {
  if (mode === "always" || mode === "once" || mode === "off") writeSplashPref(mode);
  return readSplashPref();
});

// Renderer -> main helpers (window controls, open external).
ipcMain.on("window-control", (event, action) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window.isDestroyed()) return;
  if (action === "minimize") window.minimize();
  else if (action === "maximize") window.isMaximized() ? window.unmaximize() : window.maximize();
  else if (action === "close") window.close();
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

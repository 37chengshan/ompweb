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
const { pathToFileURL } = require("url");
const { StartupTracker, createHealthProbe } = require("./startup");
const { isLoopbackHost } = require("../bin/network-addresses");

// Internal port for the hosted server (dev 30178 / cli 30177 stay free).
const APP_PORT = Number(process.env.OMP_WEB_APP_PORT || 30179);
// The desktop shell is private by default. A Next middleware cannot obtain a
// trustworthy raw peer address on every runtime, so it must never be the only
// boundary protecting an unauthenticated wildcard listener. Advanced users
// may deliberately opt into a LAN bind, but that mode requires the normal web
// password gate as a second, independently-enforced boundary.
const HOST = process.env.OMP_WEB_APP_HOST || "127.0.0.1";
const APP_URL = `http://127.0.0.1:${APP_PORT}`;

const pkgDir = path.join(__dirname, "..");

const APP_LOG_MAX_BYTES = 256 * 1024;

// Lightweight startup page shown while the standalone server cold-starts when
// the user has disabled the optional logo animation.
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
let serverStartPromise = null;
let quitting = false;
let serverReady = false;

// --- Close-to-tray preference (remembered across launches) ---
// mode: "quit" (window X fully quits, killing the hosted server tree) or
// "tray" (window hides; OmpWeb keeps running in the system tray). The choice
// is stored in close-pref.json under userData. First close asks the user;
// the tray menu also exposes an explicit "Quit OmpWeb" that always kills the
// whole tree regardless of the remembered mode.
function closePrefPath() {
  return path.join(app.getPath("userData"), "close-pref.json");
}
function readClosePref() {
  try {
    const raw = JSON.parse(fs.readFileSync(closePrefPath(), "utf8"));
    if (raw && (raw.mode === "quit" || raw.mode === "tray")) return raw.mode;
  } catch { /* missing/corrupt */ }
  return null;
}
function writeClosePref(mode) {
  try { fs.writeFileSync(closePrefPath(), JSON.stringify({ mode }), "utf8"); } catch { /* best effort */ }
}

/** Ask the user what closing the window should do (async). */
function askCloseBehavior(win, callback) {
  const remembered = readClosePref();
  if (remembered) { callback(remembered); return; }
  const buttons = ["退出", "保留托盘"];
  const detail = "退出：完全退出 OmpWeb（含后台服务）。\n保留托盘：继续在系统托盘运行，可随时从托盘重新打开或退出。";
  dialog.showMessageBox(win, {
    type: "question",
    title: "关闭 OmpWeb 窗口后",
    message: "关闭窗口后希望 OmpWeb 如何运行？",
    detail,
    buttons,
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  }).then(({ response }) => {
    const choice = response === 1 ? "tray" : "quit";
    writeClosePref(choice);
    callback(choice);
  }).catch(() => callback("quit"));
}

/**
 * Primary-window close interception: apply the remembered close behavior, or
 * ask on first close. "quit" lets the window close (window-all-closed then
 * quits the app and stops the server tree); "tray" hides instead of closing.
 */
function applyCloseBehavior(win, event) {
  if (quitting) return; // real quit already in progress
  const pref = readClosePref();
  if (pref === "tray") {
    event.preventDefault();
    win.hide();
    return;
  }
  if (pref === "quit") return; // allow close -> window-all-closed -> app.quit()
  // No remembered choice yet: ask before closing.
  event.preventDefault();
  askCloseBehavior(win, (choice) => {
    if (choice === "tray") {
      if (!win.isDestroyed()) win.hide();
    } else {
      quitting = true;
      app.quit();
    }
  });
}
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
      setTimeout(done, 500);
    } else {
      // macOS/Linux: the server was spawned detached into its own process
      // group; killing the group (negative pid) takes the omp RPC children
      // with it.
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* not a group leader / already gone */ }
      try { child.kill("SIGTERM"); } catch { /* already dead */ }
      // Fast SIGKILL fallback: if child hasn't exited within 500ms, force SIGKILL
      // so the port is released before the app exits.
      setTimeout(() => {
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
        try { child.kill("SIGKILL"); } catch { /* already dead */ }
        done();
      }, 500);
    }
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
  // Multiple startup surfaces (splash, retry, tray restoration) can race on
  // a slow Windows machine. Reusing the live hosted server avoids duplicate
  // Node trees, page reloads, and the console flashes each tree would create.
  if (serverProcess && serverProcess.exitCode === null) return;
  if (serverStartPromise) return serverStartPromise;
  serverStartPromise = startServerImpl().finally(() => {
    serverStartPromise = null;
  });
  return serverStartPromise;
}

async function startServerImpl() {
  serverReady = false;
  if (!isLoopbackHost(HOST) && !process.env.OMP_WEB_PASSWORD) {
    failStartup(
      "unsafe-network-bind",
      "局域网访问需要同时设置 OMP_WEB_APP_HOST 与 OMP_WEB_PASSWORD；默认仅监听本机。",
    );
    return;
  }
  const standaloneDir = app.isPackaged
    ? path.join(process.resourcesPath, "standalone")
    : path.join(pkgDir, ".next", "standalone");
  const serverJs = path.join(standaloneDir, "server.js");
  if (!fs.existsSync(serverJs)) {
    appLog("standalone server.js missing at " + serverJs);
    console.error("Standalone build missing at", serverJs);
    return;
  }
  // Port pre-check: reclaim any stale zombie process on APP_PORT from a
  // previous abnormal termination instead of immediately dying with an error dialog.
  // A HEALTHY ompweb already answering on APP_PORT (another app instance, or a
  // CLI/desktop sibling sharing the port) is never killed — adopt it instead.
  if (!(await isPortFree())) {
    const healthy = await probeOmpWebHealth(APP_PORT);
    if (healthy) {
      appLog("startup: healthy ompweb already on " + APP_PORT + " — adopting existing instance");
      serverReady = true;
      startup.record("listening", { attempts: 1, adopted: true });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("server-ready");
        void mainWindow.loadURL(APP_URL);
      }
      return;
    }
    const reclaimed = await reclaimPortIfStale(APP_PORT);
    if (!reclaimed) {
      dialog.showErrorBox(
        "端口被占用",
        `OmpWeb 需要的内部端口 ${APP_PORT} 已被其他程序占用。\n\n请关闭占用该端口的程序后重新启动 OmpWeb。`,
      );
      app.quit();
      return;
    }
  }
  const nodeBin = resolveNodeBin();
  const nodeIsElectron = nodeBin === process.execPath;
  const ompBin = resolveOmpBin();
  // Route 3 (doc 16): packaged apps ship the Rust host at
  // <Resources>/bin/ompweb-host (electron-builder extraResources from
  // build-resources/host). Point the standalone server at it explicitly — the
  // server runs under a system node whose execPath cannot derive the bundle
  // layout. Dev runs omit the env var and resolve the workspace build.
  const packagedHostBin = app.isPackaged
    ? path.join(process.resourcesPath, "bin", process.platform === "win32" ? "ompweb-host.exe" : "ompweb-host")
    : null;
  const runtimePath = [
    process.env.PATH,
    process.env.HOME ? `${process.env.HOME}/.bun/bin` : null,
    process.env.HOME ? `${process.env.HOME}/.local/bin` : null,
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ].filter(Boolean).join(path.delimiter);
  // Route 3 (doc 16): packaged builds own host resolution deterministically —
  // always point at Resources/bin (missing file = fail-closed
  // RuntimeUnavailable with remediation) and NEVER inherit an ambient
  // OMPWEB_HOST_BIN from the launch environment.
  const spawnEnv = { ...process.env };
  if (packagedHostBin) spawnEnv.OMPWEB_HOST_BIN = packagedHostBin;
  else if (app.isPackaged) delete spawnEnv.OMPWEB_HOST_BIN;
  if (nodeIsElectron) spawnEnv.ELECTRON_RUN_AS_NODE = "1";
  spawnEnv.PORT = String(APP_PORT);
  spawnEnv.OMP_WEB_PORT = String(APP_PORT);
  spawnEnv.OMP_WEB_APP_PORT = String(APP_PORT);
  spawnEnv.HOSTNAME = HOST;
  spawnEnv.OMP_WEB_PACKAGE_DIR = pkgDir;
  spawnEnv.PATH = runtimePath;
  if (ompBin) spawnEnv.OMP_WEB_OMP_BIN = ompBin;
  // System Node cannot read app.asar. The build copies this preload beside
  // the external standalone server so both Node and Electron can require it.
  serverProcess = spawn(nodeBin, ["--require", path.join(standaloneDir, "bin", "request-peer-preload.js"), serverJs], {
    cwd: standaloneDir,
    // POSIX needs an isolated group for recursive shutdown. Windows uses
    // taskkill /T instead; detaching there creates a separate visible console
    // for the otherwise background Next service.
    detached: process.platform !== "win32",
    // The hosted server is an implementation detail of the GUI app, never a
    // user-facing terminal. This also applies on each restart after a crash.
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: spawnEnv,
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

/** True when something on 127.0.0.1:port answers /api/health ok (an ompweb). */
function probeOmpWebHealth(probePort) {
  return new Promise((resolve) => {
    const http = require("http");
    const req = http.get({ host: "127.0.0.1", port: probePort, path: "/api/health", timeout: 2000 }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; if (body.length > 500) req.destroy(); });
      res.on("end", () => {
        try { resolve(JSON.parse(body).ok === true); } catch { resolve(false); }
      });
      res.on("error", () => resolve(false));
    });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
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

/**
 * Only the installation's dedicated standalone server entrypoint is used
 * to identify a stale port owner. A shared executable path is insufficient.
 */
function getOmpProcessSignatures() {
  // Only the dedicated server entrypoint identifies a hosted server. The
  // Electron executable or installation directory can also belong to an
  // unrelated process and must never authorize termination.
  return [normalizeExePath(app.isPackaged
    ? path.join(process.resourcesPath, "standalone", "server.js")
    : path.join(pkgDir, ".next", "standalone", "server.js"))];
}

/** Normalize an executable path the same way as getOmpProcessSignatures(). */
function normalizeExePath(exePath) {
  return String(exePath).trim().toLowerCase().replace(/\\/g, "/");
}

/**
 * PIDs of the processes listening on `port` (no killing). POSIX: `lsof -ti
 * :port`. Windows: netstat -ano parsed strictly — LISTENING rows whose local
 * address ends in 127.0.0.1:{port}, 0.0.0.0:{port} or [::]:{port} — instead
 * of the old findstr text match, which could mis-hits rows for unrelated
 * ports (e.g. :{port} matching :1{port}00).
 */
function getPortOwnerPids(port) {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      const netstat = spawn("netstat", ["-ano"], { windowsHide: true });
      let out = "";
      netstat.stdout?.on("data", (d) => { out += d; });
      netstat.on("close", () => {
        const pids = new Set();
        for (const rawLine of out.split("\n")) {
          const line = rawLine.trim();
          if (!line.includes("LISTENING")) continue;
          const parts = line.split(/\s+/);
          const local = parts[1] || "";
          const pid = parts[parts.length - 1];
          if (!/^\d+$/.test(pid) || pid === "0") continue;
          if (
            local.endsWith(`127.0.0.1:${port}`) ||
            local.endsWith(`0.0.0.0:${port}`) ||
            local.endsWith(`[::]:${port}`)
          ) {
            pids.add(pid);
          }
        }
        resolve(Array.from(pids));
      });
      netstat.on("error", () => resolve([]));
    } else {
      const lsof = spawn("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
      let out = "";
      lsof.stdout?.on("data", (d) => { out += d; });
      lsof.on("close", () => {
        const pids = out.trim().split(/\s+/).filter((p) => /^\d+$/.test(p));
        resolve(pids);
      });
      lsof.on("error", () => resolve([]));
    }
  });
}

/**
 * Full command line of `pid` (POSIX: `ps -p <pid> -o command=`; Windows:
 * `wmic process where processid=<pid> get commandline`). The command line —
 * not the bare executable — is what carries the OmpWeb layout markers for
 * the node/Electron-run standalone server. The read runs in-process with a
 * timeout; a read/parse failure resolves null (conservative — never kill
 * what we cannot identify).
 */
function readProcessCommand(pid) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; resolve(result); } };
    const timer = setTimeout(() => { child?.kill(); done(null); }, 1500);
    let cmd = null;
    let args = [];
    if (process.platform === "win32") {
      cmd = "wmic";
      args = ["process", "where", `processid=${pid}`, "get", "commandline"];
    } else {
      cmd = "ps";
      // command= (not comm=) so we get the full executable path / argv0,
      // comparable against the layout signatures. On macOS comm= truncates
      // to a 16-char process name and loses the .app path.
      args = ["-p", String(pid), "-o", "command="];
    }
    let child = null;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch {
      clearTimeout(timer);
      done(null);
      return;
    }
    let out = "";
    child.stdout?.on("data", (d) => { out += d; });
    child.on("error", () => { clearTimeout(timer); done(null); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return done(null);
      const text = out.trim();
      if (!text) return done(null);
      done(normalizeExePath(text));
    });
  });
}

async function isOwnedOmpProcess(pid) {
  if (Number(pid) === process.pid) return false;
  const command = await readProcessCommand(pid);
  if (command == null) return false;
  const signatures = getOmpProcessSignatures();
  // Match a complete entrypoint argument, including quoted paths.
  return signatures.some((sig) => {
    const escaped = sig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[\\s"'])${escaped}(?=$|[\\s"'])`).test(command);
  });
}

async function reclaimPortIfStale(port) {
  if (await isPortFree()) return true;
  const ownerPids = await getPortOwnerPids(port);
  if (ownerPids.length === 0) return isPortFree();
  appLog(`Port ${port} is occupied by pid(s) ${ownerPids.join(", ")}, verifying ownership...`);
  const owned = [];
  for (const pidStr of ownerPids) {
    if (await isOwnedOmpProcess(pidStr)) owned.push(pidStr);
    else appLog(`port ${port}: pid ${pidStr} is not an OmpWeb process — leaving it alone`);
  }
  if (owned.length === 0) {
    // No occupant can be confirmed as OmpWeb (foreign service, or identity
    // unreadable): do NOT kill. The caller surfaces the "端口被占用" dialog.
    appLog(`port ${port}: no occupant is confirmed OmpWeb — not killing, reporting port conflict`);
    return false;
  }
  if (process.platform === "win32") {
    for (const pidStr of owned) {
      try { spawn("taskkill", ["/pid", pidStr, "/T", "/F"], { stdio: "ignore", windowsHide: true }).once("error", () => {}); } catch { /* best effort */ }
    }
  } else {
    for (const pidStr of owned) {
      const pid = Number(pidStr);
      try { process.kill(pid, "SIGTERM"); } catch { /* already dead */ }
    }
    // Original kill mechanism: SIGTERM first, then force SIGKILL after a
    // grace period so the port is released.
    setTimeout(() => {
      for (const pidStr of owned) {
        const pid = Number(pidStr);
        try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
      }
    }, 300);
  }
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await isPortFree()) {
      appLog(`Port ${port} successfully reclaimed from stale OmpWeb process.`);
      return true;
    }
  }
  return false;
}

/**
 * Windows proxy trap (FlClash/Clash etc. set a system proxy on 127.0.0.1:7890;
 * Electron's global fetch honors it and can proxy even loopback requests).
 * Startup probes to the app's own 127.0.0.1:APP_PORT server then burn 10-36s
 * of "正在启动…" before timing out. Pin the default session to bypass loopback
 * so startup probes and renderer fetches never traverse a proxy.
 */
function ensureLoopbackProxyBypass() {
  try {
    const { session } = require("electron");
    const ses = session.defaultSession;
    if (!ses || typeof ses.setProxy !== "function") return;
    const existing = process.env.OMP_WEB_PROXY_URL || "";
    const rules = existing ? existing : undefined;
    ses.setProxy({
      ...(rules ? { proxyRules: rules } : {}),
      proxyBypassRules: "127.0.0.1,localhost,<local>,::1",
    }).catch(() => {});
    appLog("proxy: loopback bypass installed for default session");
  } catch (error) {
    appLog("proxy: loopback bypass failed: " + (error instanceof Error ? error.message : String(error)));
  }
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
// Synchronous version lookup for the preload bridge (packaged builds have no
// npm_package_version env; app.getVersion() is always the real installed one).
ipcMain.on("desktop-app-version", (event) => {
  event.returnValue = app.getVersion();
});

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

function splashUrl() {
  const splashFile = splashFile_ || path.join(pkgDir, "desktop", "splash.html");
  const splashVideo = splashVideo_ || (app.isPackaged
    ? path.join(process.resourcesPath, "splash.mp4")
    : path.join(pkgDir, "templates", "desktop", "splash.mp4"));
  const url = new URL(pathToFileURL(splashFile).toString());
  url.searchParams.set("app", APP_URL);
  url.searchParams.set("video", pathToFileURL(splashVideo).toString());
  return url.toString();
}

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

  if (primary) {
    mainWindow = window;
    // Close-to-tray: remember the user's choice on first close. Secondary
    // session windows (primary=false) close freely — they are views onto the
    // same hosted server.
    window.on("close", (event) => {
      if (primary) applyCloseBehavior(window, event);
    });
  }
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
  let image = nativeImage.createFromPath(iconPath);
  if (isMac) {
    image = image.resize({ width: 18, height: 18 });
    image.setTemplateImage(true);
  }
  try { if (tray && !tray.isDestroyed()) tray.destroy(); } catch { /* first run */ }
  tray = new Tray(image);
  tray.setToolTip("OmpWeb");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开 OmpWeb", click: () => { const window = firstLiveWindow(); if (!window) { createWindow(); waitForServer(); } else { window.show(); window.focus(); } } },
    { type: "separator" },
    { label: "在浏览器中打开", click: () => shell.openExternal(APP_URL) },
    { type: "separator" },
    {
      label: readClosePref() === "quit" ? "关闭窗口时：退出" : "关闭窗口时：保留托盘",
      enabled: false,
    },
    {
      label: "切换关闭窗口行为…",
      click: () => {
        const remembered = readClosePref();
        const buttons = remembered === "tray" ? ["退出", "保留托盘"] : ["退出", "保留托盘"];
        dialog.showMessageBox({
          type: "question",
          title: "关闭窗口行为",
          message: "点击窗口关闭按钮(X)后希望 OmpWeb 如何运行？",
          detail: "退出：完全退出 OmpWeb（含后台服务）。\n保留托盘：最小化到系统托盘继续运行。",
          buttons,
          defaultId: remembered === "quit" ? 0 : 1,
          cancelId: remembered === "quit" ? 0 : 1,
          noLink: true,
        }).then(({ response }) => {
          const choice = response === 1 ? "tray" : "quit";
          writeClosePref(choice);
          // Rebuild the tray menu so the status line reflects the new choice.
          createTray();
        }).catch(() => {});
      },
    },
    { type: "separator" },
    // Explicit quit: always stops the hosted server tree (before-quit).
    { label: "退出 OmpWeb", click: () => { quitting = true; app.quit(); } },
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
    ensureLoopbackProxyBypass();
    createAppMenu();
    // Show the window BEFORE awaiting the server (T1.9): createWindow and the
    // startup page renders immediately; the standalone server cold-
    // starts in the background and the health probe gates navigation. This
    // keeps window appearance independent of isPortFree/spawn latency.
    const launchWithSplash = isFirstLaunchSplash();
    createWindow();
    createTray();
    void mainWindow?.loadURL(launchWithSplash ? splashUrl() : STARTUP_PAGE);
    // The splash owns the final transition after receiving server-ready.
    // Loading the app here as soon as the probe completes would skip the
    // animation (and race the splash's warm-up/error state).
    waitForServer(!launchWithSplash);
    await startServer();
    if (quitting) return;
    if (!serverProcess) {
      failStartup("spawn-failed", "standalone server did not start");
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const launchWithSplash = isFirstLaunchSplash();
      createWindow();
      void mainWindow?.loadURL(launchWithSplash ? splashUrl() : STARTUP_PAGE);
      waitForServer(!launchWithSplash);
    }
  });

  // Close-to-tray: window-all-closed keeps the app alive in the tray unless
  // the user chose "quit" (remembered in close-pref.json via the window X
  // flow, or explicitly via the tray "Quit OmpWeb" item which sets quitting).
  app.on("window-all-closed", () => {
    if (quitting) { app.quit(); return; }
    const pref = readClosePref();
    if (pref === "quit") {
      quitting = true;
      app.quit();
      return;
    }
    appLog("window-all-closed: keeping app alive in tray (close-pref=" + (pref || "tray") + ")");
  });

  let isStoppingServer = false;
  app.on("before-quit", (event) => {
    quitting = true;
    if (serverProcess && !isStoppingServer) {
      event.preventDefault();
      isStoppingServer = true;
      const child = serverProcess;
      stopServerTree().finally(() => {
        app.quit();
      });
      // Safety net: force exit if child takes longer than 1200ms.
      // Windows has no process groups (negative pid is invalid there), so
      // taskkill /T is the portable way to take the whole tree down.
      setTimeout(() => {
        if (child) {
          if (process.platform === "win32") {
            try {
              const { spawn: spawnKiller } = require("child_process");
              const killer = spawnKiller("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
              killer.unref();
            } catch { try { child.kill("SIGKILL"); } catch {} }
          } else {
            try { process.kill(-child.pid, "SIGKILL"); } catch {}
            try { child.kill("SIGKILL"); } catch {}
          }
        }
        app.exit(0);
      }, 1200);
    }
  });

  app.on("will-quit", () => {
    void stopServerTree();
  });

  process.on("SIGINT", () => {
    void stopServerTree().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void stopServerTree().finally(() => process.exit(0));
  });
  process.on("exit", () => {
    if (serverProcess) {
      const child = serverProcess;
      if (process.platform === "win32") {
        // Windows: taskkill /T terminates the whole tree. Negative pids do
        // not exist on win32 (process.kill(-pid) throws EINVAL).
        try {
          const { spawn: spawnKiller } = require("child_process");
          const killer = spawnKiller("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
          killer.unref();
        } catch { try { child.kill("SIGKILL"); } catch {} }
      } else {
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
        try { child.kill("SIGKILL"); } catch {}
      }
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
      // Every renderer window (multi-window mode) must see update status.
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send("desktop-update-status", { status, ...(detail ?? {}) });
      }
    };
    autoUpdater.on("checking-for-update", () => broadcast("checking"));
    autoUpdater.on("update-available", (info) => broadcast("available", { version: info.version }));
    autoUpdater.on("update-not-available", () => broadcast("up-to-date"));
    autoUpdater.on("download-progress", (progress) => broadcast("downloading", { percent: Math.round(progress.percent ?? 0) }));
    autoUpdater.on("update-downloaded", (info) => broadcast("downloaded", { version: info.version }));
    autoUpdater.on("error", (error) => {
      appLog("updater: " + (error instanceof Error ? error.message : String(error)));
      // Only user-initiated check errors reach the renderer; the launch-time
      // auto-check stays silent so it can never flash over a good state.
      if (userInitiatedCheckRef.current) {
        broadcast("error", { message: error instanceof Error ? error.message : String(error) });
      }
    });

    /** A packaged build without its generated app-update.yml has no update
     *  feed. Report it as up-to-date instead of error-flashing: a local/
     *  unsigned build must never look broken just because it cannot reach
     *  a release channel that does not exist. */
    function hasUpdateChannel() {
      return app.isPackaged && fs.existsSync(path.join(process.resourcesPath, "app-update.yml"));
    }
    // Resolve the same effective proxy the web server uses (~/.omp/agent/
    // proxy.json, then env, then common local proxy ports) and route the
    // updater's GitHub feed through it. Without this, a FlClash-style proxy
    // user's update dies with a closed-socket error because open-launched
    // apps do not inherit the shell's proxy env.
    let updaterProxyApplied = false;
    async function applyUpdaterProxy() {
      if (!autoUpdater || updaterProxyApplied) return;
      updaterProxyApplied = true;
      try {
        let proxyUrl = null;
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(require("os").homedir(), ".omp", "agent", "proxy.json"), "utf8"));
          if (raw && raw.mode === "off") return;
          if (raw && raw.mode === "manual" && typeof raw.url === "string") proxyUrl = raw.url;
        } catch {
          /* missing config -> auto-detect below */
        }
        if (!proxyUrl) {
          for (const key of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]) {
            if (process.env[key]) { proxyUrl = process.env[key]; break; }
          }
        }
        if (!proxyUrl) {
          const net = require("net");
          const probe = (port) => new Promise((resolve) => {
            const socket = new net.Socket();
            const done = (ok) => { socket.destroy(); resolve(ok); };
            socket.setTimeout(300);
            socket.once("connect", () => done(true));
            socket.once("timeout", () => done(false));
            socket.once("error", () => done(false));
            socket.connect(port, "127.0.0.1");
          });
          for (const port of [7890, 7897, 1087, 1080]) {
            if (await probe(port)) { proxyUrl = "http://127.0.0.1:" + port; break; }
          }
        }
        if (!proxyUrl) { appLog("updater: no proxy detected"); return; }
        const { session } = require("electron");
        const updaterSession = session.fromPartition("omp-updater-proxy");
        await updaterSession.setProxy({
          proxyRules: proxyUrl,
          proxyBypassRules: "127.0.0.1,localhost,<local>",
        });
        autoUpdater.netSession = updaterSession;
        // Also visible to any fetch inside the updater path.
        process.env.HTTPS_PROXY = proxyUrl;
        process.env.HTTP_PROXY = proxyUrl;
        appLog("updater: proxy " + proxyUrl);
      } catch (error) {
        appLog("updater proxy: " + (error instanceof Error ? error.message : String(error)));
      }
    }
    let updateCheckInFlight = null;
    const userInitiatedCheckRef = { current: false };
    function runUpdateCheck(userInitiated) {
      if (updateCheckInFlight) return updateCheckInFlight;
      if (!hasUpdateChannel()) {
        broadcast("up-to-date");
        return Promise.resolve({ status: "up-to-date" });
      }
      userInitiatedCheckRef.current = userInitiated;
      updateCheckInFlight = autoUpdater.checkForUpdates()
        .catch((error) => {
          appLog("updater check: " + (error instanceof Error ? error.message : String(error)));
          if (userInitiated) broadcast("error", { message: error instanceof Error ? error.message : String(error) });
        })
        .finally(() => { updateCheckInFlight = null; userInitiatedCheckRef.current = false; });
      return updateCheckInFlight;
    }

    ipcMain.handle("desktop-update-check", () => {
      void applyUpdaterProxy().then(() => runUpdateCheck(true));
      return true;
    });
    // Auto-check shortly after launch (quietly — only "available" and
    // "downloaded" reach the renderer, and failures stay silent).
    if (hasUpdateChannel()) {
      const autoCheckTimer = setTimeout(() => { void runUpdateCheck(false); }, 8000);
      autoUpdater.on("checking-for-update", () => clearTimeout(autoCheckTimer));
    }
    ipcMain.handle("desktop-update-download", async () => {
      try {
        await autoUpdater.downloadUpdate();
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appLog("updater download: " + message);
        // Surface download failures to the renderer so its fallback path
        // (manual GitHub download) can take over instead of hanging on
        // "downloading".
        broadcast("error", { message });
        return false;
      }
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

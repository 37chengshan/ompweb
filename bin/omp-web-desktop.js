#!/usr/bin/env node
"use strict";

/**
 * Desktop launcher for omp-web: starts the Next server with a hidden console
 * (Windows: windowsHide on the child; macOS: no Terminal banner, designed to
 * be launched from a double-clickable .command that hides its terminal) and
 * opens the browser. The plain `ompweb` CLI remains the primary entry point;
 * this is an additive convenience for app-style launches.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getUnsupportedNodeVersionMessage, isNodeVersionSupported } = require("./node-version");

if (!isNodeVersionSupported(process.versions.node)) {
  console.error(getUnsupportedNodeVersionMessage(process.versions.node));
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseLaunchOptions } = require("./omp-web-options");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isPortAvailable } = require("./port-availability");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { wireChildProcessLifecycle } = require("./process-lifecycle");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getBrowserUrl, isLoopbackHost } = require("./network-addresses");

const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");

let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  console.error("Could not resolve next. Is ompweb installed correctly?");
  process.exit(1);
}

const launchOptions = parseLaunchOptions();
if (launchOptions.help || launchOptions.version) {
  process.exit(0);
}
const port = launchOptions.port;
const hostname = launchOptions.hostname;
const password = launchOptions.password;
if (password) process.env.OMP_WEB_PASSWORD = password;
const passwordEnabled = typeof password === "string" && password.length > 0;

if (!fs.existsSync(nextDir)) {
  console.error("Build artifacts not found. Run `npm run build` once, or use `ompweb` for the dev flow.");
  process.exit(1);
}

if (!isLoopbackHost(hostname) && !passwordEnabled) {
  console.error(`Refusing to listen on ${hostname} without OMP_WEB_PASSWORD (or --password).`);
  process.exit(1);
}

const browserUrl = getBrowserUrl(hostname, port);

async function main() {
  if (!await isPortAvailable(port, hostname)) {
    // Already running: just surface it (a second desktop launch is a no-op).
    console.error(`Port ${port} already in use — opening ${browserUrl}.`);
    openBrowser();
    process.exit(0);
  }

  const nextArgs = ["start", "-p", port, "-H", hostname];
  // windowsHide keeps the console window off the screen on Windows; detached +
  // stdio ignore turns the launcher into a fire-and-forget app start on macOS.
  const child = spawn(process.execPath, [nextBin, ...nextArgs], {
    cwd: pkgDir,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: process.platform === "win32" ? "ignore" : ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      OMP_WEB_PACKAGE_DIR: pkgDir,
      OMP_WEB_LAUNCHER_PID: String(process.pid),
      OMP_WEB_PORT: port,
      OMP_WEB_HOSTNAME: hostname,
    },
  });
  wireChildProcessLifecycle(child);

  if (process.platform !== "win32") {
    // Keep the child's output out of the way; only relay fatal startup errors.
    child.stdout?.on("data", (chunk) => {
      if (chunk.toString().includes("Error")) process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  }

  let opened = false;
  child.stdout?.on("data", (chunk) => {
    if (!opened && chunk.toString().includes("Ready")) {
      opened = true;
      openBrowser();
    }
  });

  // Fallback: open the browser shortly after spawn even if the ready banner
  // is not detected (custom ports, log buffering).
  setTimeout(() => {
    if (!opened) {
      opened = true;
      openBrowser();
    }
  }, 4000);
}

function openBrowser() {
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const openCmd = isWindows ? "explorer.exe" : isMac ? "open" : "xdg-open";
  const opener = spawn(openCmd, [browserUrl], { stdio: "ignore", detached: true });
  opener.on("error", () => { /* best effort */ });
  opener.unref();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

#!/usr/bin/env node
"use strict";

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
const { getAccessibleAddresses, getBrowserUrl, formatAddressBanner, isLoopbackHost } = require("./network-addresses");

const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");

// Resolve next's CLI entry directly to avoid relying on .bin symlinks (which
// may not exist when installed via npx).
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  // Fallback: locate next package root and derive the bin path manually.
  try {
    const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
    nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
  } catch {
    nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
  }
}

let pkgVersion = "0.0.0";
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pkg = require("../package.json");
  pkgVersion = pkg.version ?? "0.0.0";
} catch { /* ignore */ }

const launchOptions = parseLaunchOptions();
if (launchOptions.help || launchOptions.version) {
  process.exit(0);
}
const port = launchOptions.port;
const hostname = launchOptions.hostname;
const password = launchOptions.password;
const openBrowser = launchOptions.openBrowser;
// Propagate --password into the env for proxy.ts / lib/web-auth.ts and the spawned Next process.
if (password) process.env.OMP_WEB_PASSWORD = password;
const passwordEnabled = typeof password === "string" && password.length > 0;
if (!fs.existsSync(nextDir)) {
  console.error("Build artifacts not found. Please report this issue.");
  process.exit(1);
}

if (!isLoopbackHost(hostname)) {
  if (!passwordEnabled) {
    console.error(`Refusing to listen on ${hostname} without OMP_WEB_PASSWORD (or --password). Set a strong password or bind to 127.0.0.1.`);
    process.exit(1);
  }
  console.warn(`Warning: ompweb is listening on ${hostname} over HTTP. Use HTTPS or a trusted VPN to protect the password and session cookie in transit.`);
}

const nextArgs = ["start", "-p", port];
nextArgs.push("-H", hostname);

// Always run next's JS entry with node directly — avoids .bin symlink issues
// and path-with-spaces problems on Windows when shell: true is used.
const browserUrl = getBrowserUrl(hostname, port);

/** Quick health probe: true when the port answers as a healthy ompweb. */
async function probeOmpWeb(probePort) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const http = require("http");
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: probePort, path: "/api/health", timeout: 1500 }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; if (body.length > 500) req.destroy(); });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed && parsed.ok === true);
        } catch { resolve(false); }
      });
      res.on("error", () => resolve(false));
    });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}

async function main() {
  // Cross-instance inheritance: if an ompweb instance is already running on
  // this machine (our own port, the desktop app's 30179, or another dev CLI
  // on 30177/30178), adopt it instead of starting a second server that would
  // compete for ~/.omp session locks and trigger session-split errors.
  const SIBLING_PORTS = [30177, 30178, 30179];
  const ownPortInUse = !await isPortAvailable(port, hostname);
  let adoptedUrl = null;
  if (ownPortInUse) {
    // Our exact port is taken: probe it — if it answers as ompweb, adopt.
    if (await probeOmpWeb(port)) {
      adoptedUrl = getBrowserUrl(hostname, port);
    }
  } else {
    // Our port is free but a sibling (desktop app on 30179, dev on 30178,
    // other CLI on 30177) may already be running. Adopt the first healthy one
    // so "ompweb" while the desktop app is open just focuses the app.
    for (const sibling of SIBLING_PORTS) {
      if (sibling === port) continue;
      if (await probeOmpWeb(sibling)) { adoptedUrl = getBrowserUrl("127.0.0.1", sibling); break; }
    }
  }
  if (adoptedUrl) {
    console.log(`An ompweb instance is already running at ${adoptedUrl} — opening it instead of starting a duplicate.`);
    if (openBrowser) {
      const isWindows = process.platform === "win32";
      const isMac = process.platform === "darwin";
      const openCmd = isWindows ? "explorer.exe" : isMac ? "open" : "xdg-open";
      const opener = spawn(openCmd, [adoptedUrl], { stdio: "ignore", detached: true });
      opener.on("error", () => {});
      opener.unref();
    } else {
      console.log(`Open ${adoptedUrl} in your browser.`);
    }
    return;
  }
  if (ownPortInUse) {
    console.error(`Port ${port} on ${hostname} is already in use by a non-ompweb process.`);
    console.error(`Run: ompweb --port ${Number(port) + 1}`);
    process.exitCode = 1;
    return;
  }

  // npm/global-install fallback: the published package cannot ship cargo
  // output. If no host is resolvable via OMPWEB_HOST_BIN or the package's own
  // vendor dir, reuse the desktop app's bundled ompweb-host (same machine /
  // architecture) so "ompweb" works out of the box on installs that also have
  // the OmpWeb desktop app.
  if (!process.env.OMPWEB_HOST_BIN) {
    const candidates = [path.join(pkgDir, "vendor", "ompweb-host", `${process.platform}-${process.arch}`, process.platform === "win32" ? "ompweb-host.exe" : "ompweb-host")];
    if (process.platform === "win32") {
      if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, "Programs", "OmpWeb", "resources", "bin", "ompweb-host.exe"));
      if (process.env.ProgramFiles) candidates.push(path.join(process.env.ProgramFiles, "OmpWeb", "resources", "bin", "ompweb-host.exe"));
      candidates.push("D:\\OPMWEB\\OmpWeb\\resources\\bin\\ompweb-host.exe");
    } else if (process.platform === "darwin") {
      candidates.push("/Applications/OmpWeb.app/Contents/Resources/bin/ompweb-host");
      const home = process.env.HOME || "";
      if (home) candidates.push(path.join(home, "Applications", "OmpWeb.app", "Contents", "Resources", "bin", "ompweb-host"));
    }
    const found = candidates.find((c) => fs.existsSync(c));
    if (found) {
      process.env.OMPWEB_HOST_BIN = found;
      console.log("Using ompweb-host: " + found);
    }
  }

  const child = spawn(process.execPath, ["--require", path.join(__dirname, "request-peer-preload.js"), nextBin, ...nextArgs], {
    cwd: pkgDir,
    stdio: ["inherit", "pipe", "inherit"],
    env: {
      ...process.env,
      OMP_WEB_PACKAGE_DIR: pkgDir,
      OMP_WEB_LAUNCHER_PID: String(process.pid),
      OMP_WEB_PORT: port,
      OMP_WEB_HOSTNAME: hostname,
    },
  });
  wireChildProcessLifecycle(child);

  let bannerPrinted = false;
  let browserOpened = false;
  let readyBuffer = "";
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    readyBuffer += text;
    if (readyBuffer.length > 500) readyBuffer = readyBuffer.slice(-500);
    if (readyBuffer.includes("Ready")) {
      if (!bannerPrinted) {
        bannerPrinted = true;
        const { entries, hint } = getAccessibleAddresses({ hostname, port });
        const banner = formatAddressBanner({
          version: pkgVersion,
          entries,
          hint,
          passwordEnabled,
          isTTY: process.stdout.isTTY,
        });
        process.stdout.write(banner);
      }
      if (openBrowser && !browserOpened) {
        browserOpened = true;
        const isWindows = process.platform === "win32";
        const isMac = process.platform === "darwin";
        const openCmd = isWindows ? "explorer.exe" : isMac ? "open" : "xdg-open";
        const opener = spawn(openCmd, [browserUrl], {
          stdio: "ignore",
          detached: true,
        });

        opener.on("error", (error) => {
          console.warn(`Could not open browser automatically: ${error.message}`);
        });

        opener.unref();
      }
    }
  });
}

main().catch((error) => {
  console.error(`Could not check whether ${browserUrl} is available: ${error.message}`);
  process.exit(1);
});

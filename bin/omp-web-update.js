#!/usr/bin/env node
"use strict";

// Detached self-updater for the installed ompweb package.
//
// Protocol (kept simple on purpose — this script must survive the package dir
// being replaced underneath it, so it only uses Node builtins):
//
//   1. wait for the parent server to exit (replacing a running app's files on
//      Windows can fail on open handles),
//   2. snapshot the current package dir (node_modules excluded) so a failed
//      install can be rolled back instead of stranding the user,
//   3. install @kahme247/ompweb@latest through the SAME package manager that
//      owns the install (bun or npm — a mismatched manager used to leave two
//      diverging global copies),
//   4. verify the installed version matches the expected one AND the launcher
//      exists — only then relaunch,
//   5. on any failure, restore the snapshot and relaunch the PREVIOUS version
//      so the app always comes back; the status file explains what happened.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn, spawnSync } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { dirname, join, relative, sep: pathSep } = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { homedir, tmpdir } = require("os");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const NPM_PACKAGE = "@kahme247/ompweb@latest";
const LOG_PATH = join(tmpdir(), "ompweb-update.log");
const BACKUPS_ROOT = join(homedir(), ".omp-web", "backups", "ompweb");

function log(message) {
  try {
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Logging must never break the update flow.
  }
}

function writeStatus(statusFile, status) {
  try {
    writeFileSync(statusFile, JSON.stringify({ ...status, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  } catch (error) {
    log(`Could not write status file ${statusFile}: ${error.message}`);
  }
}

function findNpmCli() {
  const nodeDir = dirname(process.execPath);
  const candidates = [
    join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
    join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find(existsSync) ?? null;
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid) {
  while (isRunning(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Copy a directory tree, skipping NESTED node_modules (hoisted globally in
 * both npm and bun layouts — never part of the package being replaced). The
 * source itself may live under a global node_modules root, so the filter is
 * measured relative to the source, not the absolute path. */
function copyPackageTree(source, target) {
  mkdirSync(target, { recursive: true });
  cpSync(source, target, {
    recursive: true,
    force: true,
    filter: (src) => !relative(source, src).split(pathSep).includes("node_modules"),
  });
}

/** Snapshot the current install so a failed update can roll back. */
function createBackup(packageDir) {
  const nonce = Math.random().toString(36).slice(2, 8);
  const backupDir = join(BACKUPS_ROOT, `${Date.now()}-${nonce}`);
  copyPackageTree(packageDir, backupDir);
  writeFileSync(join(backupDir, "backup.json"), JSON.stringify({ target: packageDir, createdAt: Date.now() }, null, 2), "utf8");
  return backupDir;
}

function pruneBackups(keep) {
  try {
    const entries = existsSync(BACKUPS_ROOT) ? readFileSystemEntries(BACKUPS_ROOT) : [];
    const dirs = entries
      .filter((name) => existsSync(join(BACKUPS_ROOT, name, "backup.json")))
      .sort()
      .reverse();
    for (const name of dirs.slice(keep)) {
      rmSync(join(BACKUPS_ROOT, name), { recursive: true, force: true });
    }
  } catch (error) {
    log(`Backup prune failed: ${error.message}`);
  }
}

function readFileSystemEntries(dir) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readdirSync } = require("fs");
  return readdirSync(dir);
}

function restoreBackup(backupDir, packageDir) {
  rmSync(packageDir, { recursive: true, force: true });
  copyPackageTree(backupDir, packageDir);
}

function readPackageVersion(packageDir) {
  try {
    const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

/** Locate the package dir a manager will install into, after the install. */
function resolveInstalledPackageDir(method) {
  if (method === "bun") {
    return join(homedir(), "node_modules", "@kahme247", "ompweb");
  }
  const npmRoot = spawnSync("npm", ["root", "-g"], { encoding: "utf8", windowsHide: true });
  if (npmRoot.status === 0 && npmRoot.stdout.trim()) {
    return join(npmRoot.stdout.trim(), "@kahme247", "ompweb");
  }
  return join(process.env.APPDATA ?? "", "npm", "node_modules", "@kahme247", "ompweb");
}

/** Install through the package manager that owns the install. */
function runInstall(method) {
  if (method === "bun") {
    return spawnSync("bun", ["install", "-g", NPM_PACKAGE], {
      cwd: homedir(),
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      encoding: "utf8",
      windowsHide: true,
      timeout: 300_000,
    });
  }
  const npmCli = findNpmCli();
  const command = npmCli ?? "npm";
  const args = npmCli ? [npmCli, "install", "--global", NPM_PACKAGE] : ["install", "--global", NPM_PACKAGE];
  return spawnSync(command, args, {
    cwd: homedir(),
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    encoding: "utf8",
    windowsHide: true,
    timeout: 300_000,
  });
}

/** Best-effort: keep the OTHER manager's global copy in sync when it exists,
 * so the app never ends up with two diverging versions (a real failure mode
 * seen with bun-managed 0.2.5 vs npm-managed 0.2.6). */
function syncOtherManager(method) {
  try {
    if (method === "bun") {
      const check = spawnSync("npm", ["ls", "-g", "@kahme247/ompweb"], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
      if (check.status === 0 || (check.stdout + check.stderr).includes("@kahme247/ompweb")) {
        const result = runInstall("npm");
        log(result.status === 0 ? "Synced npm global copy" : `npm global sync failed (${result.status})`);
      }
    } else {
      const check = spawnSync("bun", ["pm", "ls", "-g"], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
      if ((check.stdout + check.stderr).includes("@kahme247/ompweb")) {
        const result = runInstall("bun");
        log(result.status === 0 ? "Synced bun global copy" : `bun global sync failed (${result.status})`);
      }
    }
  } catch (error) {
    log(`Other-manager sync skipped: ${error.message}`);
  }
}

function relaunch(packageDir, port, hostname) {
  const launcher = join(packageDir, "bin", "omp-web.js");
  if (!existsSync(launcher)) {
    log(`Could not restart: launcher not found at ${launcher}`);
    return;
  }
  const restarted = spawn(process.execPath, [launcher, "--port", port, "--hostname", hostname, "--no-open"], {
    cwd: homedir(),
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  restarted.unref();
}

async function main() {
  const { values } = parseArgs({
    options: {
      "parent-pid": { type: "string" },
      "launcher-pid": { type: "string" },
      "package-dir": { type: "string" },
      port: { type: "string" },
      hostname: { type: "string" },
      method: { type: "string" },
      "expected-version": { type: "string" },
      "status-file": { type: "string" },
    },
    strict: true,
  });
  const parentPid = Number(values["parent-pid"]);
  const launcherPid = values["launcher-pid"] ? Number(values["launcher-pid"]) : null;
  const packageDir = values["package-dir"];
  const method = values["method"] === "bun" ? "bun" : "npm";
  const expectedVersion = values["expected-version"];
  const statusFile = values["status-file"];
  const port = values["port"] ?? "30177";
  const hostname = values["hostname"] ?? "127.0.0.1";

  if (!Number.isInteger(parentPid) || (launcherPid !== null && !Number.isInteger(launcherPid)) || !packageDir || !expectedVersion || !statusFile) {
    throw new Error("Invalid updater arguments");
  }

  writeStatus(statusFile, { status: "running", version: readPackageVersion(packageDir) });
  log(`Updater started (parent=${parentPid}, method=${method}, expected=${expectedVersion}, packageDir=${packageDir})`);

  await waitForExit(parentPid);
  if (launcherPid !== null && launcherPid !== parentPid) await waitForExit(launcherPid);

  log("Parent exited; snapshotting current install");
  let backupDir = null;
  try {
    backupDir = createBackup(packageDir);
    log(`Snapshot at ${backupDir}`);
  } catch (error) {
    log(`Snapshot failed: ${error.message}`);
  }

  writeStatus(statusFile, { status: "running", version: readPackageVersion(packageDir), note: "installing" });
  log(`Installing ${NPM_PACKAGE} via ${method}`);
  const result = runInstall(method);
  if (result.error || result.status !== 0) {
    const reason = `${result.error?.message ?? result.stderr ?? result.stdout ?? "unknown error"}`.trim().slice(-800);
    throw new Error(`install failed (${result.status ?? "spawn error"}): ${reason}`);
  }

  const installedDir = resolveInstalledPackageDir(method);
  const installedVersion = readPackageVersion(installedDir);
  log(`Installed ${installedVersion ?? "unknown"} at ${installedDir}`);

  if (installedVersion !== expectedVersion || !existsSync(join(installedDir, "bin", "omp-web.js"))) {
    throw new Error(`installed version ${installedVersion ?? "unknown"} does not match expected ${expectedVersion} (launcher present: ${existsSync(join(installedDir, "bin", "omp-web.js"))})`);
  }

  writeStatus(statusFile, { status: "ok", version: installedVersion });
  log(`Update verified at v${installedVersion}`);

  syncOtherManager(method);
  pruneBackups(2);
  relaunch(installedDir, port, hostname);
  log("Relaunch scheduled");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  log(`Update failed: ${message}`);
  const { values } = parseArgs({
    options: {
      "package-dir": { type: "string" },
      "status-file": { type: "string" },
      port: { type: "string" },
      hostname: { type: "string" },
    },
    strict: false,
  });
  // Never strand the user: restore the previous install when we have a
  // snapshot, then relaunch whatever is present.
  const packageDir = values["package-dir"];
  const statusFile = values["status-file"];
  try {
    const entries = existsSync(BACKUPS_ROOT) ? readFileSystemEntries(BACKUPS_ROOT) : [];
    const newest = entries
      .filter((name) => existsSync(join(BACKUPS_ROOT, name, "backup.json")))
      .sort()
      .pop();
    if (newest && packageDir) {
      restoreBackup(join(BACKUPS_ROOT, newest), packageDir);
      log(`Rolled back to snapshot ${newest}`);
    }
  } catch (rollbackError) {
    log(`Rollback failed: ${rollbackError.message}`);
  }
  if (statusFile) {
    writeStatus(statusFile, { status: "failed", error: message, version: packageDir ? readPackageVersion(packageDir) : undefined });
  }
  if (packageDir) {
    relaunch(packageDir, values["port"] ?? "30177", values["hostname"] ?? "127.0.0.1");
    log("Relaunched previous install after failure");
  }
  process.exitCode = 1;
});

#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { appendFileSync, existsSync } = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn, spawnSync } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { dirname, join } = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { homedir, tmpdir } = require("os");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const NPM_PACKAGE = "@kahme247/ompweb@latest";
const LOG_PATH = join(tmpdir(), "ompweb-update.log");

function log(message) {
  appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}\n`);
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

async function main() {
  const { values } = parseArgs({
    options: {
      "parent-pid": { type: "string" },
      "launcher-pid": { type: "string" },
      "package-dir": { type: "string" },
      port: { type: "string" },
      hostname: { type: "string" },
    },
    strict: true,
  });
  const parentPid = Number(values["parent-pid"]);
  const launcherPid = values["launcher-pid"] ? Number(values["launcher-pid"]) : null;
  const packageDir = values["package-dir"];
  if (!Number.isInteger(parentPid) || (launcherPid !== null && !Number.isInteger(launcherPid)) || !packageDir) {
    throw new Error("Invalid updater arguments");
  }

  await waitForExit(parentPid);
  if (launcherPid !== null && launcherPid !== parentPid) await waitForExit(launcherPid);

  const npmCli = findNpmCli();
  const command = npmCli ?? "npm";
  const args = npmCli
    ? [npmCli, "install", "--global", NPM_PACKAGE]
    : ["install", "--global", NPM_PACKAGE];
  const result = spawnSync(command, args, {
    cwd: homedir(),
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    encoding: "utf8",
  });

  if (result.error || result.status !== 0) {
    log(`Update failed (${result.status ?? "spawn error"}): ${result.error?.message ?? result.stderr ?? result.stdout}`);
  } else {
    log("Update completed successfully");
  }

  const launcher = join(packageDir, "bin", "omp-web.js");
  if (!existsSync(launcher)) {
    log(`Could not restart: launcher not found at ${launcher}`);
    return;
  }

  const launcherArgs = [launcher, "--port", values.port ?? "30177", "--hostname", values.hostname ?? "127.0.0.1", "--no-open"];
  const restarted = spawn(process.execPath, launcherArgs, {
    cwd: homedir(),
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  restarted.unref();
}

main().catch((error) => {
  log(`Updater failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});

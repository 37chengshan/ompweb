import { execFile } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { resolveOmpBin } from "./omp-cli";
import { disposeUtilityRpc, runUtilityCommand } from "./rpc-utility";
import { createBackup, pruneBackups, restoreBackup } from "../update-backups";

export interface OmpUpdateStatus {
  currentVersion: string | null;
  availableVersion: string | null;
  updateAvailable: boolean;
}

const OMP_BACKUP_LABEL = "omp";

function runOmpUpdate(args: string[]): Promise<string> {
  const bin = resolveOmpBin();
  if (!bin) return Promise.reject(new Error("omp binary not found. Install oh-my-pi or set OMP_WEB_OMP_BIN."));
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  execFile(bin, ["update", ...args], {
    timeout: 300_000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    windowsHide: true,
  }, (error, stdout, stderr) => {
    if (error) reject(new Error((stderr || stdout || error.message).trim().slice(-1000)));
    else resolve(`${stdout}\n${stderr}`.trim());
  });
  return promise;
}

/** Fresh `omp --version` probe that bypasses the omp-cli caches. */
function probeOmpVersion(bin: string, timeoutMs = 15_000): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  execFile(bin, ["--version"], { timeout: timeoutMs, windowsHide: true }, (error, stdout) => {
    resolve(error ? null : stdout.trim() || null);
  });
  return promise;
}

/**
 * The directory set that owns the launcher, for snapshot/rollback. bun 1.3.x
 * global installs land in `~/node_modules` on this machine (the `.bunx` shims
 * resolve `..\node_modules` from `~/.bun`), while npm uses the npm prefix and
 * older bun layouts used `~/.bun/install/global`. Probe the known roots and
 * back up whichever exists — the whole `@oh-my-pi` scope, because `omp update`
 * bumps pi-coding-agent AND its pinned `pi-natives*` companions together.
 */
function resolveOmpScopeDir(): string | null {
  const candidates = [
    join(homedir(), "node_modules", "@oh-my-pi"),
    join(homedir(), ".bun", "install", "global", "node_modules", "@oh-my-pi"),
    join(process.env.APPDATA ?? "", "npm", "node_modules", "@oh-my-pi"),
  ];
  return candidates.find(existsSync) ?? null;
}

export function parseOmpUpdateStatus(output: string): OmpUpdateStatus {
  const currentVersion = output.match(/^Current version:\s*(\S+)/mi)?.[1] ?? null;
  const availableVersion = output.match(/^New version available:\s*(\S+)/mi)?.[1] ?? null;
  return { currentVersion, availableVersion, updateAvailable: availableVersion !== null };
}

export async function checkOmpUpdate(): Promise<OmpUpdateStatus> {
  return parseOmpUpdateStatus(await runOmpUpdate(["--check"]));
}

/**
 * Install the latest omp runtime with a snapshot/verify/rollback contract:
 *
 *   1. snapshot the `@oh-my-pi` scope dir that owns the launcher,
 *   2. run `omp update` (it owns installer detection and the pi-natives pin),
 *   3. verify the binary still answers `--version` AND a fresh RPC process can
 *      complete `get_state` (the exact contract omp-web relies on),
 *   4. on any failure, restore the snapshot and re-verify, then surface the
 *      original error.
 */
async function runVerifiedOmpUpdate(): Promise<string> {
  const bin = resolveOmpBin();
  if (!bin) throw new Error("omp binary not found. Install oh-my-pi or set OMP_WEB_OMP_BIN.");

  const before = await probeOmpVersion(bin);
  if (!before) {
    // The binary is already broken — an update has nothing to verify against
    // and a rollback would restore a broken install. Fail fast instead of
    // snapshotting/updating into a worse state.
    throw new Error(`omp binary at ${bin} does not answer --version before the update`);
  }
  const scopeDir = resolveOmpScopeDir();
  let backupDir: string | null = null;
  if (scopeDir) {
    try {
      backupDir = await createBackup(scopeDir, OMP_BACKUP_LABEL);
    } catch (error) {
      // A failed snapshot must not block the update; verification+rollback
      // simply degrade to "report and surface".
      console.warn(`[omp-web] could not snapshot ${scopeDir}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    const output = await runOmpUpdate([]);
    await verifyOmpHealth(bin);
    void pruneBackups(OMP_BACKUP_LABEL, 2);
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (backupDir) {
      try {
        await restoreBackup(backupDir);
        const restored = await verifyOmpHealth(bin).then(() => true).catch(() => false);
        if (restored) {
          throw new Error(`omp update failed and was rolled back to the previous version: ${message}`);
        }
        throw new Error(`omp update failed AND rollback failed — the omp install may be broken: ${message}`);
      } catch (rollbackError) {
        if (rollbackError instanceof Error && rollbackError.message.startsWith("omp update failed")) throw rollbackError;
        throw new Error(`omp update failed and rollback could not restore the previous install: ${message} (${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)})`);
      }
    }
    throw error;
  }
}

/** The omp-web runtime contract: `--version` answers AND a fresh utility RPC
 * process completes `get_state`. Throws with a precise message otherwise. */
async function verifyOmpHealth(bin: string): Promise<string> {
  const version = await probeOmpVersion(bin);
  if (!version) {
    throw new Error(`omp binary at ${bin} no longer answers --version after the update`);
  }
  try {
    // Drop any live utility process so this spawns against the NEW install.
    disposeUtilityRpc();
    await runUtilityCommand({ type: "get_state" });
  } catch (error) {
    throw new Error(`omp ${version} answers --version but the RPC runtime failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return version;
}

let installPromise: Promise<string> | null = null;

export function installOmpUpdate(): Promise<string> {
  if (!installPromise) {
    installPromise = runVerifiedOmpUpdate().finally(() => {
      installPromise = null;
    });
  }
  return installPromise;
}

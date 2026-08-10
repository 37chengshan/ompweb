import { execFile } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { delimiter, join } from "path";

/**
 * Locating and probing the user's installed `omp` CLI. omp-web never embeds
 * the (Bun-only) @oh-my-pi SDK — every live-agent capability goes through the
 * omp binary, so its absence is a first-class, user-visible state.
 */

let cachedBin: string | null = null;
let binMissAt = 0;
let cachedVersion: string | null = null;
let versionMissAt = 0;

const BIN_NAME = process.platform === "win32" ? "omp.exe" : "omp";
// Only successes are cached for the process lifetime. omp may be installed (or
// PATH repaired) while the server runs; a permanently cached "not found" would
// keep the UI reporting a missing binary until restart.
const MISS_TTL_MS = 30_000;

/** Clear probes after an explicit `omp update` so the next request rechecks it. */
export function invalidateOmpCliCache(): void {
  cachedBin = null;
  binMissAt = 0;
  cachedVersion = null;
  versionMissAt = 0;
}

function probeOmpBin(): string | null {
  const override = process.env.OMP_WEB_OMP_BIN;
  if (override) return existsSync(override) ? override : null;
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, BIN_NAME);
    if (existsSync(candidate)) return candidate;
  }
  // GUI-launched processes often miss homebrew/bun dirs in PATH; probe the
  // usual install locations before giving up.
  const fallbackDirs = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(homedir(), ".bun", "bin"),
    join(homedir(), ".local", "bin"),
  ];
  for (const dir of fallbackDirs) {
    const candidate = join(dir, BIN_NAME);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Resolve the omp binary: OMP_WEB_OMP_BIN override, then PATH lookup. Returns
 * null when omp is not installed. A hit is cached for the process lifetime; a
 * miss is re-probed after MISS_TTL_MS. */
export function resolveOmpBin(): string | null {
  if (cachedBin) return cachedBin;
  if (Date.now() - binMissAt < MISS_TTL_MS) return null;
  const found = probeOmpBin();
  if (found) {
    cachedBin = found;
    binMissAt = 0;
    return found;
  }
  binMissAt = Date.now();
  return null;
}

/** `omp --version` output (e.g. "omp/17.1.3"), or null when unavailable.
 * Cached after the first successful probe; failures are retried after
 * MISS_TTL_MS so a later install is picked up without a server restart. */
export async function getOmpVersion(): Promise<string | null> {
  if (cachedVersion) return cachedVersion;
  if (Date.now() - versionMissAt < MISS_TTL_MS) return null;
  const bin = resolveOmpBin();
  if (!bin) {
    versionMissAt = Date.now();
    return null;
  }
  try {
    const output = await new Promise<string>((resolve, reject) => {
      execFile(bin, ["--version"], { timeout: 10_000, windowsHide: true }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
    const version = output.trim();
    if (version) {
      cachedVersion = version;
      versionMissAt = 0;
      return version;
    }
  } catch {
    // Fall through to the miss path: retry after the TTL.
  }
  versionMissAt = Date.now();
  return null;
}

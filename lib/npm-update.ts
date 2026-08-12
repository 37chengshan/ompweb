import packageJson from "../package.json";
import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join, normalize, sep } from "path";

const NPM_PACKAGE = "@kahme247/ompweb";
const CHECK_TTL_MS = 60 * 60 * 1000;

export interface NpmUpdateStatus {
  currentVersion: string;
  availableVersion: string | null;
  updateAvailable: boolean;
}

/** Outcome of the most recent self-update attempt, surfaced by GET /api/app-update
 * so a restored app can tell the user why the last update failed. */
export interface LastUpdateInfo {
  status: "ok" | "failed" | "running";
  version?: string;
  error?: string;
  updatedAt: string;
}

let cached: { checkedAt: number; status: NpmUpdateStatus } | null = null;
let installPromise: Promise<void> | null = null;

function parseVersion(version: string): { parts: number[]; prerelease: boolean } | null {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)(-.+)?$/);
  if (!match) return null;
  return { parts: match.slice(1, 4).map(Number), prerelease: Boolean(match[4]) };
}

export function isNewerVersion(availableVersion: string, currentVersion: string): boolean {
  const available = parseVersion(availableVersion);
  const current = parseVersion(currentVersion);
  if (!available || !current) return false;

  for (let index = 0; index < available.parts.length; index += 1) {
    if (available.parts[index] !== current.parts[index]) {
      return available.parts[index] > current.parts[index];
    }
  }
  return !available.prerelease && current.prerelease;
}

export async function checkNpmUpdate(force = false): Promise<NpmUpdateStatus> {
  if (!force && cached && Date.now() - cached.checkedAt < CHECK_TTL_MS) return cached.status;

  const currentVersion = packageJson.version;
  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(NPM_PACKAGE)}/latest`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const data = response.ok ? await response.json() as { version?: unknown } : null;
    const availableVersion = typeof data?.version === "string" ? data.version : null;
    const status = {
      currentVersion,
      availableVersion,
      updateAvailable: Boolean(availableVersion && isNewerVersion(availableVersion, currentVersion)),
    };
    cached = { checkedAt: Date.now(), status };
    return status;
  } catch {
    return { currentVersion, availableVersion: null, updateAvailable: false };
  }
}

/** Which package manager owns a given install dir, so updates always run
 * through the manager that manages it (bun global root, npm global root,
 * anything else → npm as the fallback). Separators are normalized so the
 * classification is deterministic even when a Windows-style path is passed
 * on a POSIX host (e.g. in CI tests). */
export function detectInstallMethod(packageDir: string): "bun" | "npm" {
  const toPlatformPath = (value: string): string => normalize(value).replaceAll("\\", sep);
  const normalized = toPlatformPath(packageDir);
  const bunRoots = [
    // bun 1.3.x globals on Windows live in ~/node_modules; POSIX uses the
    // standard ~/.bun/install/global/node_modules.
    join(process.env.USERPROFILE ?? process.env.HOME ?? "", "node_modules"),
    join(homedir(), ".bun", "install", "global", "node_modules"),
  ].map(toPlatformPath);
  return bunRoots.some((root) => normalized.startsWith(root + sep)) ? "bun" : "npm";
}

/** Absolute path of the persistent status file the detached updater writes. */
export function updateStatusFilePath(): string {
  return join(tmpdir(), "ompweb-update-status.json");
}

/** Read the last updater outcome (null when no update has been attempted). */
export function readLastUpdateInfo(): LastUpdateInfo | null {
  try {
    const parsed = JSON.parse(readFileSync(updateStatusFilePath(), "utf8")) as Partial<LastUpdateInfo>;
    if (parsed.status === "ok" || parsed.status === "failed" || parsed.status === "running") {
      return {
        status: parsed.status,
        version: typeof parsed.version === "string" ? parsed.version : undefined,
        error: typeof parsed.error === "string" ? parsed.error : undefined,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function installNpmUpdate(): Promise<void> {
  if (!installPromise) {
    installPromise = startVerifiedUpdater().catch((error) => {
      installPromise = null;
      throw error;
    });
  }
  return installPromise;
}

/**
 * Pre-flight checks that must pass BEFORE the server exits itself. The server
 * only schedules its own shutdown once the updater has spawned — everything
 * else (dev mode, no update, missing launcher) fails here, while the server is
 * still healthy, so a bad request can never take the app down.
 */
async function startVerifiedUpdater(): Promise<void> {
  const packageDir = process.env.OMP_WEB_PACKAGE_DIR ?? process.cwd();
  // The installed launcher (bin/omp-web.js) sets OMP_WEB_PACKAGE_DIR to the
  // real package dir. Without it — or when it equals the checkout the dev
  // server runs from — an update would replace files that are not the
  // installed app, so refuse before anything happens.
  if (!process.env.OMP_WEB_PACKAGE_DIR || packageDir === process.cwd()) {
    throw new Error("self-update is only available for the installed ompweb — this server is running from source");
  }

  const status = await checkNpmUpdate(true);
  if (!status.updateAvailable || !status.availableVersion) {
    throw new Error(status.availableVersion ? "ompweb is already up to date" : "could not determine the latest version from the npm registry");
  }
  const expectedVersion = status.availableVersion;

  const launcher = join(packageDir, "bin", "omp-web.js");
  if (!existsSync(launcher)) {
    throw new Error(`installed ompweb launcher not found at ${launcher}`);
  }

  const method = detectInstallMethod(packageDir);
  const statusFile = updateStatusFilePath();
  const updaterArgs = [
    join(packageDir, "bin", "omp-web-update.js"),
    "--parent-pid", String(process.pid),
    "--launcher-pid", process.env.OMP_WEB_LAUNCHER_PID ?? "",
    "--package-dir", packageDir,
    "--port", process.env.OMP_WEB_PORT ?? process.env.PORT ?? "30177",
    "--hostname", process.env.OMP_WEB_HOSTNAME ?? "127.0.0.1",
    "--method", method,
    "--expected-version", expectedVersion,
    "--status-file", statusFile,
  ];

  const updater = spawn(process.execPath, updaterArgs, {
    cwd: tmpdir(),
    detached: true,
    stdio: "ignore",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  updater.once("spawn", resolve);
  updater.once("error", reject);
  await promise;
  updater.unref();

  // The updater waits for this process to exit before touching the install
  // (replacing a running app's files on Windows can fail on open handles).
  // Give the response a moment to flush, then hand over.
  const shutdownTimer = setTimeout(() => process.exit(0), 1500);
  shutdownTimer.unref();
}

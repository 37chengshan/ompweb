import { execFile } from "child_process";
import { resolveOmpBin } from "./omp-cli";
import { proxyEnv, readProxyConfig, resolveEffectiveProxy } from "../proxy-config";

export interface OmpUpdateStatus {
  currentVersion: string | null;
  availableVersion: string | null;
  updateAvailable: boolean;
  updateCommand: string;
}

async function runOmpUpdate(args: string[]): Promise<string> {
  const bin = resolveOmpBin();
  if (!bin) throw new Error("omp binary not found. Install oh-my-pi or set OMP_WEB_OMP_BIN.");
  // The updater downloads from GitHub; a configured web proxy (FlClash etc.)
  // must be visible to it or the fetch dies with a closed-socket error.
  const proxyUrl = await resolveEffectiveProxy().catch(() => null);
  const env = {
    ...process.env,
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    ...proxyEnv(proxyUrl),
  };
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  execFile(bin, ["update", ...args], {
    timeout: 300_000,
    maxBuffer: 1024 * 1024,
    env,
    windowsHide: true,
  }, (error, stdout, stderr) => {
    if (error) reject(new Error((stderr || stdout || error.message).trim().slice(-1000)));
    else resolve(`${stdout}\n${stderr}`.trim());
  });
  return promise;
}

export function parseOmpUpdateStatus(output: string): OmpUpdateStatus {
  const currentVersion = output.match(/^Current version:\s*(\S+)/mi)?.[1] ?? null;
  const availableVersion = output.match(/^New version available:\s*(\S+)/mi)?.[1] ?? null;
  return {
    currentVersion,
    availableVersion,
    updateAvailable: availableVersion !== null,
    updateCommand: "omp update",
  };
}

export async function checkOmpUpdate(): Promise<OmpUpdateStatus> {
  return parseOmpUpdateStatus(await runOmpUpdate(["--check"]));
}

/** Runs the real `omp update` (installs the newer version) and returns the
 *  command output. Callers restart RPC sessions afterwards. */
export async function runOmpUpdateNow(): Promise<string> {
  return runOmpUpdate([]);
}


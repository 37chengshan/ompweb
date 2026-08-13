import { execFile } from "child_process";
import { resolveOmpBin } from "./omp-cli";

export interface OmpUpdateStatus {
  currentVersion: string | null;
  availableVersion: string | null;
  updateAvailable: boolean;
  updateCommand: string;
}

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


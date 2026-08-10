import { execFile } from "child_process";
import { resolveOmpBin } from "./omp-cli";

export interface OmpUpdateStatus {
  currentVersion: string | null;
  availableVersion: string | null;
  updateAvailable: boolean;
}

function runOmpUpdate(args: string[]): Promise<string> {
  const bin = resolveOmpBin();
  if (!bin) return Promise.reject(new Error("omp binary not found. Install oh-my-pi or set OMP_WEB_OMP_BIN."));
  return new Promise((resolve, reject) => {
    execFile(bin, ["update", ...args], {
      timeout: 300_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || stdout || error.message).trim().slice(-1000)));
      else resolve(`${stdout}\n${stderr}`.trim());
    });
  });
}

export function parseOmpUpdateStatus(output: string): OmpUpdateStatus {
  const currentVersion = output.match(/^Current version:\s*(\S+)/mi)?.[1] ?? null;
  const availableVersion = output.match(/^New version available:\s*(\S+)/mi)?.[1] ?? null;
  return { currentVersion, availableVersion, updateAvailable: availableVersion !== null };
}

export async function checkOmpUpdate(): Promise<OmpUpdateStatus> {
  return parseOmpUpdateStatus(await runOmpUpdate(["--check"]));
}

export async function installOmpUpdate(): Promise<string> {
  return runOmpUpdate([]);
}

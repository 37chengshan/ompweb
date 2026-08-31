"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require("node:os");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("node:child_process");

const forwardedSignals = ["SIGINT", "SIGTERM"];
const shutdownTimeoutMs = 5_000;

function getSignalExitCode(signal) {
  const signalNumber = signal ? os.constants.signals[signal] : undefined;
  return typeof signalNumber === "number" ? 128 + signalNumber : 1;
}

function killChildTree(child, force, platform = process.platform) {
  if (platform === "win32" && child.pid) {
    // The pid is OS-assigned at spawn time (numeric), never attacker data; the
    // integer guard keeps the taskkill argv provably numeric-only.
    const pid = child.pid;
    if (Number.isInteger(pid) && pid > 0) {
      const reaper = spawn("taskkill", ["/pid", String(pid), "/t", ...(force ? ["/f"] : [])], {
        windowsHide: true,
        stdio: "ignore",
      });
      reaper.once("error", () => {
        try { child.kill(force ? "SIGKILL" : "SIGTERM"); } catch {}
      });
      reaper.unref?.();
      return;
    }
  }

  try { child.kill(force ? "SIGKILL" : "SIGTERM"); } catch {}
}

function wireChildProcessLifecycle(child, parentProcess = process, timeoutMs = shutdownTimeoutMs) {
  const signalHandlers = new Map();
  let shutdownTimer;
  const platform = parentProcess.platform ?? process.platform;

  const forceKill = () => killChildTree(child, true, platform);

  for (const signal of forwardedSignals) {
    const handler = () => {
      if (shutdownTimer) {
        forceKill();
        return;
      }

      shutdownTimer = setTimeout(forceKill, timeoutMs);
      shutdownTimer.unref?.();
      try {
        child.kill(signal);
      } catch {
        // Windows has limited signal support. Ask taskkill to terminate the
        // child tree if the native signal could not be delivered.
        if (platform === "win32") killChildTree(child, false, platform);
      }
    };
    signalHandlers.set(signal, handler);
    parentProcess.on(signal, handler);
  }

  child.once("exit", (code, signal) => {
    if (shutdownTimer) clearTimeout(shutdownTimer);

    for (const [forwardedSignal, handler] of signalHandlers) {
      parentProcess.removeListener(forwardedSignal, handler);
    }

    parentProcess.exit(code ?? getSignalExitCode(signal));
  });
}

module.exports = { wireChildProcessLifecycle };

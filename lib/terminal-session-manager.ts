import crypto from "crypto";
import fs from "fs";
import { spawn, type ChildProcess } from "child_process";

export interface TerminalSession {
  id: string;
  process: ChildProcess;
  cwd: string;
  createdAt: number;
  lastActivityAt: number;
  subscribers: Set<(data: string) => void>;
  historyBuffer: string[];
  historyBytes: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __ompTerminalSessions: Map<string, TerminalSession> | undefined;
}

const sessions = globalThis.__ompTerminalSessions ?? new Map<string, TerminalSession>();
globalThis.__ompTerminalSessions = sessions;

// Cap the replay buffer by total bytes (not chunk count) so a `cat` of a huge
// file can never balloon memory into tens of MB.
const MAX_HISTORY_BYTES = 1024 * 1024;

// Global cap on concurrent terminal sessions; old sessions are reaped below.
const MAX_SESSIONS = 8;
// A session with no subscribers for this long is reaped (shell killed).
const IDLE_TTL_MS = 30 * 60 * 1000;

/**
 * Spawn the shell inside a real PTY. Without a TTY, zsh disables its line
 * editor and never echoes typed characters (keystrokes only execute after
 * Enter). macOS uses python3's pty.spawn to allocate a real PTY (the system
 * `script` utility refuses socket stdin with "tcgetattr: Operation not
 * supported on socket"); Linux uses util-linux `script` which accepts any
 * stdin. Windows cmd.exe echoes input itself over pipes, so it keeps the
 * plain spawn path. (node-pty was evaluated but its prebuilt binaries do not
 * work on Node 24 / macOS 25 — posix_spawnp fails even after a rebuild.)
 */
function spawnShellPty(cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const isLinux = process.platform === "linux";

  let command: string;
  let args: string[];
  if (isWindows) {
    command = process.env.COMSPEC || "cmd.exe";
    args = [];
  } else if (isMac) {
    command = "python3";
    args = ["-c", "import pty,sys; pty.spawn(sys.argv[1:])", process.env.SHELL || "/bin/zsh", "-i"];
  } else if (isLinux) {
    command = "script";
    args = ["-qfc", `${process.env.SHELL || "/bin/bash"} -i`, "/dev/null"];
  } else {
    command = process.env.SHELL || "/bin/sh";
    args = ["-i"];
  }

  return spawn(command, args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function createTerminalSession(targetCwd?: string): { id: string; cwd: string } {
  let cwd = targetCwd;
  if (!cwd || typeof cwd !== "string" || !fs.existsSync(cwd)) {
    cwd = process.cwd();
  }
  try {
    cwd = fs.realpathSync(cwd);
  } catch {
    cwd = process.cwd();
  }

  // Reap sessions whose shells have no subscribers and are past the TTL, and
  // enforce a hard cap so a long-lived dev server cannot accumulate shells.
  const now = Date.now();
  for (const [sid, session] of sessions) {
    if (session.subscribers.size === 0 && now - session.lastActivityAt > IDLE_TTL_MS) {
      try {
        session.process.kill();
      } catch {
        // Already dead.
      }
      sessions.delete(sid);
    }
  }
  while (sessions.size >= MAX_SESSIONS) {
    let oldest: TerminalSession | null = null;
    let oldestId = "";
    for (const [sid, session] of sessions) {
      if (!oldest || session.createdAt < oldest.createdAt) {
        oldest = session;
        oldestId = sid;
      }
    }
    if (!oldest) break;
    try {
      oldest.process.kill();
    } catch {
      // Already dead.
    }
    sessions.delete(oldestId);
  }

  const id = `term-${crypto.randomBytes(8).toString("hex")}`;

  const proc = spawnShellPty(cwd, {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: process.env.LANG || "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
  });

  const session: TerminalSession = {
    id,
    process: proc,
    cwd,
    createdAt: now,
    lastActivityAt: now,
    subscribers: new Set(),
    historyBuffer: [],
    historyBytes: 0,
  };

  const broadcast = (text: string) => {
    session.lastActivityAt = Date.now();
    session.historyBuffer.push(text);
    session.historyBytes += Buffer.byteLength(text, "utf8");
    while (session.historyBytes > MAX_HISTORY_BYTES && session.historyBuffer.length > 1) {
      const dropped = session.historyBuffer.shift();
      if (dropped) session.historyBytes -= Buffer.byteLength(dropped, "utf8");
    }
    session.subscribers.forEach((cb) => {
      try {
        cb(text);
      } catch (err) {
        console.error("[TerminalManager] Callback error:", err);
      }
    });
  };

  // Initial banner
  broadcast(`\r\n\x1b[38;2;176;62;34m⌥ omp web\x1b[0m \x1b[90m· Terminal Ready ·\x1b[0m \x1b[36m${cwd}\x1b[0m\r\n\r\n`);

  proc.stdout?.on("data", (data: Buffer | string) => {
    const text = typeof data === "string" ? data : data.toString("utf-8");
    // PTY data already uses \r\n; pass through as-is (keeps cursor/ANSI sane).
    broadcast(text);
  });

  proc.stderr?.on("data", (data: Buffer | string) => {
    const text = typeof data === "string" ? data : data.toString("utf-8");
    broadcast(text);
  });

  proc.on("error", (err) => {
    broadcast(`\r\n\x1b[31m[Terminal Process Error: ${err.message}]\x1b[0m\r\n`);
  });

  proc.on("close", (code) => {
    broadcast(`\r\n\x1b[33m[Terminal closed with code ${code ?? 0}]\x1b[0m\r\n`);
    sessions.delete(id);
  });

  sessions.set(id, session);
  return { id, cwd };
}

export function getTerminalSession(id: string): TerminalSession | undefined {
  return sessions.get(id);
}

export function subscribeToTerminal(id: string, onData: (data: string) => void): () => void {
  const session = sessions.get(id);
  if (!session) return () => {};

  // Replay existing history buffer
  if (session.historyBuffer.length > 0) {
    onData(session.historyBuffer.join(""));
  }

  session.subscribers.add(onData);
  return () => {
    session.subscribers.delete(onData);
  };
}

export function writeToTerminal(id: string, data: string): boolean {
  const session = sessions.get(id);
  if (!session || !session.process.stdin?.writable) {
    return false;
  }
  try {
    session.lastActivityAt = Date.now();
    const normalized = data === "\r" ? "\n" : data.replace(/\r/g, "\n");
    session.process.stdin.write(normalized);
    return true;
  } catch (err) {
    console.error("[TerminalManager] write error:", err);
    return false;
  }
}

export function closeTerminalSession(id: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  try {
    session.process.kill();
  } catch {}
  sessions.delete(id);
  return true;
}

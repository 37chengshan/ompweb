import { spawn, type ChildProcess } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";

export interface TerminalSession {
  id: string;
  process: ChildProcess;
  cwd: string;
  createdAt: number;
  subscribers: Set<(data: string) => void>;
  historyBuffer: string[];
}

declare global {
  // eslint-disable-next-line no-var
  var __ompTerminalSessions: Map<string, TerminalSession> | undefined;
}

const sessions = globalThis.__ompTerminalSessions ?? new Map<string, TerminalSession>();
globalThis.__ompTerminalSessions = sessions;

const MAX_HISTORY_CHUNKS = 1000;

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

  const id = `term-${crypto.randomBytes(8).toString("hex")}`;
  const isWindows = process.platform === "win32";

  const shell = isWindows
    ? (process.env.COMSPEC || "cmd.exe")
    : (process.env.SHELL || "/bin/zsh");

  const args = isWindows ? [] : ["-i"];

  const proc = spawn(shell, args, {
    cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: process.env.LANG || "en_US.UTF-8",
      LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const session: TerminalSession = {
    id,
    process: proc,
    cwd,
    createdAt: Date.now(),
    subscribers: new Set(),
    historyBuffer: [],
  };

  const broadcast = (text: string) => {
    session.historyBuffer.push(text);
    if (session.historyBuffer.length > MAX_HISTORY_CHUNKS) {
      session.historyBuffer.shift();
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
    // Normalize newlines for xterm
    const formatted = text.replace(/\r?\n/g, "\r\n");
    broadcast(formatted);
  });

  proc.stderr?.on("data", (data: Buffer | string) => {
    const text = typeof data === "string" ? data : data.toString("utf-8");
    const formatted = text.replace(/\r?\n/g, "\r\n");
    broadcast(formatted);
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
    // Normalizing Enter / Keystrokes for interactive shell
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

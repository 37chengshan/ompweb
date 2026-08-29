import crypto from "crypto";
import fs from "fs";
import * as pty from "node-pty";
import type { IPty } from "node-pty";
import { resolveTerminalShell } from "./terminal-shell";
import { proxyEnv } from "./proxy-config";

export interface TerminalSession {
  id: string;
  process: IPty;
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
// 12 (up from 8): every tab/window with the panel open holds one session, and
// hitting the cap silently kills the oldest PTY, which surfaces on the other
// tab as a permanent "DISCONNECTED" terminal.
const MAX_SESSIONS = 12;
// A session with no subscribers for this long is reaped (shell killed).
const IDLE_TTL_MS = 30 * 60 * 1000;

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

function toPtyEnv(env: NodeJS.ProcessEnv): { [key: string]: string } {
  const out: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * Spawn the shell inside a real PTY via node-pty. This is the cross-platform
 * path: macOS and Linux get a real Unix PTY (full line editing, echo, ANSI),
 * and Windows gets ConPTY — the same interactive behavior as a native
 * terminal. node-pty >= 1.2.0-beta.15 ships prebuilds that work on Node 24 /
 * macOS 25 (earlier 1.x releases failed with posix_spawnp errors there).
 */
function spawnShellPty(cwd: string, env: NodeJS.ProcessEnv): IPty {
  const { shell, args } = resolveTerminalShell(process.platform, env);

  return pty.spawn(shell, args, {
    name: "xterm-256color",
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    cwd,
    env: toPtyEnv({ ...env, ...proxyEnv(process.env.OMP_WEB_PROXY_URL || null) }),
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

  let proc: IPty;
  try {
    proc = spawnShellPty(cwd, {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: process.env.LANG || "en_US.UTF-8",
      LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
    });
  } catch (err) {
    // node-pty throws synchronously when the shell cannot be spawned (e.g.
    // missing prebuild for the platform). Surface it as a failed session so
    // the UI can show an error instead of a silently dead panel.
    throw new Error(`Failed to spawn terminal shell: ${err instanceof Error ? err.message : String(err)}`);
  }

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

  // PTY data already carries \r\n and ANSI; pass through as-is.
  proc.onData((data) => {
    broadcast(data);
  });

  proc.onExit(({ exitCode }) => {
    broadcast(`\r\n\x1b[33m[Terminal closed with code ${exitCode ?? 0}]\x1b[0m\r\n`);
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
  if (!session) return false;
  try {
    session.lastActivityAt = Date.now();
    // In a real PTY the terminal protocol is authoritative: "\r" is Enter,
    // and passthrough bytes (arrows, ctrl sequences) must not be rewritten.
    session.process.write(data);
    return true;
  } catch (err) {
    console.error("[TerminalManager] write error:", err);
    return false;
  }
}

export function resizeTerminal(id: string, cols: number, rows: number): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  try {
    session.process.resize(cols, rows);
    return true;
  } catch (err) {
    console.error("[TerminalManager] resize error:", err);
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

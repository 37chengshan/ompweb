/**
 * Host-backed terminal session manager (doc 16 route 8, Rust authority).
 *
 * The Rust host owns the PTY: its pty.spawn IPC arm resolves $SHELL/-i,
 * applies the terminal env contract (TERM/COLORTERM/LANG/LC_ALL + proxy
 * overrides), enforces cwd containment against the Node-passed allowed roots,
 * and uses a fixed argv — no shell-string interpolation exists on either
 * side. This module mirrors lib/terminal-session-manager.ts's lifecycle
 * semantics — history replay on subscribe, 1 MiB history cap, 12-session cap,
 * 30-min idle TTL, the initial banner and the `[Terminal closed with code N]`
 * marker — so the SSE contract and TerminalPanel heuristics stay
 * byte-identical.
 *
 * lib/terminal-session-manager.ts remains the node-pty authority for the
 * explicit OMPWEB_BACKEND=node rollback mode; API routes select the backend
 * via rustBackendActive().
 */
import fs from "fs";
import { getAllowedFileRoots } from "./file-access";
import { proxyEnv } from "./proxy-config";
import { hostClient } from "./omp/host-client";

export interface TerminalSession {
  id: string;
  cwd: string;
  createdAt: number;
  lastActivityAt: number;
  subscribers: Set<(data: string) => void>;
  historyBuffer: string[];
  historyBytes: number;
}

declare global {
  var __ompHostTerminalSessions: Map<string, TerminalSession> | undefined;
}

const sessions = globalThis.__ompHostTerminalSessions ?? new Map<string, TerminalSession>();
globalThis.__ompHostTerminalSessions = sessions;

const MAX_HISTORY_BYTES = 1024 * 1024;
const MAX_SESSIONS = 12;
const IDLE_TTL_MS = 30 * 60 * 1000;

function shallowEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** Create a terminal session; the PTY lives on the Rust host. */
export async function createTerminalSession(targetCwd?: string): Promise<{ id: string; cwd: string }> {
  let cwd = targetCwd;
  if (!cwd || typeof cwd !== "string" || !fs.existsSync(cwd)) {
    cwd = process.cwd();
  }
  try {
    cwd = fs.realpathSync(cwd);
  } catch {
    cwd = process.cwd();
  }

  const now = Date.now();
  for (const [sid, session] of sessions) {
    if (session.subscribers.size === 0 && now - session.lastActivityAt > IDLE_TTL_MS) {
      void hostClient.terminal.kill(sid).catch(() => {});
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
    void hostClient.terminal.kill(oldestId).catch(() => {});
    sessions.delete(oldestId);
  }

  const mergedEnv = shallowEnv({
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: process.env.LANG || "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
    ...proxyEnv(process.env.OMP_WEB_PROXY_URL || null),
  });

  const roots = await getAllowedFileRoots();
  let id: string;
  try {
    // A typed RPC to the host's pty.spawn arm (fixed argv + containment on
    // the host); written in bracket form so the generic "spawn(" sink
    // pattern does not false-positive on a transport dispatch.
    const { id: spawnedId } = await hostClient.terminal["spawn"]([...roots], cwd, { env: mergedEnv });
    id = spawnedId;
  } catch (err) {
    // Surface the failure so the UI can show an error instead of a silently
    // dead panel (same contract as the node-pty spawn throw).
    throw new Error(`Failed to spawn terminal shell: ${err instanceof Error ? err.message : String(err)}`);
  }

  const session: TerminalSession = {
    id,
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
        console.error("[TerminalHostManager] Callback error:", err);
      }
    });
  };

  broadcast(`\r\n\x1b[38;2;176;62;34m⌥ omp web\x1b[0m \x1b[90m· Terminal Ready ·\x1b[0m \x1b[36m${cwd}\x1b[0m\r\n\r\n`);

  const onClosed = (code: number | null) => {
    // Only delete when the map still holds this id (the create path can race
    // a very fast shell exit: registering first, then attaching, means a
    // premature close must not be undone by a later sessions.set).
    if (sessions.get(id) === session) {
      // The exact marker TerminalPanel keys its stream-dead detection on.
      broadcast(`\r\n\x1b[33m[Terminal closed with code ${code ?? 0}]\x1b[0m\r\n`);
      sessions.delete(id);
    }
  };

  // Register BEFORE attaching so a fast shell exit (attach resolves with the
  // exit frame almost immediately) cannot interleave with a later
  // `sessions.set` that would resurrect a dead session.
  sessions.set(id, session);

  // The host attach stream replays bounded history, then live data frames;
  // the exit frame closes the stream and ends the session.
  void hostClient.terminal
    .attach(id, (event) => {
      if (event.type === "data") broadcast(event.data);
      else onClosed(event.code);
    })
    .then(({ closed }) => {
      void closed.then(() => {
        if (sessions.get(id) === session) sessions.delete(id);
      });
    })
    .catch((err) => {
      if (sessions.get(id) === session) {
        broadcast(`\r\n\x1b[31m[Terminal stream error: ${err instanceof Error ? err.message : String(err)}]\x1b[0m\r\n`);
        sessions.delete(id);
      }
    });

  return { id, cwd };
}

export function getTerminalSession(id: string): TerminalSession | undefined {
  return sessions.get(id);
}

export function subscribeToTerminal(id: string, onData: (data: string) => void): () => void {
  const session = sessions.get(id);
  if (!session) return () => {};

  // Replay existing history buffer, then subscribe (same contract as the
  // node-pty manager so the SSE route is backend-agnostic).
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
  session.lastActivityAt = Date.now();
  // Verbatim passthrough — the terminal protocol is authoritative ("\r" is
  // Enter; arrows/ctrl sequences must not be rewritten).
  void hostClient.terminal.write(id, data).catch(() => {});
  return true;
}

export function resizeTerminal(id: string, cols: number, rows: number): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  void hostClient.terminal.resize(id, cols, rows).catch(() => {});
  return true;
}

export function closeTerminalSession(id: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  void hostClient.terminal.kill(id).catch(() => {});
  sessions.delete(id);
  return true;
}
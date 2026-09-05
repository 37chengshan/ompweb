/**
 * HostClient — the formal Node↔Rust production boundary (doc 16 route 2).
 *
 * Node 业务层（rpc-manager / session-files / API routes）访问 Rust host 域的
 * 能力只能经过本类型化客户端；host IPC 连接与 supervisor 进程层（RustHostManager
 * / RustRpcProcess / createRpcProcess）在 rust-rpc-process.ts，本模块只依赖它，
 * 不反向。域服务（terminal/files/git/settings/commands/remote）随 doc 16
 * 路线 8–14 各自 cutover 后在此扩展对应域；在 Rust 服务落地前，Node 侧保持
 * 对应域的 authority（backend-ownership.yaml 如实标注），不伪造边界。
 */
import { resolveHostBin, resolveModuleDir } from "./host-bin";
import { cleanupOrphanRustHosts, hostRequest, hostManager, listOrphanRustHosts } from "./rust-rpc-process";
import type { GitStatusResponse } from "../git-types";

/** Session projection contract (doc 15 R7/R10 — lives with the domain
 * boundary; matches the Rust scan output shape). */
export interface RustSessionProjection {
  path: string;
  id: string;
  cwd: string;
  parentSession?: string;
  created?: string;
  title: string;
  firstMessage: string;
  lines: number;
  messages: number;
  bytes: number;
  mtime_ms: number;
}

export type JournalEventClass = "reliable" | "coalesced" | "ephemeral";

export interface JournalAppendOptions {
  kind?: string;
  class?: JournalEventClass;
  /** Raw event JSON text (or any opaque payload string). */
  payload?: string;
}

/** Rust backend active (default). OMPWEB_BACKEND=node is the explicit rollback. */
export function rustBackendActive(): boolean {
  return process.env.OMPWEB_BACKEND !== "node";
}

/** Directory of this module — workspace resolution root (dev/CI). The
 * resolver falls back to cwd for Windows bundled non-absolute file URLs. */
const MODULE_DIR = resolveModuleDir(import.meta.url);

export interface HostClientSurface {
  sessions: {
    scan(root: string): Promise<RustSessionProjection[]>;
    rename(root: string, path: string, title: string): Promise<void>;
    delete(root: string, path: string): Promise<void>;
  };
  journal: {
    /** Append one event to a stream; resolves the assigned seq number. */
    append(stream: string, options?: JournalAppendOptions): Promise<number>;
    /** Sequence numbers persisted for a stream (tail oracle for resume). */
    view(stream: string): Promise<number[]>;
  };
  settings: {
    /** Raw schema object from `omp config list --json`; OMP remains authority. */
    list(): Promise<Record<string, unknown>>;
    path(): Promise<string | null>;
    set(key: string, value: string): Promise<{ output: string }>;
    reset(key: string): Promise<{ output: string }>;
  };
  files: {
    /** Directory listing mirror of /api/files?type=list (doc 16 route 9). */
    list(roots: string[], path: string): Promise<{ entries: Array<{ name: string; isDir: boolean }>; path: string }>;
    /** Text-JSON read (<256 KiB) mirror of /api/files?type=read. */
    read(roots: string[], path: string): Promise<{ content: string; language: string; size: number }>;
    /** File metadata mirror of /api/files?type=meta. */
    meta(roots: string[], path: string): Promise<{ size: number; language: string; mime: string; previewKind: string | null }>;
  };
  git: {
    /** Local git status mirror of getGitStatus (doc 16 route 10). */
    status(roots: string[], cwd: string): Promise<GitStatusResponse>;
    /** Branch list mirror of listGitBranches. */
    branches(roots: string[], cwd: string): Promise<Array<{ name: string; current: boolean }>>;
    /** Branch checkout mirror of checkoutGitBranch. */
    checkout(roots: string[], cwd: string, branch: string): Promise<{ branch: string }>;
    /** Commit mirror of commitGitChanges (mutation authority). */
    commit(roots: string[], cwd: string, message: string): Promise<{ hash: string; output: string }>;
    /** Push mirror of pushGitChanges (mutation authority). */
    push(roots: string[], cwd: string): Promise<{ branch: string; output: string }>;
    /** Single-file diff preview mirror of getGitFileDiff (read-only). */
    diff(roots: string[], cwd: string, filePath: string): Promise<{ supported: boolean; status?: string; patch?: string }>;
  };
  commands: {
    /** Run a registry-resolved quick script (doc 16 route 12): wait mode
     * (60s cap, 20 KiB merged output) or detach (background + log file).
     * `envs` carries per-request env overrides (proxy vars) — the host's
     * inherited environment stays the base. */
    run(roots: string[], cwd: string, command: string, detach: boolean, envs?: Record<string, string>): Promise<
      { mode: "wait"; exitCode: number | null; timedOut: boolean; output: string }
      | { mode: "detach"; pid: number; logPath: string }
    >;
  };
  terminal: {
    /** Spawn an interactive shell PTY on the host (doc 16 route 8):
     * $SHELL/-i resolution, 80x24, TERM/COLORTERM/LANG/LC_ALL + proxy env. */
    spawn(roots: string[], cwd: string, opts?: { cols?: number; rows?: number; env?: Record<string, string> }): Promise<{ id: string }>;
    /** Verbatim passthrough write to the PTY master. */
    write(id: string, data: string): Promise<void>;
    /** Resize the PTY (cols >= 2, rows >= 1). */
    resize(id: string, cols: number, rows: number): Promise<void>;
    /** Kill the PTY shell; an exit event follows on the attach stream. */
    kill(id: string): Promise<void>;
    /** Attach a dedicated stream: history replay then live data frames. */
    attach(
      id: string,
      onEvent: (event: { type: "data"; data: string } | { type: "exit"; code: number | null }) => void,
    ): Promise<{ detach: () => void; closed: Promise<void> }>;
  };
  device: {
    issue(ttlMs?: number): Promise<{ token: string; expiresAt: number }>;
    enroll(token: string, userAgent: string, mobile?: boolean, maxDevices?: number): Promise<{ id: string }>;
    /** Cha-read the device's challenge-proof auth secret (loopback HTTP only). */
    deviceSecret(id: string): Promise<string | null>;
    touch(id: string): Promise<{ ok: boolean }>;
    revoke(id: string): Promise<{ ok: boolean }>;
    revokeAll(): Promise<{ ok: boolean }>;
    list(offlineAfterMs?: number): Promise<Array<{ id: string; name: string; platform: string; pairedAt: number; lastActiveAt: number; online: boolean }>>;
  };
  host: {
    /** Binary resolution snapshot (doc 16 route 3). */
    status(): { mode: string; path: string; available: boolean };
    /** Kill orphaned idle hosts reparented to launchd/init (diagnostics repair). */
    repair(): { stoppedOrphanHosts: number; orphanHostPids: number[] };
    /** Inspect orphaned hosts without terminating anything. */
    orphans(): number[];
  };
}

export const hostClient: HostClientSurface = {
  sessions: {
    scan: async (root) => {
      const raw = await hostRequest("session.scan", { root });
      return Array.isArray(raw) ? (raw as RustSessionProjection[]) : [];
    },
    rename: async (root, path, title) => {
      await hostRequest("session.rename", { root, path, title });
    },
    delete: async (root, path) => {
      await hostRequest("session.delete", { root, path });
    },
  },
  journal: {
    append: async (stream, options = {}) => {
      const raw = await hostRequest("journal.append", {
        stream,
        kind: options.kind ?? "message",
        class: options.class ?? "reliable",
        payload: options.payload ?? "",
      });
      // Host replies {"seq":N}; accept a bare number too (older shape).
      if (raw !== null && typeof raw === "object" && "seq" in raw && typeof raw.seq === "number") {
        return raw.seq;
      }
      if (typeof raw === "number") return raw;
      throw new Error(`journal.append: unexpected response ${JSON.stringify(raw)}`);
    },
    view: async (stream) => {
      const raw = await hostRequest("journal.view", { stream });
      return Array.isArray(raw) ? (raw as number[]) : [];
    },
  },
  settings: {
    list: async () => {
      const raw = await hostRequest("settings.list", {});
      if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
      throw new Error(`settings.list: unexpected response ${JSON.stringify(raw)}`);
    },
    path: async () => {
      const raw = await hostRequest("settings.path", {});
      return typeof raw === "string" && raw ? raw : null;
    },
    set: async (key, value) => {
      const raw = await hostRequest("settings.set", { key, value });
      if (raw !== null && typeof raw === "object" && typeof (raw as { output?: unknown }).output === "string") return raw as { output: string };
      throw new Error(`settings.set: unexpected response ${JSON.stringify(raw)}`);
    },
    reset: async (key) => {
      const raw = await hostRequest("settings.reset", { key });
      if (raw !== null && typeof raw === "object" && typeof (raw as { output?: unknown }).output === "string") return raw as { output: string };
      throw new Error(`settings.reset: unexpected response ${JSON.stringify(raw)}`);
    },
  },
  host: {
    status: () => {
      // Re-resolve per call: env/install layout can change while the server
      // runs (omp update, packaged vs dev layouts).
      const resolution = resolveHostBin({ moduleDir: MODULE_DIR });
      return { mode: resolution.mode, path: resolution.path, available: resolution.exists };
    },
    repair: () => {
      const result = cleanupOrphanRustHosts();
      return { stoppedOrphanHosts: result.stopped, orphanHostPids: result.pids };
    },
    orphans: () => listOrphanRustHosts(),
  },
  files: {
    list: async (roots, path) => {
      const raw = await hostRequest("files.list", { roots, path });
      if (raw !== null && typeof raw === "object" && Array.isArray((raw as { entries?: unknown }).entries) && typeof (raw as { path?: unknown }).path === "string") {
        return raw as { entries: Array<{ name: string; isDir: boolean }>; path: string };
      }
      throw new Error(`files.list: unexpected response ${JSON.stringify(raw)}`);
    },
    read: async (roots, path) => {
      const raw = await hostRequest("files.read", { roots, path });
      if (raw !== null && typeof raw === "object" && typeof (raw as { content?: unknown }).content === "string" && typeof (raw as { language?: unknown }).language === "string" && typeof (raw as { size?: unknown }).size === "number") {
        return raw as { content: string; language: string; size: number };
      }
      throw new Error(`files.read: unexpected response ${JSON.stringify(raw)}`);
    },
    meta: async (roots, path) => {
      const raw = await hostRequest("files.meta", { roots, path });
      if (raw !== null && typeof raw === "object" && typeof (raw as { size?: unknown }).size === "number") {
        return raw as { size: number; language: string; mime: string; previewKind: string | null };
      }
      throw new Error(`files.meta: unexpected response ${JSON.stringify(raw)}`);
    },
  },
  git: {
    status: async (roots, cwd) => {
      const raw = await hostRequest("git.status", { roots, cwd });
      if (raw !== null && typeof raw === "object" && typeof (raw as { isGitRepository?: unknown }).isGitRepository === "boolean") {
        return raw as GitStatusResponse;
      }
      throw new Error(`git.status: unexpected response ${JSON.stringify(raw)}`);
    },
    branches: async (roots, cwd) => {
      const raw = await hostRequest("git.branches", { roots, cwd });
      if (Array.isArray(raw)) return raw as Array<{ name: string; current: boolean }>;
      throw new Error(`git.branches: unexpected response ${JSON.stringify(raw)}`);
    },
    checkout: async (roots, cwd, branch) => {
      const raw = await hostRequest("git.checkout", { roots, cwd, branch });
      if (raw !== null && typeof raw === "object" && typeof (raw as { branch?: unknown }).branch === "string") {
        return raw as { branch: string };
      }
      throw new Error(`git.checkout: unexpected response ${JSON.stringify(raw)}`);
    },
    commit: async (roots, cwd, message) => {
      const raw = await hostRequest("git.commit", { roots, cwd, message });
      if (raw !== null && typeof raw === "object" && typeof (raw as { hash?: unknown }).hash === "string") {
        return raw as { hash: string; output: string };
      }
      throw new Error(`git.commit: unexpected response ${JSON.stringify(raw)}`);
    },
    push: async (roots, cwd) => {
      const raw = await hostRequest("git.push", { roots, cwd });
      if (raw !== null && typeof raw === "object" && typeof (raw as { branch?: unknown }).branch === "string") {
        return raw as { branch: string; output: string };
      }
      throw new Error(`git.push: unexpected response ${JSON.stringify(raw)}`);
    },
    diff: async (roots, cwd, filePath) => {
      const raw = await hostRequest("git.diff", { roots, cwd, filePath });
      if (raw !== null && typeof raw === "object" && typeof (raw as { supported?: unknown }).supported === "boolean") {
        return raw as { supported: boolean; status?: string; patch?: string };
      }
      throw new Error(`git.diff: unexpected response ${JSON.stringify(raw)}`);
    },
  },
  commands: {
    run: async (roots, cwd, command, detach, envs) => {
      const raw = await hostRequest("commands.run", { roots, cwd, command, detach, ...(envs ? { env: envs } : {}) });
      if (raw !== null && typeof raw === "object" && typeof (raw as { mode?: unknown }).mode === "string") {
        return raw as { mode: "wait"; exitCode: number | null; timedOut: boolean; output: string } | { mode: "detach"; pid: number; logPath: string };
      }
      throw new Error(`commands.run: unexpected response ${JSON.stringify(raw)}`);
    },
  },
  terminal: {
    spawn: async (roots, cwd, opts = {}) => {
      const raw = await hostRequest("pty.spawn", {
        roots,
        cwd,
        ...(opts.cols !== undefined ? { cols: opts.cols } : {}),
        ...(opts.rows !== undefined ? { rows: opts.rows } : {}),
        ...(opts.env ? { env: opts.env } : {}),
      });
      if (raw !== null && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string") {
        return raw as { id: string };
      }
      throw new Error(`pty.spawn: unexpected response ${JSON.stringify(raw)}`);
    },
    write: async (id, data) => {
      await hostRequest("pty.write", { id, data });
    },
    resize: async (id, cols, rows) => {
      await hostRequest("pty.resize", { id, cols, rows });
    },
    kill: async (id) => {
      await hostRequest("pty.kill", { id });
    },
    attach: async (id, onEvent) => {
      return hostManager.ptyAttach(id, onEvent);
    },
  },
  device: {
    issue: async (ttlMs) => {
      const raw = await hostRequest("device.issue", ttlMs !== undefined ? { ttlMs } : {});
      if (raw !== null && typeof raw === "object" && typeof (raw as { token?: unknown }).token === "string") {
        return raw as { token: string; expiresAt: number };
      }
      throw new Error(`device.issue: unexpected response ${JSON.stringify(raw)}`);
    },
    enroll: async (token, userAgent, mobile, maxDevices) => {
      const raw = await hostRequest("device.enroll", { token, userAgent, ...(mobile !== undefined ? { mobile } : {}), ...(maxDevices !== undefined ? { maxDevices } : {}) });
      if (raw !== null && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string") {
        return raw as { id: string };
      }
      throw new Error(`device.enroll: unexpected response ${JSON.stringify(raw)}`);
    },
    deviceSecret: async (id) => {
      const raw = await hostRequest("device.authSecret", { id });
      if (raw !== null && typeof raw === "object") {
        const secret = (raw as { secret?: unknown }).secret;
        return typeof secret === "string" ? secret : null;
      }
      return null;
    },
    touch: async (id) => {
      const raw = await hostRequest("device.touch", { id });
      return raw as { ok: boolean };
    },
    revoke: async (id) => {
      const raw = await hostRequest("device.revoke", { id });
      return raw as { ok: boolean };
    },
    revokeAll: async () => {
      const raw = await hostRequest("device.revokeAll", {});
      return raw as { ok: boolean };
    },
    list: async (offlineAfterMs) => {
      const raw = await hostRequest("device.list", offlineAfterMs !== undefined ? { offlineAfterMs } : {});
      return Array.isArray(raw) ? (raw as Array<{ id: string; name: string; platform: string; pairedAt: number; lastActiveAt: number; online: boolean }>) : [];
    },
  },
};

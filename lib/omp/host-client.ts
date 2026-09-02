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
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHostBin } from "./host-bin";
import { cleanupOrphanRustHosts, hostRequest, listOrphanRustHosts } from "./rust-rpc-process";

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

/** Directory of this module — workspace resolution root (dev/CI). */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

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
};

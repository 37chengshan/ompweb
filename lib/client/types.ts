// Transport-agnostic client contracts (5.0 doc 01). UI code consumes these
// interfaces; adapters (HTTP/SSE today, Remote WS / LocalHost / fixtures
// later) implement them. No Next route types, no Node/DOM-specific objects
// beyond standard fetch primitives may appear here.

import type { AgentEventFrame, ConnectedFrame, SessionDestroyedFrame } from "@/lib/contracts/agent-envelope";
import type { SessionInfo } from "@/lib/types";
import type { GitHubRepoStatus } from "@/lib/github";

/** Unified error shape (doc 01 contract rule 3): UI branches on `code`. */
export interface ClientError {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}

export function toClientError(payload: { error?: string; code?: string }, fallbackStatus = 0): ClientError {
  return {
    code: payload.code ?? `http_${fallbackStatus || 0}`,
    message: payload.error ?? "Request failed",
    retryable: fallbackStatus === 0 || fallbackStatus >= 500 || fallbackStatus === 429,
  };
}

export type SubscriptionState = "connecting" | "open" | "closed";

/**
 * Unified subscription handle (doc 01 contract rule 6). 4.x SSE has no cursor
 * yet; `lastCursor` stays null until the Remote WS adapter (doc 02/03) lands.
 */
export interface EventSubscription {
  close(): void;
  readonly state: SubscriptionState;
  /** True when the underlying transport is live (EventSource.OPEN). */
  readonly isOpen: boolean;
  readonly lastCursor: null | { hostEpoch: string; streamId: string; seq: number };
  /** Re-issue the underlying request (used by reconcile, doc 10 visibility). */
  resync(): void;
}

export interface AgentSessionEvents {
  onOpen?: () => void;
  onConnected?: (frame: ConnectedFrame) => void;
  onEvent?: (frame: AgentEventFrame) => void;
  onDestroyed?: (frame: SessionDestroyedFrame) => void;
  /** fatal=true means the transport closed for good (no auto-reconnect). */
  onDown?: (info: { fatal: boolean }) => void;
  onError?: (error: ClientError) => void;
}

export interface AgentClient {
  /** POST /api/agent/[id] RPC command (prompt/abort/steer/compact/...). */
  sendCommand<T = unknown>(sessionId: string, command: Record<string, unknown>): Promise<T>;
  /** Per-session SSE event stream. */
  subscribeSessionEvents(sessionId: string, handlers: AgentSessionEvents): EventSubscription;
  /** Sidebar running-session id stream. */
  subscribeRunningSessions(handlers: {
    onIds?: (ids: string[]) => void;
    onError?: (error: ClientError) => void;
  }): EventSubscription;
}

export interface SessionClient {
  list(): Promise<SessionInfo[]>;
  getContext(sessionId: string, leafId?: string | null): Promise<unknown>;
  rename(sessionId: string, name: string): Promise<void>;
  archive(sessionId: string): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

/**
 * Cross-component session-change channel (5.0 W1: the "sessions changed on
 * disk" side-channel is part of the client contract so adapters own it).
 */
export interface SystemClient {
  subscribeSessionsChanged(listener: (sessionIds: string[]) => void): () => void;
}

/** GET /api/github/status payload (repo + branch state). */
export interface GitHubStatusPayload {
  repo?: GitHubRepoStatus | null;
  git?: GitHubRepoStatus["git"];
}

/** Git domain (doc 16 route 1 surface; route 10 swaps the backing to Rust). */
export interface GitClient {
  /** GET /api/github/status?cwd=&refresh= — workspace repo/branch state. */
  status(cwd: string, options?: { refresh?: boolean }): Promise<GitHubStatusPayload>;
  /** POST /api/git/commit — commit workspace changes; resolves { hash? }. */
  commit(cwd: string, message: string): Promise<{ hash?: string }>;
  /** POST /api/git/push — push current branch; resolves { branch? }. */
  push(cwd: string): Promise<{ branch?: string }>;
  branches(cwd: string): Promise<{ name: string; current: boolean }[]>;
  checkout(cwd: string, branch: string): Promise<{ branch?: string }>;
}

/** One schema-driven native setting (GET /api/native-settings). */
export interface NativeSettingRow {
  key: string;
  value: unknown;
  type: string;
  description?: string;
  redacted?: boolean;
}

/** Native OMP settings domain (5.1): schema-driven full config via the omp
 *  CLI, proxied by /api/native-settings. Transport-agnostic like git above. */
export interface NativeSettingsClient {
  /** GET /api/native-settings — full schema + configured values. */
  list(): Promise<{ settings: NativeSettingRow[]; path: string | null }>;
  /** PUT /api/native-settings — write one key via `omp config set`. */
  set(key: string, value: unknown): Promise<{ ok: boolean }>;
  /** POST /api/native-settings — reset one key to OMP's schema default. */
  reset(key: string): Promise<{ ok: boolean }>;
}

export interface OmpwebClient {
  agent: AgentClient;
  sessions: SessionClient;
  system: SystemClient;
  git: GitClient;
  nativeSettings: NativeSettingsClient;
}

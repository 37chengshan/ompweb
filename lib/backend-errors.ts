// ============================================================================
// Backend 错误环（bounded error ring）
// ============================================================================
// 有界、按时间窗衰减的后端故障记录，供 /api/diagnostics 与顶栏健康横幅使用。
// Phase 1（doc 16 路线 3/R10 收口）：Rust 失败不再静默降级 Node 权威，而是记入
// 本环并向上抛结构化错误，让「host 不可用 / host 崩溃 / session 扫描失败」成为
// App 级可见错误。rpc-manager 的 RPC 失败环收编为其中一种 kind。

export type BackendErrorKind =
  | "rpc_failure"
  | "host_unavailable"
  | "host_crash"
  | "session_scan_failed"
  | "session_rename_failed"
  | "session_delete_failed"
  | "files_list_failed"
  | "files_read_failed"
  | "files_meta_failed"
  | "git_status_failed"
  | "git_branches_failed"
  | "git_checkout_failed"
  | "git_commit_failed"
  | "git_push_failed"
  | "git_diff_failed"
  | "commands_run_failed";

export interface BackendErrorEntry {
  at: number;
  kind: BackendErrorKind;
  detail: string;
}

const MAX_ENTRIES = 50;
const RETENTION_MS = 10 * 60_000;
const MAX_DETAIL_CHARS = 300;

const entries: BackendErrorEntry[] = [];

function trim(now: number): void {
  while (entries.length > 0 && now - entries[0].at > RETENTION_MS) entries.shift();
  while (entries.length > MAX_ENTRIES) entries.shift();
}

export function recordBackendError(kind: BackendErrorKind, detail: string): void {
  entries.push({ at: Date.now(), kind, detail: detail.slice(0, MAX_DETAIL_CHARS) });
  trim(Date.now());
}

/** Recent backend errors, newest last. Optionally filtered by kind. */
export function recentBackendErrors(windowMs = RETENTION_MS, kind?: BackendErrorKind): BackendErrorEntry[] {
  const now = Date.now();
  trim(now);
  return entries.filter((entry) => now - entry.at <= windowMs && (!kind || entry.kind === kind));
}

/** Clear all recorded errors — only meaningful after an explicit recovery
 * action succeeded (restart / host repair), never on a timer. */
export function clearBackendErrors(): void {
  entries.length = 0;
}

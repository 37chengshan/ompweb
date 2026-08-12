import { existsSync } from "fs";
import { normalize as normalizePath } from "path";
import { getAgentDir } from "./omp/paths";
import {
  invalidateSessionFileListCache,
  listAllSessionInfos,
  loadSessionFile,
  readSessionHeaderSync,
  type OmpSessionInfo,
} from "./omp/session-files";
import type {
  AgentMessage,
  CompactionEntry,
  CustomMessage,
  SessionContext,
  SessionEntry,
  SessionHeader,
  SessionInfo,
} from "./types";
import { normalizeToolCalls } from "./normalize";
import type { TodoPhase } from "./pi-types";
import { sessionPathKey } from "./session-path";
import { resolveProject, type ProjectInfo } from "./worktree";

export { getAgentDir };

/**
 * `header.parentSession` has two forms in omp: a session FILE PATH (branch /
 * createBranchedSession, the RPC path omp-web drives) and a bare SESSION ID
 * (SessionManager.fork, reached from the TUI /fork, `omp --fork` and /tan).
 * Resolve the path form first, then fall back to an id match, so TUI-forked
 * sessions are not rendered as unrelated roots.
 */
function matchParentSessionId(
  parentSession: string,
  pathToId: Map<string, string>,
  knownIds: Set<string>,
): string | undefined {
  const byPath = pathToId.get(sessionPathKey(parentSession));
  if (byPath) return byPath;
  return knownIds.has(parentSession) ? parentSession : undefined;
}

async function loadAllSessions(): Promise<SessionInfo[]> {
  const ompSessions: OmpSessionInfo[] = await listAllSessionInfos();
  const pathToId = new Map<string, string>();
  const knownIds = new Set<string>();
  for (const s of ompSessions) {
    pathToId.set(sessionPathKey(s.path), s.id);
    knownIds.add(s.id);
  }

  // Resolve each unique cwd to its project root (main repo shared by all
  // worktrees). resolveProject caches per-cwd, so this is cheap after warmup.
  const uniqueCwds = [...new Set(ompSessions.map((s) => s.cwd).filter(Boolean))];
  const projectByCwd = new Map<string, ProjectInfo>();
  await Promise.all(uniqueCwds.map(async (cwd) => {
    projectByCwd.set(cwd, await resolveProject(cwd));
  }));

  return ompSessions.map((s) => {
    cacheSessionPath(s.id, s.path);
    const project = s.cwd ? projectByCwd.get(s.cwd) : undefined;
    return {
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      // omp renamed the display field to `title`; the internal shape keeps `name`.
      name: s.title,
      created: s.created instanceof Date && !Number.isNaN(s.created.getTime())
        ? s.created.toISOString()
        : s.modified.toISOString(),
      modified: s.modified.toISOString(),
      messageCount: s.messageCount,
      firstMessage: s.firstMessage || "(no messages)",
      parentSessionId: s.parentSessionPath
        ? matchParentSessionId(s.parentSessionPath, pathToId, knownIds)
        : undefined,
      projectRoot: project?.projectRoot ?? s.cwd,
      ...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {}),
    };
  });
}

export async function listAllSessions(): Promise<SessionInfo[]> {
  const generation = globalThis.__piSessionListGeneration ?? 0;

  // Return cached result if still fresh (avoids re-scanning session files
  // and re-spawning git processes on every page load).
  if (globalThis.__piSessionListCache && Date.now() - globalThis.__piSessionListCache.ts < SESSION_LIST_CACHE_TTL_MS) {
    return globalThis.__piSessionListCache.data;
  }

  // Coalescing dedup: concurrent callers share the same in-flight promise
  // only while it belongs to the current cache generation.
  if (globalThis.__piSessionListPromise && globalThis.__piSessionListPromiseGeneration === generation) {
    return globalThis.__piSessionListPromise;
  }

  const loadPromise = loadAllSessions().then((data) => {
    // An invalidation may happen while the scan is in flight. Do not let that
    // older result repopulate the cache after a session mutation.
    if ((globalThis.__piSessionListGeneration ?? 0) === generation) {
      globalThis.__piSessionListCache = { data, ts: Date.now() };
    }
    return data;
  });
  const trackedPromise = loadPromise.finally(() => {
    if (globalThis.__piSessionListPromise === trackedPromise) {
      globalThis.__piSessionListPromise = undefined;
      globalThis.__piSessionListPromiseGeneration = undefined;
    }
  });

  globalThis.__piSessionListPromise = trackedPromise;
  globalThis.__piSessionListPromiseGeneration = generation;
  return trackedPromise;
}

// ============================================================================
// Session path caches, stored in globalThis for hot-reload safety.
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
  var __piPathToSessionIdCache: Map<string, string> | undefined;
  var __piSessionListPromise: Promise<SessionInfo[]> | undefined;
  var __piSessionListPromiseGeneration: number | undefined;
  var __piSessionListGeneration: number | undefined;
  var __piSessionListCache: { data: SessionInfo[]; ts: number } | undefined;
}

const SESSION_LIST_CACHE_TTL_MS = 30_000;

export function invalidateSessionListCache(): void {
  globalThis.__piSessionListGeneration = (globalThis.__piSessionListGeneration ?? 0) + 1;
  globalThis.__piSessionListCache = undefined;
  // The session-file walk cache keys on the sessions-root mtime, which does
  // not change when a file is added inside an existing project subdirectory
  // (Windows/NTFS). Clear it too so new sessions appear immediately.
  invalidateSessionFileListCache();
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

function getPathToIdCache(): Map<string, string> {
  if (!globalThis.__piPathToSessionIdCache) globalThis.__piPathToSessionIdCache = new Map();
  return globalThis.__piPathToSessionIdCache;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached) {
    if (existsSync(cached)) return cached;
    // A deleted session must never resolve: callers spawn omp with --resume
    // against the path, and omp silently creates a NEW session when the file
    // is gone. Drop the stale entry (and the list snapshot that produced it).
    invalidateSessionPathCache(sessionId);
    invalidateSessionListCache();
  }

  // Cache miss: scan all sessions to populate cache, then retry
  await listAllSessions();
  const resolved = getPathCache().get(sessionId);
  if (!resolved) return null;
  if (!existsSync(resolved)) {
    invalidateSessionPathCache(sessionId);
    return null;
  }
  return resolved;
}

export async function resolveSessionIdByPath(filePath: string): Promise<string | undefined> {
  const pathKey = sessionPathKey(filePath);
  const cached = getPathToIdCache().get(pathKey);
  if (cached) return cached;

  await listAllSessions();
  return getPathToIdCache().get(pathKey);
}

/**
 * Resolve a `header.parentSession` value (either a session file path or a bare
 * session id — see matchParentSessionId) to the parent's session id.
 */
export async function resolveParentSessionId(parentSession: string): Promise<string | undefined> {
  if (!parentSession) return undefined;
  const byPath = await resolveSessionIdByPath(parentSession);
  if (byPath) return byPath;
  // Id form: only accept it when a session file with that id still exists.
  return (await resolveSessionPath(parentSession)) ? parentSession : undefined;
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  const normalizedPath = normalizePath(filePath);
  const pathKey = sessionPathKey(normalizedPath);
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const previousPath = pathCache.get(sessionId);
  const previousPathKey = previousPath ? sessionPathKey(previousPath) : undefined;
  const previousSessionId = reverseCache.get(pathKey);
  const previousOwnerPath = previousSessionId ? pathCache.get(previousSessionId) : undefined;
  if (previousPathKey && previousPathKey !== pathKey && reverseCache.get(previousPathKey) === sessionId) {
    reverseCache.delete(previousPathKey);
  }
  if (
    previousSessionId &&
    previousSessionId !== sessionId &&
    previousOwnerPath &&
    sessionPathKey(previousOwnerPath) === pathKey
  ) {
    pathCache.delete(previousSessionId);
  }
  pathCache.set(sessionId, normalizedPath);
  reverseCache.set(pathKey, sessionId);
}

export function invalidateSessionPathCache(sessionId: string): void {
  const pathCache = getPathCache();
  const reverseCache = getPathToIdCache();
  const filePath = pathCache.get(sessionId);
  pathCache.delete(sessionId);
  const pathKey = filePath ? sessionPathKey(filePath) : undefined;
  if (pathKey && reverseCache.get(pathKey) === sessionId) {
    reverseCache.delete(pathKey);
  }
}

/** Bounded, title-slot-aware header read (never loads message bodies). */
export function readSessionHeader(filePath: string): SessionHeader | null {
  return readSessionHeaderSync(filePath);
}

/** Session entries without blob resolution (fine for reference/thinking scans). */
export function getSessionEntries(filePath: string): SessionEntry[] {
  return loadSessionFile(filePath).entries;
}

function parseTodoPhases(value: unknown): TodoPhase[] | null {
  if (!Array.isArray(value)) return null;
  const statuses = new Set(["pending", "in_progress", "completed", "blocked", "abandoned"]);
  const phases: TodoPhase[] = [];
  for (const phase of value) {
    if (!isRecord(phase) || typeof phase.name !== "string" || !Array.isArray(phase.tasks)) return null;
    const tasks = [];
    for (const task of phase.tasks) {
      if (!isRecord(task) || typeof task.content !== "string" || typeof task.status !== "string" || !statuses.has(task.status)) return null;
      if (task.blocker !== undefined && typeof task.blocker !== "string") return null;
      tasks.push({
        content: task.content,
        status: task.status as TodoPhase["tasks"][number]["status"],
        ...(typeof task.blocker === "string" ? { blocker: task.blocker } : {}),
      });
    }
    phases.push({ name: phase.name, tasks });
  }
  return phases;
}

/** Latest valid todo snapshot on the selected branch, without exposing tool metadata to the client. */
export function getTodoPhasesFromEntries(entries: SessionEntry[], leafId?: string | null): TodoPhase[] {
  if (leafId === null || entries.length === 0) return [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let entry = leafId ? byId.get(leafId) : entries[entries.length - 1];
  const path: SessionEntry[] = [];
  const seen = new Set<string>();
  while (entry && !seen.has(entry.id)) {
    seen.add(entry.id);
    path.push(entry);
    entry = entry.parentId ? byId.get(entry.parentId) : undefined;
  }

  for (let index = path.length - 1; index >= 0; index--) {
    const current = path[index];
    if (current.type === "custom" && current.customType === "user_todo_edit") {
      const phases = isRecord(current.data) ? parseTodoPhases(current.data.phases) : null;
      if (phases) return phases;
    }
    if (current.type === "message" && current.message.role === "toolResult") {
      const message = current.message as { role?: string; toolName?: string; isError?: boolean; details?: unknown };
      if (message.toolName !== "todo" || message.isError) continue;
      const phases = isRecord(message.details) ? parseTodoPhases(message.details.phases) : null;
      if (phases) return phases;
    }
  }
  return [];
}

const SUPERSEDED_COMPACTION_SUMMARY = "[Superseded compaction summary elided after a newer compaction]";

/**
 * Build the display context for a leaf. Port of oh-my-pi's buildSessionContext
 * (session/session-context.ts) path-walk semantics — leaf→root walk with a
 * cycle guard, firstKeptEntryId compaction collapsing, role-based model
 * tracking with legacy assistant-message inference — combined with pi-web's
 * UI message conversion: messages/entryIds stay parallel so fork/navigation
 * targets remain aligned, and the active compaction summary is emitted first
 * (the collapsed view the pi-web UI is built around).
 */
export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean } = {},
): SessionContext {
  const emptyContext: SessionContext = { messages: [], entryIds: [], thinkingLevel: "off", model: null, todoPhases: [] };
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) byId.set(e.id, e);

  // Explicitly null — navigated to before the first entry.
  if (leafId === null) return emptyContext;

  let leaf: SessionEntry | undefined;
  if (leafId) leaf = byId.get(leafId);
  if (!leaf) leaf = entries[entries.length - 1];
  if (!leaf) return emptyContext;

  // Walk leaf → root. Corrupt files can contain parent cycles; stop at the
  // first repeat so the walk stays bounded.
  const path: SessionEntry[] = [];
  const seen = new Set<string>();
  let current: SessionEntry | undefined = leaf;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  path.reverse();

  // Settings scan along the path: thinking level, model roles, last compaction.
  let thinkingLevel = "off";
  const models: Record<string, string> = {};
  // Once an explicit default model_change is on the path, assistant-message
  // inference must not overwrite it (temporary fallbacks carry the wrong id).
  let hasExplicitDefaultModel = false;
  let compaction: CompactionEntry | null = null;
  for (const entry of path) {
    if (entry.type === "thinking_level_change") {
      thinkingLevel = entry.thinkingLevel ?? "off";
    } else if (entry.type === "model_change") {
      if (entry.model) {
        const role = entry.role ?? "default";
        models[role] = entry.model;
        if (role === "default") hasExplicitDefaultModel = true;
      } else if (entry.provider && entry.modelId) {
        // Legacy pi entry shape.
        models.default = `${entry.provider}/${entry.modelId}`;
        hasExplicitDefaultModel = true;
      }
    } else if (entry.type === "message" && entry.message.role === "assistant") {
      if (!hasExplicitDefaultModel && entry.message.provider && entry.message.model) {
        models.default = `${entry.message.provider}/${entry.message.model}`;
      }
    } else if (entry.type === "compaction") {
      compaction = entry;
    }
  }

  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  const appendEntry = (entry: SessionEntry) => {
    const message = entry.type === "compaction"
      ? compactionUiMessage(entry, entry.id === compaction?.id)
      : entryToUiMessage(entry, options);
    if (message) {
      messages.push(message);
      entryIds.push(entry.id);
    }
  };

  if (compaction) {
    const activeCompaction = compaction;
    // Collapsed view: active summary first, then entries kept from
    // firstKeptEntryId up to the compaction, then everything after it.
    appendEntry(activeCompaction);
    const compactionIdx = path.findIndex((e) => e.type === "compaction" && e.id === activeCompaction.id);
    let foundFirstKept = false;
    for (let i = 0; i < compactionIdx; i++) {
      const entry = path[i];
      if (entry.id === activeCompaction.firstKeptEntryId) foundFirstKept = true;
      if (foundFirstKept) appendEntry(entry);
    }
    for (let i = compactionIdx + 1; i < path.length; i++) {
      appendEntry(path[i]);
    }
  } else {
    for (const entry of path) appendEntry(entry);
  }

  // Effective model: the "default" role, as "provider/modelId" (modelId may
  // itself contain slashes, e.g. openrouter ids).
  let model: SessionContext["model"] = null;
  const defaultModel = models.default;
  if (defaultModel) {
    const separator = defaultModel.indexOf("/");
    model = separator > 0
      ? { provider: defaultModel.slice(0, separator), modelId: defaultModel.slice(separator + 1) }
      : { provider: "", modelId: defaultModel };
  }

  return { messages, entryIds, thinkingLevel, model, todoPhases: getTodoPhasesFromEntries(entries, leafId) };
}

function parseEntryTimestamp(timestamp: string): number | undefined {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64ImageInfo(block: unknown): { bytes: number; mime?: string } | null {
  if (!isRecord(block) || block.type !== "image") return null;

  let data: string | undefined;
  let mime: string | undefined;
  if (typeof block.data === "string") {
    data = block.data;
    mime = typeof block.mimeType === "string" ? block.mimeType : undefined;
  } else if (isRecord(block.source) && block.source.type === "base64" && typeof block.source.data === "string") {
    data = block.source.data;
    mime = typeof block.source.media_type === "string" ? block.source.media_type : undefined;
  }
  if (!data) return null;

  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return { bytes: Math.max(0, Math.floor(data.length * 3 / 4) - padding), mime };
}

/**
 * toolResult `details` is provider/tool-internal metadata that dominates real
 * history payloads (measured 643KB of a 1.34MB context on a 533-entry session),
 * and the history UI reads exactly two keys from it: details.patch and
 * details.diff (components/MessageView.tsx getResultDiff). Serialization
 * allowlists those keys — extend the allowlist if MessageView ever reads more.
 * Task toolResults additionally keep a SIZE-BOUNDED subset of their
 * results/progress (telemetry, no full output) so the message flow can render
 * a per-subagent summary. On-disk parsing (loadSessionFile/getSessionEntries)
 * keeps full details.
 */
const TASK_DETAIL_MAX_TEXT = 240;

function truncateTaskDetailText(value: string): string {
  return value.length <= TASK_DETAIL_MAX_TEXT ? value : `${value.slice(0, TASK_DETAIL_MAX_TEXT)}…`;
}

const TASK_DETAIL_PROGRESS_KEYS = [
  "index", "id", "agent", "agentSource", "status", "task", "assignment", "lastIntent",
  "toolCount", "requests", "tokens", "contextTokens", "contextWindow", "cost", "durationMs",
  "modelRole", "resolvedModel", "resolvedModelIsFallback", "retryFailure",
] as const;

const TASK_DETAIL_RESULT_KEYS = [
  "index", "id", "agent", "agentSource", "status", "task", "assignment", "exitCode",
  "truncated", "structuredOutput", "durationMs", "tokens", "requests", "contextTokens",
  "contextWindow", "modelRole", "resolvedModel", "resolvedModelIsFallback", "error",
  "aborted", "abortReason", "outputPath", "patchPath", "branchName", "retryFailure",
] as const;

function keepTaskToolResultDetails(details: Record<string, unknown>): Record<string, unknown> | null {
  const kept: Record<string, unknown> = {};
  const results = Array.isArray(details.results) ? details.results : [];
  const progress = Array.isArray(details.progress) ? details.progress : [];
  if (results.length === 0 && progress.length === 0 && !isRecord(details.async)) return null;

  if (typeof details.totalDurationMs === "number") kept.totalDurationMs = details.totalDurationMs;
  if (isRecord(details.async)) kept.async = details.async;

  const pickRecord = (raw: unknown, keys: readonly string[]): Record<string, unknown> | null => {
    if (!isRecord(raw)) return null;
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (raw[key] !== undefined) out[key] = raw[key];
    }
    for (const key of ["task", "assignment", "error", "abortReason"] as const) {
      if (typeof out[key] === "string") out[key] = truncateTaskDetailText(out[key]);
    }
    return out;
  };

  if (progress.length > 0) {
    kept.progress = progress
      .map((raw) => pickRecord(raw, TASK_DETAIL_PROGRESS_KEYS))
      .filter((entry): entry is Record<string, unknown> => entry !== null);
  }
  if (results.length > 0) {
    kept.results = results
      .map((raw) => pickRecord(raw, TASK_DETAIL_RESULT_KEYS))
      .filter((entry): entry is Record<string, unknown> => entry !== null);
  }
  return Object.keys(kept).length > 0 ? kept : null;
}

function stripToolResultDetails(message: AgentMessage): AgentMessage {
  if (message.role !== "toolResult" || message.details === undefined) return message;
  const { details, ...rest } = message;
  if (isRecord(details)) {
    const kept: Record<string, unknown> = {};
    if (typeof details.patch === "string") kept.patch = details.patch;
    if (typeof details.diff === "string") kept.diff = details.diff;
    if (message.toolName === "task") {
      const taskDetails = keepTaskToolResultDetails(details);
      if (taskDetails) Object.assign(kept, taskDetails);
    }
    if (Object.keys(kept).length > 0) return { ...rest, details: kept };
  }
  return rest;
}

function omitToolResultBase64Images(message: AgentMessage): AgentMessage {
  if (message.role !== "toolResult") return message;

  let omitted = 0;
  let bytes = 0;
  const mimes = new Set<string>();
  const content = message.content.filter((block) => {
    const image = base64ImageInfo(block);
    if (!image) return true;
    omitted += 1;
    bytes += image.bytes;
    if (image.mime) mimes.add(image.mime);
    return false;
  });
  if (omitted === 0) return message;

  const mimeText = mimes.size > 0 ? `: ${[...mimes].join(", ")}` : "";
  content.push({
    type: "text",
    text: `[${omitted} tool result image${omitted === 1 ? "" : "s"} omitted from initial history payload${mimeText}, ~${bytes} bytes]`,
  });
  return { ...message, content };
}

function compactionUiMessage(entry: CompactionEntry, active: boolean): CustomMessage {
  return {
    role: "custom",
    customType: "compaction",
    content: active ? entry.summary : SUPERSEDED_COMPACTION_SUMMARY,
    display: true,
    details: {
      tokensBefore: entry.tokensBefore,
      firstKeptEntryId: entry.firstKeptEntryId,
    },
    timestamp: parseEntryTimestamp(entry.timestamp),
  };
}

// Convert a session entry on the active branch into a UI message.
// Returns null for entries that do not map to chat history (metadata, non-message types).
export function entryToUiMessage(
  entry: SessionEntry,
  options: { deferThinking?: boolean; deferToolResultImages?: boolean },
): AgentMessage | null {
  switch (entry.type) {
    case "message": {
      const raw = entry.message;
      // omp-only roles are folded into displayable custom messages so the
      // existing role-keyed UI renders them without new components.
      if (raw.role === "developer") {
        return {
          role: "custom",
          customType: "developer",
          content: raw.content,
          display: true,
          timestamp: raw.timestamp,
        };
      }
      if (raw.role === "pythonExecution") {
        const output = raw.output ? `\n\`\`\`\n${raw.output}\n\`\`\`` : "\n(no output)";
        const status = raw.cancelled
          ? "\n(execution cancelled)"
          : raw.exitCode ? `\nExecution failed with code ${raw.exitCode}` : "";
        return {
          role: "custom",
          customType: "python-execution",
          content: `Ran Python:\n\`\`\`python\n${raw.code}\n\`\`\`${output}${status}`,
          display: true,
          timestamp: raw.timestamp,
        };
      }
      if (raw.role === "fileMention") {
        return {
          role: "custom",
          customType: "file-mention",
          content: `Attached file${raw.files.length === 1 ? "" : "s"}:\n${raw.files.map((f) => `- ${f.path}`).join("\n")}`,
          display: true,
          timestamp: raw.timestamp,
        };
      }
      const normalized = options.deferToolResultImages
        ? omitToolResultBase64Images(normalizeToolCalls(raw))
        : normalizeToolCalls(raw);
      const message = stripToolResultDetails(normalized);
      if (!options.deferThinking || message.role !== "assistant") return message;
      return {
        ...message,
        content: message.content.map((block) => (
          block.type === "thinking" && block.thinking.trim() !== ""
            ? { ...block, thinking: "", deferred: true }
            : block
        )),
      };
    }
    case "branch_summary":
      if (!entry.summary) return null;
      return {
        role: "user",
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${entry.summary}`,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    case "custom_message":
      return {
        role: "custom",
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };
    default:
      // model_change, thinking_level_change, service_tier_change, label,
      // title_change, session_init, ttsr_injection, mode_change, custom,
      // session_info: metadata entries with no chat rendering.
      return null;
  }
}

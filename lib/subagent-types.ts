// Shared subagent wire + history types (mirrors of oh-my-pi task/types.ts
// AgentProgress / SubagentLifecyclePayload / SingleResult, kept small and
// defensive: every field is optional because payloads are parsed leniently).

export type SubagentAgentSource = "bundled" | "user" | "project";

export interface SubagentRetryState {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage: string;
  startedAtMs: number;
}

/** Live per-subagent progress snapshot (oh-my-pi AgentProgress). */
export interface SubagentProgress {
  index?: number;
  id?: string;
  agent?: string;
  agentSource?: SubagentAgentSource;
  status?: "pending" | "running" | "completed" | "failed" | "aborted";
  task?: string;
  assignment?: string;
  description?: string;
  lastIntent?: string;
  currentTool?: string;
  currentToolArgs?: string;
  currentToolStartMs?: number;
  recentTools?: Array<{ tool: string; args: string; endMs: number }>;
  recentOutput?: string[];
  toolCount?: number;
  requests?: number;
  tokens?: number;
  contextTokens?: number;
  contextWindow?: number;
  cost?: number;
  durationMs?: number;
  modelOverride?: string | string[];
  modelRole?: string;
  resolvedModel?: string;
  resolvedModelIsFallback?: boolean;
  retryState?: SubagentRetryState;
  retryFailure?: { attempt: number; errorMessage: string };
  inflightTaskDetails?: unknown;
  extractedToolData?: Record<string, unknown[]>;
}

/** Compact live-activity entry derived from subagent_event frames. */
export interface SubagentActivityEvent {
  kind: "tool" | "text" | "notice";
  label: string;
  ts: number;
}

/** Settled per-subagent result from a parent task toolResult (SingleResult). */
export interface SubagentHistoryResult {
  exitCode?: number;
  output?: string;
  truncated?: boolean;
  structuredOutput?: { source?: string; mode?: string; status?: string; error?: string };
  error?: string;
  aborted?: boolean;
  abortReason?: string;
  outputPath?: string;
  patchPath?: string;
  branchName?: string;
}

/** On-disk subagent history recovered from a parent session's task toolResults. */
export interface SubagentHistoryEntry {
  id: string;
  agent: string;
  agentSource?: SubagentAgentSource;
  status: "started" | "completed" | "failed" | "aborted";
  task?: string;
  assignment?: string;
  description?: string;
  index: number;
  sessionFile?: string;
  transcriptAvailable: boolean;
  /** True when the spawn was detached/async (parent turn kept working). */
  detached?: boolean;
  lastIntent?: string;
  toolCount?: number;
  requests?: number;
  tokens?: number;
  contextTokens?: number;
  contextWindow?: number;
  cost?: number;
  durationMs?: number;
  modelOverride?: string | string[];
  modelRole?: string;
  resolvedModel?: string;
  resolvedModelIsFallback?: boolean;
  retryFailure?: { attempt: number; errorMessage: string };
  result?: SubagentHistoryResult;
}

/** get_subagents snapshot (RpcSubagentSnapshot) as seen over the wire. */
export interface SubagentSnapshotLike {
  id: string;
  index: number;
  agent: string;
  agentSource?: SubagentAgentSource;
  description?: string;
  status: "started" | "completed" | "failed" | "aborted" | "pending" | "running";
  task?: string;
  assignment?: string;
  sessionFile?: string;
  lastUpdate?: number;
  progress?: unknown;
  parentToolCallId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asAgentSource(value: unknown): SubagentAgentSource | undefined {
  return value === "bundled" || value === "user" || value === "project" ? value : undefined;
}

function asProgressStatus(value: unknown): SubagentProgress["status"] | undefined {
  return value === "pending" || value === "running" || value === "completed" || value === "failed" || value === "aborted"
    ? value
    : undefined;
}

/** Defensively copy an AgentProgress-shaped object into a SubagentProgress. */
export function parseSubagentProgress(value: unknown): SubagentProgress | undefined {
  if (!isRecord(value)) return undefined;
  const out: SubagentProgress = {};
  const index = asNumber(value.index);
  if (index !== undefined) out.index = index;
  const id = asString(value.id);
  if (id !== undefined) out.id = id;
  const agent = asString(value.agent);
  if (agent !== undefined) out.agent = agent;
  const agentSource = asAgentSource(value.agentSource);
  if (agentSource !== undefined) out.agentSource = agentSource;
  const status = asProgressStatus(value.status);
  if (status !== undefined) out.status = status;
  const task = asString(value.task);
  if (task !== undefined) out.task = task;
  const assignment = asString(value.assignment);
  if (assignment !== undefined) out.assignment = assignment;
  const description = asString(value.description);
  if (description !== undefined) out.description = description;
  const lastIntent = asString(value.lastIntent);
  if (lastIntent !== undefined) out.lastIntent = lastIntent;
  const currentTool = asString(value.currentTool);
  if (currentTool !== undefined) out.currentTool = currentTool;
  const currentToolArgs = asString(value.currentToolArgs);
  if (currentToolArgs !== undefined) out.currentToolArgs = currentToolArgs;
  const currentToolStartMs = asNumber(value.currentToolStartMs);
  if (currentToolStartMs !== undefined) out.currentToolStartMs = currentToolStartMs;
  if (Array.isArray(value.recentTools)) out.recentTools = value.recentTools as SubagentProgress["recentTools"];
  if (Array.isArray(value.recentOutput)) out.recentOutput = value.recentOutput.filter((x): x is string => typeof x === "string");
  const toolCount = asNumber(value.toolCount);
  if (toolCount !== undefined) out.toolCount = toolCount;
  const requests = asNumber(value.requests);
  if (requests !== undefined) out.requests = requests;
  const tokens = asNumber(value.tokens);
  if (tokens !== undefined) out.tokens = tokens;
  const contextTokens = asNumber(value.contextTokens);
  if (contextTokens !== undefined) out.contextTokens = contextTokens;
  const contextWindow = asNumber(value.contextWindow);
  if (contextWindow !== undefined) out.contextWindow = contextWindow;
  const cost = asNumber(value.cost);
  if (cost !== undefined) out.cost = cost;
  const durationMs = asNumber(value.durationMs);
  if (durationMs !== undefined) out.durationMs = durationMs;
  if (typeof value.modelOverride === "string" || (Array.isArray(value.modelOverride) && value.modelOverride.every((x) => typeof x === "string"))) {
    out.modelOverride = value.modelOverride;
  }
  const modelRole = asString(value.modelRole);
  if (modelRole !== undefined) out.modelRole = modelRole;
  const resolvedModel = asString(value.resolvedModel);
  if (resolvedModel !== undefined) out.resolvedModel = resolvedModel;
  if (typeof value.resolvedModelIsFallback === "boolean") out.resolvedModelIsFallback = value.resolvedModelIsFallback;
  if (isRecord(value.retryState)) {
    const attempt = asNumber(value.retryState.attempt);
    const maxAttempts = asNumber(value.retryState.maxAttempts);
    if (attempt !== undefined && maxAttempts !== undefined) {
      out.retryState = {
        attempt,
        maxAttempts,
        delayMs: asNumber(value.retryState.delayMs) ?? 0,
        errorMessage: asString(value.retryState.errorMessage) ?? "",
        startedAtMs: asNumber(value.retryState.startedAtMs) ?? Date.now(),
      };
    }
  }
  if (isRecord(value.retryFailure)) {
    const attempt = asNumber(value.retryFailure.attempt);
    const errorMessage = asString(value.retryFailure.errorMessage);
    if (attempt !== undefined && errorMessage !== undefined) {
      out.retryFailure = { attempt, errorMessage };
    }
  }
  if (value.inflightTaskDetails !== undefined) out.inflightTaskDetails = value.inflightTaskDetails;
  if (isRecord(value.extractedToolData)) out.extractedToolData = value.extractedToolData as Record<string, unknown[]>;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Map a get_subagents snapshot to roster form. */
export function parseSubagentSnapshot(value: unknown): SubagentInfo | undefined {
  if (!isRecord(value)) return undefined;
  const id = asString(value.id);
  const agent = asString(value.agent);
  if (!id || !agent) return undefined;
  const status = value.status === "started" || value.status === "completed" || value.status === "failed" || value.status === "aborted"
    ? value.status
    : value.status === "pending" || value.status === "running"
      ? "started"
      : "started";
  const info: SubagentInfo = {
    id,
    agent,
    status,
    index: asNumber(value.index) ?? -1,
    source: "live",
  };
  const agentSource = asAgentSource(value.agentSource);
  if (agentSource !== undefined) info.agentSource = agentSource;
  const description = asString(value.description);
  if (description !== undefined) info.description = description;
  const task = asString(value.task);
  if (task !== undefined) info.task = task;
  const assignment = asString(value.assignment);
  if (assignment !== undefined) info.assignment = assignment;
  const sessionFile = asString(value.sessionFile);
  if (sessionFile !== undefined) info.sessionFile = sessionFile;
  const parentToolCallId = asString(value.parentToolCallId);
  if (parentToolCallId !== undefined) info.parentToolCallId = parentToolCallId;
  const lastUpdate = asNumber(value.lastUpdate);
  if (lastUpdate !== undefined) info.lastUpdate = lastUpdate;
  const progress = parseSubagentProgress(value.progress);
  if (progress !== undefined) info.progress = progress;
  return info;
}

/** Extract a compact live-activity entry from a subagent_event payload. */
export function parseSubagentActivityEvent(value: unknown): SubagentActivityEvent | null {
  if (!isRecord(value)) return null;
  const event = isRecord(value.event) ? value.event : null;
  if (!event) return null;
  const type = asString(event.type);
  const ts = Date.now();
  if (type === "tool_execution_start") {
    const toolName = asString(event.toolName) ?? "tool";
    const intent = asString(event.intent)?.trim();
    if (intent) return { kind: "tool", label: `→ ${toolName} — ${intent}`, ts };
    const args = isRecord(event.args) ? Object.keys(event.args).slice(0, 3).join(", ") : undefined;
    return { kind: "tool", label: args ? `→ ${toolName} (${args})` : `→ ${toolName}`, ts };
  }
  if (type === "message_end") {
    const message = isRecord(event.message) ? event.message : null;
    if (message && message.role === "assistant") {
      const content = message.content;
      const text = typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
            .filter((block): block is { type: "text"; text?: unknown } => isRecord(block) && block.type === "text")
            .map((block) => (typeof block.text === "string" ? block.text : ""))
            .join("\n")
          : "";
      const trimmed = text.trim();
      if (trimmed) return { kind: "text", label: trimmed.slice(0, 140), ts };
    }
  }
  if (type === "notice") {
    const message = asString(event.message);
    if (message) return { kind: "notice", label: message.slice(0, 140), ts };
  }
  return null;
}

// SubagentInfo is defined here so server-side history and the hook share the
// same roster shape; hooks/useAgentSession re-exports it for components.
export interface SubagentInfo {
  id: string;
  agent: string;
  agentSource?: SubagentAgentSource;
  description?: string;
  status: "started" | "completed" | "failed" | "aborted";
  task?: string;
  assignment?: string;
  sessionFile?: string;
  parentToolCallId?: string;
  index: number;
  detached?: boolean;
  progress?: SubagentProgress;
  lastUpdate?: number;
  /** Settled result for history entries (SingleResult-derived). */
  result?: SubagentHistoryResult;
  /** Roster origin: live frames/snapshots (default) vs on-disk history. */
  source?: "live" | "history";
}

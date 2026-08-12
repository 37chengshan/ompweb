"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import { useI18n } from "@/lib/i18n";
import { formatCost, formatDuration, formatTokens } from "@/lib/subagent-format";
import { MarkdownBody } from "./MarkdownBody";
import { Dialog, DialogContent, DialogTitle, DialogClose } from "./ui/primitives";
import type { SubagentInfo } from "@/hooks/useAgentSession";
import type { SubagentActivityEvent, SubagentSnapshotLike } from "@/lib/subagent-types";

const BLOCK_LABEL_STYLE: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: "var(--text-dim)",
};

/** Recursive renderer for structured completions: string values keep their
 * line breaks (JSON.parse already unescapes them), arrays become bullet
 * lists, nested objects become aligned key/value rows. */
function JsonValue({ value }: { value: unknown }) {
  if (typeof value === "string") {
    return (
      <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.55 }}>
        {value}
      </div>
    );
  }
  if (Array.isArray(value)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {value.map((item, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
            <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>•</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <JsonValue value={item} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {Object.keys(record).map((key) => (
          <div key={key} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-dim)", minWidth: 110, textAlign: "right", paddingTop: 2 }}>{key}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <JsonValue value={record[key]} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{String(value)}</span>;
}

/** The subagent's assignment, rendered as markdown. Exported for SSR tests. */
export function TaskBlock({ task }: { task: string }) {
  const { t } = useI18n();
  if (!task) return null;
  return (
    <section style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", padding: "10px 12px" }}>
      <span style={BLOCK_LABEL_STYLE}>{t("subagentTranscript.taskLabel")}</span>
      <div style={{ marginTop: 6 }}>
        <MarkdownBody className="markdown-subagent-text">{task}</MarkdownBody>
      </div>
    </section>
  );
}

/** The subagent's final output (`<id>.md`). Exported for SSR tests. */
export function CompletionBlock({ completion, truncated }: { completion: string | null; truncated: boolean }) {
  const { t } = useI18n();
  let parsed: Record<string, unknown> | null = null;
  if (completion) {
    try {
      const candidate = JSON.parse(completion) as unknown;
      if (candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)) {
        parsed = candidate as Record<string, unknown>;
      }
    } catch {
      parsed = null;
    }
  }
  const keys = parsed ? Object.keys(parsed) : [];
  const singleText = parsed && keys.length === 1 && typeof parsed[keys[0]] === "string" ? parsed[keys[0]] as string : null;
  return (
    <section style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-panel)", padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={BLOCK_LABEL_STYLE}>{t("subagentTranscript.resultLabel")}</span>
        {truncated && <span style={{ fontSize: 10.5, color: "var(--text-dim)" }}>{t("subagentTranscript.completionTruncated")}</span>}
      </div>
      {singleText ? (
        <div style={{ marginTop: 6, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.55 }}>
          {singleText}
        </div>
      ) : parsed ? (
        <div style={{ marginTop: 6 }}>
          <JsonValue value={parsed} />
        </div>
      ) : completion ? (
        <div style={{ marginTop: 6 }}>
          <MarkdownBody className="markdown-subagent-text">{completion}</MarkdownBody>
        </div>
      ) : (
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-dim)", fontStyle: "italic" }}>
          {t("subagentTranscript.noCompletion")}
        </div>
      )}
    </section>
  );
}

export function SubagentTranscriptDialog({ subagent, sessionId, transcriptVersion, events, onClose }: {
  subagent: SubagentInfo | null;
  sessionId: string | null;
  transcriptVersion: number;
  events?: SubagentActivityEvent[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<SubagentSnapshotLike | null>(null);
  const [completion, setCompletion] = useState<string | null>(null);
  const [completionTruncated, setCompletionTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef(0);
  const lastRefetchRef = useRef(0);

  const open = subagent !== null;
  const fromDisk = subagent?.source === "history";
  const live = !fromDisk;

  const fetchCompletion = useCallback(async (): Promise<{ completion: string | null; truncated: boolean }> => {
    if (!sessionId || !subagent?.id) throw new Error("No session");
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(subagent.id)}?mode=completion`);
    if (res.status === 404) return { completion: null, truncated: false };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json() as { completion: string | null; truncated: boolean };
  }, [sessionId, subagent?.id]);

  const load = useCallback(async () => {
    if (!sessionId || !subagent?.id) return;
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const found = await fetchCompletion();
      // Live snapshots enrich the header (resolved model etc.) but carry no
      // settled output — the on-disk `<id>.md` is the completion source.
      if (found.completion === null && live) {
        const result = await sendAgentCommand<{ subagents?: SubagentSnapshotLike[] }>(sessionId, { type: "get_subagents" });
        const snap = (result.subagents ?? []).find((s) => s.id === subagent?.id);
        if (seq !== requestSeqRef.current) return;
        if (snap) setDetail(snap);
      }
      if (seq !== requestSeqRef.current) return;
      setCompletion(found.completion);
      setCompletionTruncated(found.truncated);
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, [sessionId, subagent?.id, live, fetchCompletion]);

  // Load the completion whenever the dialog opens for a subagent.
  useEffect(() => {
    if (!open || !sessionId) return;
    requestSeqRef.current += 1;
    lastRefetchRef.current = Date.now();
    setCompletion(null);
    setCompletionTruncated(false);
    setError(null);
    setDetail(null);
    void load();
  }, [open, sessionId, load]);

  // Live child events mean the final output may have just landed — refetch,
  // throttled so streaming batches don't hammer the route.
  useEffect(() => {
    if (!open || !sessionId || transcriptVersion === 0 || loading) return;
    const now = Date.now();
    if (now - lastRefetchRef.current < 600) return;
    lastRefetchRef.current = now;
    void load();
  }, [open, sessionId, transcriptVersion, loading, load]);

  const agent = detail?.agent ?? subagent?.agent ?? "";
  const description = detail?.description ?? subagent?.description ?? "";
  const task = detail?.task ?? subagent?.task ?? subagent?.assignment ?? "";
  const progress = subagent?.progress;
  const historyMeta = subagent?.source === "history"
    ? [
        formatTokens(progress?.tokens) ? `${formatTokens(progress?.tokens)} tok` : null,
        formatCost(progress?.cost),
        formatDuration(progress?.durationMs),
        progress?.resolvedModel ? progress.resolvedModel.replace(/:.*$/, "") : null,
      ].filter(Boolean).join(" · ")
    : null;
  const outcomeError = subagent?.source === "history"
    ? subagent?.result?.abortReason ?? subagent?.result?.error
    : undefined;
  const recentEvents = live && !completion && events && events.length > 0 ? events.slice(-4) : null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        ariaLabel={t("subagentTranscript.title")}
        style={{ width: "min(94vw, 920px)", maxWidth: "min(94vw, 920px)" }}
      >
        {subagent && (
          <>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <DialogTitle style={{ marginBottom: 2, fontSize: 16, lineHeight: 1.3 }}>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)", fontSize: 14 }}>{agent}</span>
                </DialogTitle>
                {description && (
                  <div style={{ fontSize: 12.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 4 }}>
                    {description}
                  </div>
                )}
                <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {detail?.sessionFile ?? subagent.sessionFile ?? subagent.id}
                </div>
                {historyMeta && (
                  <div style={{ fontSize: 10.5, color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                    {historyMeta}
                  </div>
                )}
                {outcomeError && (
                  <div style={{ fontSize: 11, color: "var(--accent-strong)", marginTop: 2, wordBreak: "break-word" }}>
                    {outcomeError}
                  </div>
                )}
              </div>
              <DialogClose
                style={{ flexShrink: 0, background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "2px 6px" }}
                aria-label={t("subagentTranscript.close")}
              >
                ×
              </DialogClose>
            </div>

            {recentEvents && (
              <div
                aria-live="polite"
                style={{
                  display: "grid",
                  gap: 2,
                  marginBottom: 8,
                  padding: "6px 10px",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-control)",
                  background: "var(--bg-panel)",
                }}
              >
                {recentEvents.map((event, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 6,
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      color: event.kind === "tool" ? "var(--accent)" : "var(--text-muted)",
                      minWidth: 0,
                    }}
                  >
                    <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>
                      {event.kind === "tool" ? "→" : event.kind === "notice" ? "!" : "»"}
                    </span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{event.label}</span>
                  </div>
                ))}
              </div>
            )}

            {error ? (
              <div style={{ fontSize: 12, color: "var(--status-error)", padding: "8px 2px" }}>{error}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <TaskBlock task={task} />
                <CompletionBlock completion={completion} truncated={completionTruncated} />
                {loading && <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("subagentTranscript.loading")}</div>}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

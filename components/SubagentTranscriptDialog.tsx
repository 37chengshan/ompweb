"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import { useI18n } from "@/lib/i18n";
import { Dialog, DialogContent, DialogTitle, DialogClose } from "./ui/primitives";
import type { SubagentInfo } from "@/hooks/useAgentSession";
import type { AgentMessage, AssistantContentBlock, ToolResultMessage } from "@/lib/types";

interface SubagentSnapshotLike {
  id: string;
  agent?: string;
  description?: string;
  status?: string;
  task?: string;
  assignment?: string;
  sessionFile?: string;
}

interface SubagentMessagesPage {
  sessionFile: string;
  fromByte: number;
  nextByte: number;
  reset?: boolean;
  messages: AgentMessage[];
}

function SubagentBlock({ block }: { block: AssistantContentBlock }) {
  if (block.type === "text") {
    return <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{block.text}</div>;
  }
  if (block.type === "toolCall") {
    return (
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
        <span style={{ color: "var(--accent)" }}>→ {block.toolName}</span>{" "}
        {JSON.stringify(block.input ?? {})}
      </div>
    );
  }
  if (block.type === "thinking") {
    return <div style={{ fontSize: 11, color: "var(--text-dim)", fontStyle: "italic" }}>…</div>;
  }
  return null;
}

function SubagentMessageRow({ message }: { message: AgentMessage }) {
  if (message.role === "user") {
    return (
      <div style={{ display: "flex", gap: 8 }}>
        <span style={{ flexShrink: 0, fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--accent)", paddingTop: 2 }}>U</span>
        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12.5, lineHeight: 1.55 }}>
          {typeof message.content === "string" ? message.content : message.content.map((block, i) => (
            <SubagentBlock key={i} block={block as AssistantContentBlock} />
          ))}
        </div>
      </div>
    );
  }
  if (message.role === "assistant") {
    return (
      <div style={{ display: "flex", gap: 8 }}>
        <span style={{ flexShrink: 0, fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)", paddingTop: 2 }}>A</span>
        <div style={{ fontSize: 12.5, lineHeight: 1.55, minWidth: 0 }}>
          {message.content.map((block, i) => (
            <SubagentBlock key={i} block={block} />
          ))}
        </div>
      </div>
    );
  }
  const toolResult = message as ToolResultMessage;
  const text = (toolResult.content ?? [])
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .slice(0, 400);
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <span style={{ flexShrink: 0, fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-dim)", paddingTop: 2 }}>R</span>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5, fontFamily: "var(--font-mono)" }}>
        {toolResult.isError ? `⚠ ${text || "(error)"}` : text || "(no output)"}
      </div>
    </div>
  );
}

export function SubagentTranscriptDialog({ subagent, sessionId, transcriptVersion, onClose }: {
  subagent: SubagentInfo | null;
  sessionId: string | null;
  transcriptVersion: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<SubagentSnapshotLike | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [nextByte, setNextByte] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const requestSeqRef = useRef(0);
  const refreshedTranscriptVersionRef = useRef(0);

  const open = subagent !== null;

  const loadPage = useCallback(async (startByte: number, sessionFile: string | undefined) => {
    if (!sessionId) return;
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const page = await sendAgentCommand<SubagentMessagesPage>(sessionId, {
        type: "get_subagent_messages",
        subagentId: subagent?.id,
        sessionFile,
        fromByte: startByte,
      });
      if (seq !== requestSeqRef.current) return;
      if (page.reset) {
        setMessages(page.messages);
      } else {
        setMessages((prev) => [...prev, ...page.messages]);
      }
      setNextByte(page.nextByte);
      setExhausted(page.nextByte <= page.fromByte || page.messages.length === 0);
    } catch (e) {
      if (seq !== requestSeqRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, [sessionId, subagent?.id]);

  // Load the snapshot + first page whenever the dialog opens for a subagent.
  useEffect(() => {
    if (!open || !sessionId) return;
    requestSeqRef.current += 1;
    setMessages([]);
    setNextByte(0);
    setExhausted(false);
    setError(null);
    setDetail(null);
    refreshedTranscriptVersionRef.current = transcriptVersion;
    let cancelled = false;

    void (async () => {
      // Enrich the header from get_subagents when the snapshot is still live.
      try {
        const result = await sendAgentCommand<{ subagents?: SubagentSnapshotLike[] }>(sessionId, { type: "get_subagents" });
        const found = (result.subagents ?? []).find((s) => s.id === subagent?.id);
        if (!cancelled && found) setDetail(found);
      } catch {
        // Snapshot lookup is best-effort; the roster entry already has basics.
      }
      await loadPage(0, subagent?.sessionFile);
    })();

    return () => { cancelled = true; };
  }, [open, sessionId, subagent?.id, subagent?.sessionFile, transcriptVersion, loadPage]);

  // Child events arrive as an invalidation signal. Continue from nextByte
  // instead of replaying the transcript on every streamed child event.
  useEffect(() => {
    if (!open || !sessionId || transcriptVersion === 0 || loading) return;
    if (refreshedTranscriptVersionRef.current === transcriptVersion) return;
    refreshedTranscriptVersionRef.current = transcriptVersion;
    void loadPage(nextByte, subagent?.sessionFile);
  }, [open, sessionId, transcriptVersion, loading, loadPage, nextByte, subagent?.sessionFile]);

  const loadMore = () => { void loadPage(nextByte, subagent?.sessionFile); };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent ariaLabel={t("subagentTranscript.title")} style={{ width: 640 }}>
        {subagent && (
          <>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <DialogTitle style={{ marginBottom: 4, fontSize: 16 }}>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)", fontSize: 14 }}>{detail?.agent ?? subagent.agent}</span>
                  {" "}
                  {detail?.task ?? subagent.task ?? subagent.description ?? ""}
                </DialogTitle>
                <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {detail?.sessionFile ?? subagent.sessionFile ?? subagent.id}
                </div>
              </div>
              <DialogClose
                style={{ flexShrink: 0, background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "2px 6px" }}
                aria-label={t("subagentTranscript.close")}
              >
                ×
              </DialogClose>
            </div>

            <div style={{ maxHeight: "60dvh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--bg-panel)" }}>
              {error ? (
                <div style={{ fontSize: 12, color: "var(--status-error)" }}>{error}</div>
              ) : messages.length === 0 && !loading ? (
                <div style={{ fontSize: 12, color: "var(--text-dim)", fontStyle: "italic" }}>{t("subagentTranscript.noMessages")}</div>
              ) : (
                messages.map((message, i) => <SubagentMessageRow key={i} message={message} />)
              )}
              {loading && <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("subagentTranscript.loading")}</div>}
            </div>

            {!exhausted && !error && (
              <div style={{ marginTop: 10, textAlign: "center" }}>
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loading}
                  style={{
                    padding: "6px 14px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)",
                    background: "transparent", color: "var(--text-muted)", cursor: loading ? "wait" : "pointer",
                    fontSize: 12,
                  }}
                >
                  {t("subagentTranscript.loadMore")}
                </button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

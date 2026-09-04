"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Bot, CircleAlert, LoaderCircle } from "lucide-react";
import type { AgentMessage, ToolResultMessage } from "@/lib/types";
import type { SubagentInfo } from "@/hooks/useAgentSession";
import { MessageView } from "@/components/MessageView";
import { fetchSubagentTranscript } from "@/lib/workbench-client";
import { sendAgentCommand } from "@/lib/agent-client";

export function SubagentDetailPanel({ subagent, sessionId, onBack }: { subagent: SubagentInfo; sessionId: string | null; onBack: () => void }) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const loadMessages = useCallback(async (initial = false) => {
    if (!sessionId || !subagent.id) { setLoading(false); return; }
    const request = ++requestRef.current;
    if (initial) { setLoading(true); setError(null); }
    try {
      let next: AgentMessage[] = [];
      let diskError: unknown = null;
      try {
        const disk = await fetchSubagentTranscript(sessionId, subagent.id);
        next = disk.messages ?? [];
      } catch (reason) {
        diskError = reason;
      }
      // A running child can be visible in the RPC registry before its sibling
      // transcript file is flushed. Ask the live OMP process in that window;
      // once the file appears, the disk route remains the durable fallback.
      if (next.length === 0 && subagent.status === "started") {
        try {
          const live = await sendAgentCommand<{ messages?: AgentMessage[] }>(sessionId, {
            type: "get_subagent_messages",
            subagentId: subagent.id,
            sessionFile: subagent.sessionFile,
            fromByte: 0,
          });
          next = live.messages ?? [];
        } catch (liveError) {
          if (diskError) throw liveError;
        }
      }
      if (request !== requestRef.current) return;
      setMessages((previous) => {
        // Avoid resetting MessageView instances (and their collapse state) on
        // every live poll when the transcript has not changed.
        if (previous.length === next.length && previous.every((message, index) => message === next[index])) return previous;
        return next;
      });
      if (initial) setError(null);
    } catch (reason) {
      if (request === requestRef.current && initial) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (request === requestRef.current && initial) setLoading(false);
    }
  }, [sessionId, subagent.id, subagent.sessionFile, subagent.status]);
  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    void loadMessages(true);
    const timer = subagent.status === "started"
      ? window.setInterval(() => { if (!cancelled) void loadMessages(false); }, 1200)
      : null;
    return () => {
      cancelled = true;
      requestRef.current += 1;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [loadMessages, subagent.status]);
  return <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", background: "var(--bg)" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 7, minHeight: 34, padding: "0 9px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}><button type="button" onClick={onBack} aria-label="返回任务管理" title="返回任务管理" style={{ display: "grid", placeItems: "center", width: 24, height: 24, border: 0, background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}><ArrowLeft size={14} aria-hidden="true" /></button><Bot size={14} style={{ color: "var(--accent)" }} aria-hidden="true" /><strong style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--accent)" }}>{subagent.agent}</strong><span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-muted)", fontSize: 11 }}>{subagent.task ?? subagent.description ?? ""}</span></div>
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 10, display: "grid", alignContent: "start", gap: 8 }}>
      {loading && <div role="status" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-dim)", fontSize: 11 }}><LoaderCircle size={13} className="icon-spin" aria-hidden="true" />加载子代理消息…</div>}
      {error && <div role="alert" style={{ display: "flex", gap: 6, color: "var(--status-error)", fontSize: 11 }}><CircleAlert size={13} aria-hidden="true" />{error}</div>}
      {!loading && !error && messages.length === 0 && <div style={{ color: "var(--text-dim)", fontSize: 11, textAlign: "center", padding: 20 }}>暂时没有可读取的消息。</div>}
      {(() => {
        const toolResults = new Map<string, ToolResultMessage>();
        for (const message of messages) if (message.role === "toolResult" && typeof (message as ToolResultMessage).toolCallId === "string") toolResults.set((message as ToolResultMessage).toolCallId, message as ToolResultMessage);
        return messages.map((message, index) => message.role === "toolResult" ? null : <div key={(message as { id?: string }).id ?? index} style={{ padding: "2px 0", borderBottom: "1px solid color-mix(in srgb, var(--border) 55%, transparent)" }}><MessageView message={message} toolResults={toolResults} sessionId={sessionId ?? undefined} cwd={undefined} toolCallsDefaultCollapsed={false} /></div>);
      })()}
    </div>
  </div>;
}

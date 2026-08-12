"use client";

import { useEffect, useRef, useState } from "react";
import { Ban, CheckCircle2, ChevronDown, Circle, CircleAlert, Network } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { SubagentInfo } from "@/hooks/useAgentSession";
import type { TodoPhase } from "@/lib/pi-types";
import { countNestedSubagents, formatCost, formatDuration, formatTokens, shortModel } from "@/lib/subagent-format";
import { TodoList } from "./TodoList";

const SUBAGENT_STATE_KEYS: Record<SubagentInfo["status"], string> = {
  started: "chatWindow.subagentState.started",
  completed: "chatWindow.subagentState.completed",
  failed: "chatWindow.subagentState.failed",
  aborted: "chatWindow.subagentState.aborted",
};

function SubagentStatusIcon({ subagent }: { subagent: SubagentInfo }) {
  const live = subagent.source !== "history";
  if (subagent.status === "started") {
    if (live) {
      return (
        <span
          aria-hidden
          className="live-status-dot inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent animate-[pulse_1.5s_infinite]"
        />
      );
    }
    return <Circle size={12} color="var(--text-dim)" />;
  }
  const props = { size: 12, strokeWidth: 2, "aria-hidden": true as const };
  if (subagent.status === "completed") return <CheckCircle2 {...props} color="var(--accent)" />;
  if (subagent.status === "failed") return <CircleAlert {...props} color="var(--accent-strong)" />;
  return <Ban {...props} color="var(--text-dim)" />;
}

/** Compact live/secondary line under a chip label (tool, retry, telemetry). */
function SubagentActivityLine({ subagent }: { subagent: SubagentInfo }) {
  const progress = subagent.progress;
  const retryActive = Boolean(progress?.retryState ?? progress?.retryFailure);
  const parts: string[] = [];

  if (retryActive) {
    const attempt = progress?.retryState?.attempt ?? progress?.retryFailure?.attempt ?? 0;
    const maxAttempts = progress?.retryState?.maxAttempts ?? 0;
    parts.push(`⟳ retrying ${maxAttempts > 0 ? `${attempt}/${maxAttempts}` : `attempt ${attempt}`}`);
  } else if (subagent.status === "started") {
    const activity = progress?.currentTool
      ? `⚙ ${progress.currentTool}${progress.lastIntent ? ` — ${progress.lastIntent}` : ""}`
      : progress?.lastIntent;
    if (activity) parts.push(activity);
  }

  const nested = countNestedSubagents(progress);
  const source = subagent.agentSource && subagent.agentSource !== "bundled" ? subagent.agentSource : null;
  const tokens = formatTokens(progress?.tokens);
  const cost = formatCost(progress?.cost);
  const context = progress?.contextTokens != null
    ? `${formatTokens(progress.contextTokens)}${progress.contextWindow != null ? `/${formatTokens(progress.contextWindow)}` : ""} ctx`
    : null;
  const model = shortModel(progress?.resolvedModel);
  const duration = subagent.source === "history" ? formatDuration(progress?.durationMs) : null;
  const meta = [source, nested > 0 ? `${nested} nested` : null, tokens ? `${tokens} tok` : null, cost, context, model, duration].filter(Boolean);
  if (meta.length > 0) parts.push(meta.join(" · "));

  if (parts.length === 0) return null;
  return (
    <span
      style={{
        display: "block",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: 10.5,
        fontFamily: "var(--font-mono)",
        color: retryActive ? "var(--accent-strong)" : "var(--text-dim)",
        lineHeight: 1.4,
      }}
    >
      {parts.join(" · ")}
    </span>
  );
}

function SubagentsPanel({ subagents, onSelectSubagent }: {
  subagents: SubagentInfo[];
  onSelectSubagent: (subagent: SubagentInfo) => void;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const prevRunningRef = useRef(0);
  const runningCount = subagents.filter((subagent) => subagent.source !== "history" && subagent.status === "started").length;

  // Surface newly-spawned subagents: expand the panel when a run starts.
  useEffect(() => {
    if (runningCount > 0 && prevRunningRef.current === 0) setCollapsed(false);
    prevRunningRef.current = runningCount;
  }, [runningCount]);

  if (subagents.length === 0) return null;

  return (
    <section
      aria-label={t("chatWindow.subagentsPanel")}
      className="overflow-hidden border border-border bg-bg-subtle"
      style={{ borderRadius: "var(--radius-card)" }}
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}
        title={collapsed ? t("chatWindow.expandPanel") : t("chatWindow.collapsePanel")}
        className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs text-text-muted ${collapsed ? "" : "border-b border-border"}`}
        style={{ background: "none" }}
      >
        <Network size={14} strokeWidth={1.8} aria-hidden />
        <strong className="font-medium text-text">{t("chatWindow.subagentsPanel")}</strong>
        <span className="ml-auto">{t("chatWindow.subagentSummary", { running: runningCount, total: subagents.length })}</span>
        <ChevronDown
          size={14}
          strokeWidth={1.8}
          aria-hidden
          style={{
            color: "var(--text-dim)",
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            transition: "transform var(--dur-fast) var(--ease-out-warm)",
          }}
        />
      </button>
      {!collapsed && (
        <div
          role="list"
          aria-label={t("chatWindow.subagentsPanel")}
          className="flex flex-wrap gap-1.5 px-3 py-2.5"
        >
          {subagents.map((subagent) => {
            const stateLabel = t(SUBAGENT_STATE_KEYS[subagent.status]);
            const label = `${subagent.agent} · ${subagent.task ?? subagent.description ?? stateLabel}`;
            const live = subagent.source !== "history";
            return (
              <button
                key={subagent.id}
                type="button"
                onClick={() => onSelectSubagent(subagent)}
                aria-label={label}
                title={`${label}${subagent.detached ? " (async)" : ""}`}
                style={{
                  display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 1,
                  maxWidth: 320, padding: "3px 10px",
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  background: "var(--bg-panel)",
                  fontSize: 11.5,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  color: live && subagent.status === "started" ? "var(--text)" : "var(--text-dim)",
                  opacity: live && subagent.status === "started" ? 1 : 0.72,
                  transition: "border-color var(--dur-fast) var(--ease-out-warm), background var(--dur-fast) var(--ease-out-warm)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 40%, var(--border))";
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.background = "var(--bg-panel)";
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, maxWidth: "100%" }}>
                  <SubagentStatusIcon subagent={subagent} />
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 10.5, color: "var(--accent)", flexShrink: 0 }}>
                    {subagent.agent}
                  </span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
                    {subagent.task ?? subagent.description ?? stateLabel}
                  </span>
                  {subagent.detached && (
                    <span
                      aria-hidden
                      style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0, fontFamily: "var(--font-mono)" }}
                    >
                      ⤴
                    </span>
                  )}
                </span>
                <SubagentActivityLine subagent={subagent} />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Session panels attached to the composer: live todo plan + running
 * subagent roster. Each is independently collapsible and expands itself when
 * new work appears. Rendered pinned above the chat input. */
export function ComposerPanels({ todoPhases, subagents, onSelectSubagent }: {
  todoPhases: TodoPhase[];
  subagents: SubagentInfo[];
  onSelectSubagent: (subagent: SubagentInfo) => void;
}) {
  if (todoPhases.length === 0 && subagents.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
      <TodoList phases={todoPhases} collapsible />
      <SubagentsPanel subagents={subagents} onSelectSubagent={onSelectSubagent} />
    </div>
  );
}

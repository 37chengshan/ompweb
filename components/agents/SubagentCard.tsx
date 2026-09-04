"use client";

import { memo, useState } from "react";
import { Bot, ChevronDown, CircleDollarSign, Clock3, Cpu, Gauge, GitBranch, UserRound } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { SubagentInfo } from "@/hooks/useAgentSession";
import { SubagentStatusIcon } from "../SubagentStatusIcon";
import { formatCost, formatDuration, formatTokens, shortModel } from "@/lib/subagent-format";
import { countNestedSubagents } from "@/lib/subagent-format";
import { SubagentLiveLine } from "./SubagentLiveLine";
import { subagentHasDetail } from "@/lib/subagent-lineage";

const STATE_KEYS: Record<SubagentInfo["status"], string> = {
  started: "chatWindow.subagentState.started",
  completed: "chatWindow.subagentState.completed",
  failed: "chatWindow.subagentState.failed",
  aborted: "chatWindow.subagentState.aborted",
};

export const SubagentCard = memo(function SubagentCard({ subagent, onSelect }: {
  subagent: SubagentInfo;
  onSelect?: (subagent: SubagentInfo) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  // Focused cards are announced as selected. The native Agents panel expands
  // telemetry inline; hosts that pass onSelect can opt into an explicit
  // transcript action without changing the default interaction.
  const [focused, setFocused] = useState(false);
  const live = subagent.source !== "history";
  const running = subagent.status === "started";
  const progress = subagent.progress;
  const task = subagent.task ?? subagent.description ?? t(STATE_KEYS[subagent.status]);
  const hasDetail = subagentHasDetail(subagent);

  const telemetry: Array<{ key: string; icon: typeof Cpu; label: string | null; value: string | null }> = [
    {
      key: "source",
      icon: UserRound,
      label: subagent.agentSource ?? "",
      value: subagent.agentSource && subagent.agentSource !== "bundled" ? subagent.agentSource : null,
    },
    {
      key: "nested",
      icon: GitBranch,
      label: t("chatWindow.subagentNestedCount", { count: countNestedSubagents(progress) }),
      value: countNestedSubagents(progress) > 0 ? String(countNestedSubagents(progress)) : null,
    },
    {
      key: "tokens",
      icon: Cpu,
      label: t("chatWindow.tokensUnit", { count: formatTokens(progress?.tokens) ?? "" }),
      value: formatTokens(progress?.tokens),
    },
    {
      key: "cost",
      icon: CircleDollarSign,
      label: formatCost(progress?.cost),
      value: formatCost(progress?.cost) || null,
    },
    {
      key: "context",
      icon: Gauge,
      label: t("chatWindow.contextGauge", {
        used: formatTokens(progress?.contextTokens) ?? "?",
        total: formatTokens(progress?.contextWindow) ?? "?",
      }),
      value: progress?.contextTokens
        ? `${formatTokens(progress?.contextTokens)}/${formatTokens(progress?.contextWindow) ?? "?"}`
        : null,
    },
    {
      key: "model",
      icon: Bot,
      label: shortModel(progress?.resolvedModel) ?? "",
      value: shortModel(progress?.resolvedModel),
    },
    {
      key: "duration",
      icon: Clock3,
      label: formatDuration(progress?.durationMs),
      value: !running ? formatDuration(progress?.durationMs) : null,
    },
  ].filter((entry) => entry.value !== null && entry.value !== "");

  return (
    <div
      role="treeitem"
      aria-selected={focused}
      aria-expanded={hasDetail ? expanded : undefined}
      aria-label={`${subagent.agent} · ${t(STATE_KEYS[subagent.status])}${task ? ` — ${task}` : ""}`}
      onClick={() => { if (onSelect) onSelect(subagent); else if (hasDetail) setExpanded((value) => !value); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (onSelect) onSelect(subagent); else if (hasDetail) setExpanded((value) => !value);
        } else if (e.key === "ArrowRight" && hasDetail && !expanded) {
          e.preventDefault();
          setExpanded(true);
        } else if (e.key === "ArrowLeft" && expanded) {
          e.preventDefault();
          setExpanded(false);
        }
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      tabIndex={0}
      style={{
        display: "grid",
        gap: 2,
        padding: "6px 8px",
        marginBottom: 2,
        border: "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
        borderRadius: "var(--radius-control)",
        background: running ? "color-mix(in srgb, var(--accent) 4%, var(--bg))" : "var(--bg)",
        cursor: "pointer",
        opacity: live ? 1 : 0.72,
        outline: "none",
        transition: "border-color var(--dur-fast) var(--ease-out-warm), background var(--dur-fast) var(--ease-out-warm)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 45%, var(--border))";
        e.currentTarget.style.background = running ? "color-mix(in srgb, var(--accent) 7%, var(--bg))" : "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "color-mix(in srgb, var(--border) 72%, transparent)";
        e.currentTarget.style.background = running ? "color-mix(in srgb, var(--accent) 4%, var(--bg))" : "var(--bg)";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
        <span style={{ flexShrink: 0, display: "inline-flex" }}>
          <SubagentStatusIcon status={subagent.status} live={live} />
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 10.5, color: "var(--accent)", flexShrink: 0 }}>
          {subagent.agent}
        </span>
        <span
          style={{
            minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            fontSize: 11.5, color: running ? "var(--text)" : "var(--text-muted)",
          }}
        >
          {task}
        </span>
        {subagent.detached && <span aria-hidden style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>⤴</span>}
        {hasDetail && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={expanded ? "Collapse agent details" : "Expand agent details"}
            aria-expanded={expanded}
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            onKeyDown={(e) => {
              // Arrow keys reach the expand control from the focused card
              // (left/right handled by the treeitem) — Enter/Space toggle.
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                setExpanded((v) => !v);
              }
            }}
            style={{
              flexShrink: 0, display: "inline-flex", color: "var(--text-dim)",
              padding: 0, border: "none", background: "none", cursor: "pointer", borderRadius: 4,
            }}
          >
            <ChevronDown
              size={12}
              strokeWidth={1.8}
              aria-hidden
              style={{ transform: expanded ? "none" : "rotate(-90deg)", transition: "transform var(--dur-fast) var(--ease-out-warm)" }}
            />
          </button>
        )}
      </div>

      {running && (
        <div style={{ paddingLeft: 22, minWidth: 0, fontSize: 10.5, fontFamily: "var(--font-mono)", color: "var(--text-dim)", lineHeight: 1.4 }}>
          <SubagentLiveLine subagent={subagent} />
        </div>
      )}

      {expanded && (
        <div style={{ paddingLeft: 22, display: "flex", flexWrap: "wrap", gap: "2px 8px", fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-dim)", lineHeight: 1.5 }}>
          {telemetry.map((entry) => (
            <span key={entry.key} aria-label={entry.label ?? ""} title={entry.label ?? ""} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <entry.icon size={10} strokeWidth={1.8} aria-hidden />
              {entry.value}
            </span>
          ))}
          {telemetry.length === 0 && <span>{t(`chatWindow.subagentState.${subagent.status}`)}</span>}
        </div>
      )}
    </div>
  );
});

"use client";

import { useMemo, useState } from "react";
import { Network, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { SubagentInfo } from "@/hooks/useAgentSession";
import { countSubagents, groupSubagents, sortSubagentGroup } from "@/lib/subagent-lineage";
import { SubagentCard } from "./SubagentCard";

/** Agents sidebar panel: header (running/total) + live roster, then a dimmed
 *  history section for settled runs recovered from disk. Cards expand their
 *  telemetry in place; an optional onSelectSubagent keeps an explicit
 *  transcript action available to other hosts without making the main panel
 *  depend on a modal/portal.
 *
 *  Perf: every step is memoized off the raw roster — a subagent_progress SSE
 *  frame (potentially ~10Hz) recomputes only the sorted arrays when the
 *  roster identity changed, and memoized cards skip re-render when their
 *  SubagentInfo reference is untouched (the hook replaces only the updated
 *  entry). */
export function AgentsPanel({ subagents, onSelectSubagent }: {
  subagents: SubagentInfo[];
  onSelectSubagent?: (subagent: SubagentInfo) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "live" | "history">("all");
  const counts = useMemo(() => countSubagents(subagents), [subagents]);
  const { liveSorted: allLive, historySorted: allHistory } = useMemo(() => {
    const { live, history } = groupSubagents(subagents);
    return { liveSorted: sortSubagentGroup(live), historySorted: sortSubagentGroup(history) };
  }, [subagents]);
  const { liveSorted, historySorted } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (subagent: SubagentInfo) => !needle || `${subagent.agent} ${subagent.task ?? ""} ${subagent.description ?? ""}`.toLowerCase().includes(needle);
    return {
      liveSorted: scope === "history" ? [] : allLive.filter(matches),
      historySorted: scope === "live" ? [] : allHistory.filter(matches),
    };
  }, [allHistory, allLive, query, scope]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <Network size={14} strokeWidth={1.8} style={{ color: "var(--accent)" }} aria-hidden />
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{t("chatWindow.subagentsPanel")}</span>
        <span
          style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10.5, color: counts.running > 0 ? "var(--accent)" : "var(--text-dim)" }}
          aria-label={t("chatWindow.subagentSummary", { running: counts.running, total: counts.total })}
        >
          {counts.running > 0 ? `${counts.running}/${counts.total}` : `${counts.total}`}
        </span>
      </div>

      <div role="toolbar" aria-label={t("chatWindow.subagentsFilter") ?? "Filter agents"} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0 }}>
        <Search size={13} color="var(--text-dim)" aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("chatWindow.subagentsSearch") ?? "Filter agents…"} aria-label={t("chatWindow.subagentsSearch") ?? "Filter agents"} style={{ minWidth: 0, flex: 1, border: 0, outline: 0, background: "transparent", color: "var(--text)", fontSize: 11 }} />
        {(["all", "live", "history"] as const).map((value) => {
          const selected = scope === value;
          const label = value === "all" ? (t("chatWindow.subagentsAll") ?? "All") : value === "live" ? (t("chatWindow.subagentsLive") ?? "Live") : (t("chatWindow.historySubagents") ?? "History");
          return <button key={value} type="button" aria-pressed={selected} onClick={() => setScope(value)} style={{ padding: "2px 5px", border: 0, borderBottom: selected ? "2px solid var(--accent)" : "2px solid transparent", background: "transparent", color: selected ? "var(--text)" : "var(--text-dim)", cursor: "pointer", fontSize: 10 }}>{label}</button>;
        })}
      </div>

      <div
        role="tree"
        aria-label={t("chatWindow.subagentsPanel") ?? "Agents"}
        style={{ flex: 1, overflowY: "auto", padding: 6, display: "grid", alignContent: "start", gap: 2 }}
      >
        {liveSorted.length > 0 && liveSorted.map((subagent) => (
          <SubagentCard key={subagent.id} subagent={subagent} onSelect={onSelectSubagent} />
        ))}

        {liveSorted.length === 0 && historySorted.length === 0 && (
          <div style={{ padding: "24px 14px", color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>
            {subagents.length > 0 && query.trim() ? (t("chatWindow.subagentsNoMatches") ?? "No matching agents.") : t("chatWindow.subagentsEmpty") ?? "No subagents yet."}
          </div>
        )}

        {historySorted.length > 0 && (
          <>
            <div
              role="presentation"
              style={{
                display: "flex", alignItems: "center", gap: 6, margin: "8px 4px 2px",
                fontSize: 10, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.04em",
              }}
            >
              {t("chatWindow.historySubagents") ?? "History"}
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 400, fontSize: 9.5 }}>{historySorted.length}</span>
            </div>
            {historySorted.map((subagent) => (
              <SubagentCard key={subagent.id} subagent={subagent} onSelect={onSelectSubagent} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

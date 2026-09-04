// Pure roster derivation for the agents sidebar panel (5.1). Kept framework-free
// so grouping/ordering/counting are unit-testable without React.

import type { SubagentInfo } from "./subagent-types";

export interface SubagentGroup {
  /** Live roster entries (SSE frames / get_subagents snapshots). */
  live: SubagentInfo[];
  /** Settled on-disk history entries recovered from the parent session. */
  history: SubagentInfo[];
}

/** Split a merged roster into live vs history groups. */
export function groupSubagents(roster: readonly SubagentInfo[]): SubagentGroup {
  const live: SubagentInfo[] = [];
  const history: SubagentInfo[] = [];
  for (const entry of roster) {
    if (entry.source === "history") history.push(entry);
    else live.push(entry);
  }
  return { live, history };
}

/**
 * Sort one group for the sidebar: running first, then newest-first by index
 * (live snapshots carry a running status; history entries are ordered by their
 * task result row index). Stable so the list never jumps around on refresh.
 */
export function sortSubagentGroup(entries: readonly SubagentInfo[]): SubagentInfo[] {
  return [...entries].sort((a, b) => {
    const aRunning = a.status === "started" ? 1 : 0;
    const bRunning = b.status === "started" ? 1 : 0;
    if (aRunning !== bRunning) return bRunning - aRunning;
    return (b.index ?? -1) - (a.index ?? -1);
  });
}

export interface SubagentCounts {
  total: number;
  running: number;
  live: number;
  history: number;
}

/** Header badge counts (running/total like the composer roster). */
export function countSubagents(roster: readonly SubagentInfo[]): SubagentCounts {
  let running = 0;
  let live = 0;
  for (const entry of roster) {
    if (entry.status === "started") running += 1;
    if (entry.source !== "history") live += 1;
  }
  return { total: roster.length, running, live, history: roster.length - live };
}

/** One-line human label for a card (agent · task). */
export function subagentCardLabel(subagent: SubagentInfo): string {
  const task = subagent.task ?? subagent.description ?? "";
  return task ? `${subagent.agent} · ${task}` : subagent.agent;
}

/** Whether a card should render its activity/telemetry affordances. */
export function subagentHasDetail(subagent: SubagentInfo): boolean {
  const progress = subagent.progress;
  return Boolean(
    progress?.currentTool
    || progress?.lastIntent
    || progress?.tokens
    || progress?.cost
    || progress?.durationMs
    || progress?.resolvedModel
    || progress?.retryState
    || progress?.retryFailure
    || subagent.detached,
  );
}

"use client";

import type { TodoPhase } from "@/lib/pi-types";
import { TodoList } from "./TodoList";

/**
 * Panels attached above the composer: the live todo plan only. The subagent
 * roster moved to the right-hand Agents panel (5.1) — it is no longer
 * duplicated in the chat column, and the transcript stays free of agent
 * plumbing. TodoList renders collapsed by default with a live header.
 */
export function ComposerPanels({ todoPhases, defaultExpanded = false, planModeActive = false }: {
  todoPhases: TodoPhase[];
  /** Initial expansion of the todo panel (default: collapsed). */
  defaultExpanded?: boolean;
  /** True while a plan surface (PlanPanel) owns the task grid: hide the
   *  duplicate TodoList so tasks render exactly once. */
  planModeActive?: boolean;
}) {
  if (todoPhases.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
      {!planModeActive && <TodoList phases={todoPhases} collapsible defaultExpanded={defaultExpanded} />}
    </div>
  );
}

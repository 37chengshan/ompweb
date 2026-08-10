"use client";

import { useState } from "react";
import { Ban, CheckCircle2, Circle, CircleAlert, CircleDotDashed, ListChecks } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { TodoItem, TodoPhase } from "@/lib/pi-types";

function TodoStatusIcon({ status }: { status: TodoItem["status"] }) {
  const props = { size: 14, strokeWidth: 1.8, "aria-hidden": true as const };
  if (status === "completed") return <CheckCircle2 {...props} color="var(--accent)" />;
  if (status === "in_progress") return <CircleDotDashed {...props} color="var(--accent)" />;
  if (status === "blocked") return <CircleAlert {...props} color="var(--text-muted)" />;
  if (status === "abandoned") return <Ban {...props} color="var(--text-dim)" />;
  return <Circle {...props} color="var(--text-dim)" />;
}

export function TodoList({ phases = [] }: { phases?: TodoPhase[] }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  if (phases.length === 0) return null;

  const tasks = phases.flatMap((phase) => phase.tasks);
  const done = tasks.filter((task) => task.status === "completed").length;
  let remainingPreviewTasks = 5;
  const displayedPhases = (expanded ? phases : phases.slice(0, 4)).map((phase) => {
    const displayedTasks = expanded ? phase.tasks : phase.tasks.slice(0, remainingPreviewTasks);
    remainingPreviewTasks -= displayedTasks.length;
    return { ...phase, tasks: displayedTasks };
  }).filter((phase) => phase.tasks.length > 0);
  const isTruncated = displayedPhases.reduce((count, phase) => count + phase.tasks.length, 0) < tasks.length;

  return (
    <section
      aria-label={t("chatWindow.todoList")}
      className="my-2 overflow-hidden border border-border bg-bg-subtle"
      style={{ borderRadius: "var(--radius-card)" }}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-text-muted">
        <ListChecks size={15} strokeWidth={1.8} aria-hidden />
        <strong className="font-medium text-text">{t("chatWindow.todoList")}</strong>
        <span className="ml-auto">{t("chatWindow.todoProgress", { done, total: tasks.length })}</span>
      </div>
      <div className="grid gap-3 px-3 py-2.5">
        {displayedPhases.map((phase, phaseIndex) => (
          <div key={phase.id ?? `${phase.name}-${phaseIndex}`} className="grid gap-1.5">
            <div className="text-[11px] font-medium text-text-muted">{phase.name}</div>
            <div className="grid gap-1.5">
              {phase.tasks.map((task, taskIndex) => (
                <div
                  key={task.id ?? `${task.content}-${taskIndex}`}
                  className="flex min-w-0 items-start gap-2 text-[13px] text-text"
                  aria-label={`${t(`chatWindow.todoStatus.${task.status}`)}: ${task.content}`}
                >
                  <span className="mt-0.5 shrink-0"><TodoStatusIcon status={task.status} /></span>
                  <span className="min-w-0">
                    <span className={task.status === "completed" || task.status === "abandoned" ? "text-text-dim line-through" : undefined}>
                      {task.content}
                    </span>
                    {task.blocker && (
                      <span className="mt-0.5 block text-[11px] text-text-muted">
                        {t("chatWindow.todoBlocker", { blocker: task.blocker })}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {(isTruncated || expanded) && (
        <button
          type="button"
          className="border-t border-border px-3 py-2 text-left text-xs text-accent hover:text-accent-hover"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t("chatWindow.todoShowLess") : t("chatWindow.todoShowAll")}
        </button>
      )}
    </section>
  );
}

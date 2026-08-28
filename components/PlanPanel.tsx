"use client";

import { useState, memo } from "react";
import {
  Compass,
  Play,
  RotateCcw,
  CheckCircle2,
  CircleDotDashed,
  Circle,
  CircleAlert,
  Ban,
  ChevronDown,
  ChevronUp,
  MessageSquareWarning,
  X,
  Send,
  Sparkles,
} from "lucide-react";
import type { TodoItem, TodoPhase } from "@/lib/pi-types";
import type { ActivePlan } from "@/lib/web-mode-state";
import { useI18n } from "@/lib/i18n";
import { MarkdownBody } from "./MarkdownBody";

interface Props {
  plan?: ActivePlan | null;
  todoPhases?: TodoPhase[];
  onExecutePlan: (prompt: string) => void;
  onRejectPlan: (feedback: string) => void;
  planModeActive?: boolean;
  /** The session's omp plan markdown (from <session>/local/*-plan.md). */
  planContent?: string | null;
  planFile?: string | null;
  /** True when the plan file exceeded the API size cap. */
  planTruncated?: boolean;
}


function TaskStatusIcon({ status }: { status: TodoItem["status"] }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 size={15} style={{ color: "var(--status-success)" }} />;
    case "in_progress":
      return <CircleDotDashed size={15} style={{ color: "var(--accent)" }} />;
    case "blocked":
      return <CircleAlert size={15} style={{ color: "var(--status-warning)" }} />;
    case "cancelled":
      return <Ban size={15} style={{ color: "var(--text-dim)" }} />;
    case "pending":
    default:
      return <Circle size={15} style={{ color: "var(--text-dim)" }} />;
  }
}

export const PlanPanel = memo(function PlanPanel({ plan, todoPhases = [], onExecutePlan, onRejectPlan, planModeActive, planContent = null, planTruncated = false }: Props) {
  const { t, tn } = useI18n();
  const [expanded, setExpanded] = useState(true);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [critiqueText, setCritiqueText] = useState("");


  const hasTasks = todoPhases.length > 0;
  // Plan panel is a plan-mode surface: plain task runs must never render it.
  // Plain todos belong to ComposerPanels' TodoList, which hides itself while
  // a plan is active so the task grid is never duplicated.
  const hasPlan = Boolean(plan?.objective || planModeActive);

  if (!hasPlan) return null;

  const allTasks = todoPhases.flatMap((p) => p.tasks);
  const completedCount = allTasks.filter((t) => t.status === "completed").length;
  const inProgressCount = allTasks.filter((t) => t.status === "in_progress").length;

  const quickCritiques = [
    { label: t("plan.quickYagniLabel"), text: t("plan.quickYagniText") },
    { label: t("plan.quickTestsLabel"), text: t("plan.quickTestsText") },
    { label: t("plan.quickOrderLabel"), text: t("plan.quickOrderText") },
    { label: t("plan.quickCompatLabel"), text: t("plan.quickCompatText") },
  ];

  const handleExecute = () => {
    onExecutePlan(t("plan.executePrompt"));
  };

  const handleRejectSubmit = () => {
    if (!critiqueText.trim()) return;
    const finalPrompt = t("plan.rejectPrompt", { critique: critiqueText.trim() });
    onRejectPlan(finalPrompt);
    setCritiqueText("");
    setRejectModalOpen(false);
  };

  return (
    <div
      className="plan-panel-card animate-fade-in"
      style={{
        marginBottom: 10,
        borderRadius: "var(--radius-card)",
        background: "var(--bg-panel)",
        border: "1.5px solid color-mix(in srgb, var(--accent) 30%, var(--border))",
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          background: "color-mix(in srgb, var(--accent) 6%, var(--bg-panel))",
          borderBottom: expanded ? "1px solid var(--border)" : "none",
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 24,
              height: 24,
              borderRadius: 6,
              background: "var(--accent)",
              color: "var(--on-accent)",
              flexShrink: 0,
            }}
          >
            <Compass size={14} strokeWidth={2.2} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                {t("plan.modeTitle") || "OMP 计划制定模式"}
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "1px 6px",
                  borderRadius: 999,
                  background: inProgressCount > 0 ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "color-mix(in srgb, var(--status-success) 15%, transparent)",
                  color: inProgressCount > 0 ? "var(--accent)" : "var(--status-success)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {allTasks.length > 0
                  ? tn("plan.tasksDone", completedCount, { completed: completedCount, total: allTasks.length })
                  : t("plan.pendingPlanning")}
              </span>
            </div>
            {plan?.objective && (
              <p
                style={{
                  margin: "2px 0 0",
                  fontSize: 12,
                  color: "var(--text-muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {plan.objective}
              </p>
            )}
          </div>
        </div>

        {/* Action button cluster */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {(allTasks.length > 0 || Boolean(planContent)) && (
            <>
              <button
                type="button"
                onClick={handleExecute}
                className="ui-focus-ring"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 10px",
                  borderRadius: "var(--radius-control)",
                  background: "var(--accent)",
                  color: "var(--on-accent)",
                  fontSize: 12,
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
                }}
              >
                <Play size={12} strokeWidth={2.4} />
                <span>{t("plan.executeButton") || "执行此计划"}</span>
              </button>

              <button
                type="button"
                onClick={() => setRejectModalOpen(true)}
                className="ui-focus-ring"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 10px",
                  borderRadius: "var(--radius-control)",
                  background: "var(--bg)",
                  color: "var(--status-warning)",
                  border: "1px solid var(--border)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <MessageSquareWarning size={12} strokeWidth={2} />
                <span>{t("plan.rejectButton") || "打回修改"}</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? t("plan.collapse") : t("plan.expand")}
            className="shell-toolbar-btn ui-focus-ring"
            style={{ width: 26, height: 26, borderRadius: 6 }}
          >
            {expanded ? <ChevronUp size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
          </button>
        </div>
      </div>

      {/* Plan document (omp plan-mode markdown) — shown above the task grid
          when the session produced a local plan file. */}
      {expanded && (
        <div style={{ padding: "12px 14px" }}>
          {planContent && (
            <div
              style={{
                maxHeight: "50vh",
                overflowY: "auto",
                marginBottom: hasTasks ? 12 : 0,
                padding: "10px 12px",
                borderRadius: "var(--radius-control)",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                fontSize: 13,
                lineHeight: 1.55,
                color: "var(--text)",
              }}
            >
              <MarkdownBody>{planContent}</MarkdownBody>
              {planTruncated && (
                <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-dim)" }}>
                  {t("plan.truncatedNote")}
                </div>
              )}
            </div>
          )}
          {hasTasks ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {todoPhases.map((phase, pIdx) => (
                <div key={phase.id ?? `phase-${pIdx}`} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--text-dim)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {t("plan.phaseLabel", { index: pIdx + 1, name: phase.name })}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 6 }}>
                    {phase.tasks.map((task, tIdx) => (
                      <div
                        key={task.id ?? `task-${tIdx}`}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                          fontSize: 13,
                          color: task.status === "completed" ? "var(--text-dim)" : "var(--text)",
                          textDecoration: task.status === "completed" ? "line-through" : "none",
                        }}
                      >
                        <span style={{ marginTop: 2, flexShrink: 0 }}>
                          <TaskStatusIcon status={task.status} />
                        </span>
                        <span style={{ flex: 1, lineHeight: 1.4 }}>{task.content}</span>
                        {task.blocker && (
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--status-warning)",
                              background: "color-mix(in srgb, var(--status-warning) 10%, transparent)",
                              padding: "1px 6px",
                              borderRadius: 4,
                            }}
                          >
                            {t("plan.blockedBy", { blocker: task.blocker })}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: "8px 0", color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>
              <Sparkles size={16} style={{ color: "var(--accent)", margin: "0 auto 6px" }} />
              <p style={{ margin: 0 }}>{t("plan.standby")}</p>
            </div>
          )}
        </div>
      )}

      {/* 打回修改反馈弹窗 Reject / Critique Modal */}
      {rejectModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 900,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0, 0, 0, 0.45)",
            backdropFilter: "blur(2px)",
            padding: 16,
          }}
          onClick={() => setRejectModalOpen(false)}
        >
          <div
            className="dropdown-surface animate-scale-in"
            style={{
              width: "100%",
              maxWidth: 520,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-modal)",
              boxShadow: "var(--shadow-modal)",
              padding: 20,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <MessageSquareWarning size={18} style={{ color: "var(--status-warning)" }} />
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
                  {t("plan.critiqueModalTitle") || "打回计划 · 提供修改建议"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRejectModalOpen(false)}
                className="shell-toolbar-btn ui-focus-ring"
                style={{ width: 28, height: 28, borderRadius: 6 }}
              >
                <X size={16} />
              </button>
            </div>

            <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {t("plan.critiqueBody")}
            </p>

            {/* Quick critique preset tags */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {quickCritiques.map((item, qIdx) => (
                <button
                  key={qIdx}
                  type="button"
                  onClick={() => setCritiqueText((prev) => (prev ? `${prev}\n${item.text}` : item.text))}
                  style={{
                    fontSize: 11,
                    padding: "3px 8px",
                    borderRadius: 6,
                    background: "var(--bg-panel)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
                >
                  + {item.label}
                </button>
              ))}
            </div>

            {/* Critique input textarea */}
            <textarea
              rows={4}
              value={critiqueText}
              onChange={(e) => setCritiqueText(e.target.value)}
              placeholder={t("plan.critiquePlaceholder")}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "var(--radius-control)",
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                fontSize: 13,
                fontFamily: "inherit",
                resize: "vertical",
                outline: "none",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
            />

            {/* Modal action buttons */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={() => setRejectModalOpen(false)}
                style={{
                  padding: "6px 14px",
                  borderRadius: "var(--radius-control)",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {t("plan.cancel")}
              </button>
              <button
                type="button"
                onClick={handleRejectSubmit}
                disabled={!critiqueText.trim()}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 16px",
                  borderRadius: "var(--radius-control)",
                  background: "var(--accent)",
                  color: "var(--on-accent)",
                  fontSize: 13,
                  fontWeight: 600,
                  border: "none",
                  cursor: critiqueText.trim() ? "pointer" : "not-allowed",
                  opacity: critiqueText.trim() ? 1 : 0.5,
                }}
              >
                <Send size={13} />
                <span>{t("plan.submitCritique")}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

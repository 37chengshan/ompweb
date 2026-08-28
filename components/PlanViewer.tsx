"use client";

import { useEffect, useState, useCallback } from "react";
import { PlanPanel } from "./PlanPanel";
import { useI18n } from "@/lib/i18n";
import type { TodoPhase } from "@/lib/pi-types";

interface Props {
  sessionId: string;
  /** Fill the composer with the execute/reject prompt (user presses Enter). */
  onComposerPrompt?: (text: string) => void;
}

interface PlanInfo {
  planModeActive: boolean;
  plan: string | null;
  planFile: string | null;
  truncated: boolean;
}

/**
 * Plan document viewer for the right sidebar panel (opened via the composer's
 * plan-mode pill). Fetches the omp plan artifact and the session's todo phases
 * independently — the chat hook's planInfo lives inside ChatWindow, so this
 * panel stays self-contained and works for any session id, even one not
 * currently open in the chat.
 */
export function PlanViewer({ sessionId, onComposerPrompt }: Props) {
  const { t } = useI18n();
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);
  const [todoPhases, setTodoPhases] = useState<TodoPhase[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const sid = encodeURIComponent(sessionId);
    const load = async () => {
      try {
        const [planRes, sessionRes] = await Promise.all([
          fetch(`/api/sessions/${sid}/plan`),
          fetch(`/api/sessions/${sid}?deferThinking=1&deferMedia=1`),
        ]);
        if (cancelled) return;
        const planData = planRes.ok ? await planRes.json() as Partial<PlanInfo> : null;
        const sessionData = sessionRes.ok ? await sessionRes.json() as { context?: { todoPhases?: TodoPhase[] } } : null;
        setPlanInfo({
          planModeActive: Boolean(planData?.planModeActive),
          plan: typeof planData?.plan === "string" ? planData.plan : null,
          planFile: typeof planData?.planFile === "string" ? planData.planFile : null,
          truncated: Boolean(planData?.truncated),
        });
        setTodoPhases(sessionData?.context?.todoPhases ?? []);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [sessionId]);

  if (error) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: "var(--status-error)" }}>
        {t("planViewer.loadFailed")}: {error}
      </div>
    );
  }

  // Always render the panel shell (loading state shows inside); the pill in
  // the composer is the only entry point, so a missing artifact shows a hint.
  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 10 }}>
      <PlanPanel
        plan={null}
        todoPhases={todoPhases}
        onExecutePlan={(prompt) => onComposerPrompt?.(prompt)}
        onRejectPlan={(prompt) => onComposerPrompt?.(prompt)}
        planModeActive={planInfo?.planModeActive ?? true}
        planContent={planInfo?.plan ?? null}
        planFile={planInfo?.planFile ?? null}
        planTruncated={planInfo?.truncated ?? false}
      />
      {!planInfo?.plan && todoPhases.length === 0 && (
        <div style={{ padding: "10px 4px", fontSize: 12, color: "var(--text-dim)" }}>
          {t("planViewer.noPlan")}
        </div>
      )}
    </div>
  );
}
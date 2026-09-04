"use client";

import type { ReactNode } from "react";
import { Activity, RefreshCw, Wrench } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { SubagentInfo } from "@/hooks/useAgentSession";

/** Icon-first metric line (mirror of the composer roster's SubagentMetric). */
export function AgentMetric({ icon: Icon, label, children }: {
  icon: typeof Wrench;
  label: string;
  children: ReactNode;
}) {
  return (
    <span aria-label={label} title={label} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <Icon size={10.5} strokeWidth={1.8} aria-hidden />
      <span>{children}</span>
    </span>
  );
}

/** Secondary live line of one running agent card: retry state takes
 *  precedence, then current tool + intent. Renders nothing when idle. */
export function SubagentLiveLine({ subagent }: { subagent: SubagentInfo }) {
  const { t } = useI18n();
  const progress = subagent.progress;
  if (subagent.status !== "started") return null;

  const retryState = progress?.retryState;
  const retryFailure = progress?.retryFailure;
  if (retryState || retryFailure) {
    const attempt = retryState?.attempt ?? retryFailure?.attempt ?? 0;
    const maxAttempts = retryState?.maxAttempts ?? 0;
    const label = maxAttempts > 0
      ? t("chatWindow.subagentRetrying", { attempt, max: maxAttempts })
      : t("chatWindow.subagentRetryAttempt", { attempt });
    return (
      <AgentMetric icon={RefreshCw} label={label}>
        {maxAttempts > 0 ? `${attempt}/${maxAttempts}` : attempt}
      </AgentMetric>
    );
  }

  const activity = progress?.currentTool
    ? `${progress.currentTool}${progress.lastIntent ? ` — ${progress.lastIntent}` : ""}`
    : progress?.lastIntent;
  if (!activity) return null;

  return (
    <AgentMetric icon={progress?.currentTool ? Wrench : Activity} label={activity}>
      {activity}
    </AgentMetric>
  );
}

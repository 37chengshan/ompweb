"use client";

import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { ProviderUsageReport, ProviderUsageSnapshot } from "@/lib/provider-usage-types";

interface Props {
  provider?: string;
  modelId?: string;
}

function reportText(report: ProviderUsageReport, noLimitsLabel: string): string {
  if (report.noLimits) return noLimitsLabel;
  const parts: string[] = [];
  if (report.tier) parts.push(report.tier);
  if (report.fiveHour) parts.push(`5h ${Math.round(report.fiveHour.percent)}%`);
  if (report.sevenDay) parts.push(`7d ${Math.round(report.sevenDay.percent)}%`);
  if (report.monthly) parts.push(`mo ${Math.floor(report.monthly.percent)}%`);
  return parts.join(" · ") || noLimitsLabel;
}

/** Top-bar provider usage badge: fetches /api/provider-usage for the current
 *  provider/model and shows a compact percentage with the full report as the
 *  tooltip. Clicking re-fetches. */
export function ProviderUsageBadge({ provider, modelId }: Props) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<ProviderUsageSnapshot | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  const load = () => {
    setState("loading");
    const params = new URLSearchParams();
    if (provider) params.set("provider", provider);
    if (modelId) params.set("model", modelId);
    fetch(`/api/provider-usage?${params}`)
      .then((res) => (res.ok ? res.json() as Promise<ProviderUsageSnapshot> : null))
      .then((data) => {
        setSnapshot(data);
        setState(data ? "idle" : "error");
      })
      .catch(() => setState("error"));
  };

  useEffect(() => {
    setSnapshot(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, modelId]);

  // Without a provider filter the API returns every account/report; show the
  // first one that has limits (or any noLimits marker) so the badge is useful
  // even when AppShell does not know the active model.
  const report = snapshot?.reports.find((r) => !r.noLimits)
    ?? (provider ? snapshot?.reports.find((r) => r.provider === provider) : null)
    ?? snapshot?.reports[0]
    ?? null;
  if (state === "error" || (state === "idle" && !report)) return null;

  const label = report
    ? reportText(report, t("appShell.providerUsageNoData"))
    : state === "loading" ? t("appShell.providerUsageLoading") : t("appShell.providerUsageUnavailable");

  return (
    <button
      type="button"
      onClick={load}
      title={t("appShell.providerUsageButton")}
      aria-label={t("appShell.providerUsageButton")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "0 6px",
        height: 24,
        border: "none",
        borderRadius: 6,
        background: "none",
        color: "var(--text-muted)",
        cursor: "pointer",
        fontSize: 11,
        whiteSpace: "nowrap",
        fontFamily: "var(--font-mono)",
      }}
    >
      <Gauge size={12} strokeWidth={1.8} aria-hidden="true" style={{ color: "var(--accent)" }} />
      <span title={report ? reportText(report, t("appShell.providerUsageNoData")) : undefined}>{label}</span>
    </button>
  );
}

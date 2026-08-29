"use client";

import { useEffect, useRef, useState } from "react";
import { Gauge } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { ProviderUsageReport, ProviderUsageSnapshot, ProviderUsageWindow } from "@/lib/provider-usage-types";

interface Props {
  provider?: string;
  modelId?: string;
}

type WindowKey = "fiveHour" | "sevenDay" | "monthly";
const WINDOW_KEYS: Array<{ key: WindowKey; label: string }> = [
  { key: "fiveHour", label: "5h" },
  { key: "sevenDay", label: "7d" },
  { key: "monthly", label: "mo" },
];

function windowPercent(report: ProviderUsageReport, key: WindowKey): number | null {
  const window = report[key] as ProviderUsageWindow | undefined;
  return window ? Math.round(window.percent) : null;
}

function windowText(window: ProviderUsageWindow | undefined, prefix: string): string | null {
  if (!window) return null;
  const percent = Math.round(window.percent);
  const reset = window.resetMinutes !== undefined
    ? ` (${window.resetMinutes}m)`
    : window.resetHours !== undefined
      ? ` (${window.resetHours}h)`
      : "";
  return `${prefix} ${percent}%${reset}`;
}

/** Badge shows the WORST account per window (the max percent across every
 *  report of the matching provider) so a near-limit or exhausted account is
 *  never hidden behind the first account in the list. */
function worstCase(reports: ProviderUsageReport[]): ProviderUsageReport {
  const base = reports[0] ?? { provider: "?", noLimits: true } as ProviderUsageReport;
  for (const key of WINDOW_KEYS.map((w) => w.key)) {
    const worst = reports.reduce<ProviderUsageWindow | null>((best, report) => {
      const current = report[key] as ProviderUsageWindow | undefined;
      if (!current) return best;
      if (!best || current.percent > best.percent) return current;
      return best;
    }, null);
    if (worst) base[key] = worst as never;
  }
  return base;
}

/** Top-bar provider usage badge: fetches /api/provider-usage and shows the
 *  worst-case usage across every account of the provider. Clicking expands a
 *  panel listing each account with its 5h/7d/monthly percentages and resets.
 *  Without a provider filter the API returns all accounts of all providers. */
export function ProviderUsageBadge({ provider, modelId }: Props) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<ProviderUsageSnapshot | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

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
    setOpen(false);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, modelId]);

  // Click-outside closes the panel.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const reports = (snapshot?.reports ?? []).filter((report) => !provider || report.provider === provider);
  const limited = reports.filter((report) => !report.noLimits);
  if (state === "error" || (state === "idle" && limited.length === 0)) return null;

  const worst = worstCase(limited.length > 0 ? limited : reports);
  const hasData = limited.length > 0;
  const label = hasData
    ? WINDOW_KEYS.map(({ key, label: prefix }) => windowText(worst[key] as ProviderUsageWindow | undefined, prefix)).filter(Boolean).join(" · ")
    : t("appShell.providerUsageNoData");

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        onClick={() => {
          if (!hasData) { void load(); return; }
          setOpen((v) => !v);
        }}
        title={t("appShell.providerUsageButton")}
        aria-label={t("appShell.providerUsageButton")}
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "0 6px",
          height: 24,
          border: "none",
          borderRadius: 6,
          background: open ? "var(--bg-hover)" : "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 11,
          whiteSpace: "nowrap",
          fontFamily: "var(--font-mono)",
        }}
      >
        <Gauge size={12} strokeWidth={1.8} aria-hidden="true" style={{ color: "var(--accent)" }} />
        <span>{state === "loading" && !hasData ? t("appShell.providerUsageLoading") : label}</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={t("appShell.sectionProviderUsage")}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 500,
            minWidth: 300,
            maxWidth: 420,
            maxHeight: 320,
            overflowY: "auto",
            padding: "10px 12px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-card)",
            background: "var(--bg-panel)",
            boxShadow: "var(--shadow-pop)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontSize: 12,
            color: "var(--text)",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 12 }}>{t("appShell.sectionProviderUsage")}</div>
          {reports.length === 0 && (
            <span style={{ color: "var(--text-muted)" }}>{t("appShell.providerUsageNoData")}</span>
          )}
          {reports.map((report, index) => (
            <div key={`${report.provider}-${index}`} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "6px 0", borderTop: index > 0 ? "1px solid var(--border)" : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontWeight: 500 }}>{report.provider}</span>
                {report.accountLabel ? (
                  <span style={{ color: "var(--text-muted)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{report.accountLabel}</span>
                ) : (
                  <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{t("appShell.account", { number: report.accountIndex ?? index + 1 })}</span>
                )}
                {report.plan && <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{report.plan}</span>}
              </div>
              {report.noLimits ? (
                <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{t("appShell.providerUsageNoData")}</span>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", color: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
                  {WINDOW_KEYS.map(({ key, label: prefix }) => {
                    const window = report[key] as ProviderUsageWindow | undefined;
                    const text = windowText(window, prefix);
                    if (!text || !window) return null;
                    const percent = Math.round(window.percent);
                    const color = percent >= 80 ? "var(--status-error)" : percent >= 50 ? "var(--status-warning, #c98a1b)" : undefined;
                    return <span key={key} style={color ? { color } : undefined}>{text}</span>;
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

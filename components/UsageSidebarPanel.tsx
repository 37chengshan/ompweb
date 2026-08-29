"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Gauge } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { formatCompactNumber } from "@/lib/format";
import type { ProviderUsageReport, ProviderUsageWindow } from "@/lib/provider-usage-types";

const USAGE_PANEL_OPEN_KEY = "omp-web:usage-panel-open";

type WindowKey = "fiveHour" | "sevenDay" | "monthly";
const WINDOW_KEYS: Array<{ key: WindowKey; label: string }> = [
  { key: "fiveHour", label: "5h" },
  { key: "sevenDay", label: "7d" },
  { key: "monthly", label: "mo" },
];

interface UsageSummary {
  today?: number;
  week?: number;
  month?: number;
  total?: number;
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

/**
 * Sidebar usage panel: total token usage buckets (today/week/month/total)
 * aggregated from local session files, plus per-account rate-limit rows
 * (5h/7d/monthly) from omp usage. Lives in the sidebar footer.
 */
export function UsageSidebarPanel() {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(USAGE_PANEL_OPEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [reports, setReports] = useState<ProviderUsageReport[] | null>(null);
  const [error, setError] = useState(false);
  const loadedRef = useRef(false);

  const load = useCallback(() => {
    setError(false);
    void Promise.all([
      fetch("/api/usage-summary").then((res) => (res.ok ? res.json() as Promise<UsageSummary> : null)),
      fetch("/api/provider-usage").then((res) => (res.ok ? res.json() as Promise<{ reports: ProviderUsageReport[] }> : null)),
    ])
      .then(([sum, usage]) => {
        setSummary(sum);
        setReports(usage?.reports ?? null);
        if (sum || usage) setError(false);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    if (open && !loadedRef.current) {
      loadedRef.current = true;
      load();
    }
  }, [open, load]);

  useEffect(() => {
    try {
      window.localStorage.setItem(USAGE_PANEL_OPEN_KEY, open ? "1" : "0");
    } catch { /* storage unavailable */ }
  }, [open]);

  const limited = (reports ?? []).filter((r) => !r.noLimits);
  const hasAny = limited.length > 0;

  return (
    <div style={{ borderTop: "1px solid var(--border)" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={t("sidebar.usage")}
        style={{
          width: "100%",
          height: 32,
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "0 12px",
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          textAlign: "left",
          fontSize: 12,
        }}
      >
        <Gauge size={14} strokeWidth={2} aria-hidden="true" style={{ color: "var(--accent)", flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0 }}>{t("sidebar.usage")}</span>
        <ChevronDownIcon open={open} />
      </button>

      {open && (
        <div style={{ maxHeight: "min(50vh, 380px)", overflowY: "auto", padding: "8px 12px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
          {error && (
            <span style={{ fontSize: 11, color: "var(--status-error)" }}>{t("sidebar.usageEmpty")}</span>
          )}
          {!error && !summary && (
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("sidebar.usageLoading")}</span>
          )}
          {summary && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
              {([
                ["usageToday", summary.today ?? 0],
                ["usageWeek", summary.week ?? 0],
                ["usageMonth", summary.month ?? 0],
                ["usageTotal", summary.total ?? 0],
              ] as Array<[string, number]>).map(([key, value]) => (
                <div key={key} style={{ display: "flex", flexDirection: "column", gap: 2, padding: "6px 4px", borderRadius: 6, background: "var(--bg-subtle)" }}>
                  <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{t(`sidebar.${key}`)}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "var(--font-mono)", color: "var(--text)" }}>{formatCompactNumber(value, locale)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>{t("sidebar.usageLimits")}</div>
          {(reports ?? []).length === 0 && !error && (
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("sidebar.usageEmpty")}</span>
          )}
          {(reports ?? []).map((report, index) => (
            <div key={`${report.provider}-${index}`} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                <span style={{ fontWeight: 500, color: "var(--text)" }}>{report.provider}</span>
                {report.accountLabel ? (
                  <span style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>{report.accountLabel}</span>
                ) : (
                  <span style={{ color: "var(--text-dim)" }}>{t("appShell.account", { number: report.accountIndex ?? index + 1 })}</span>
                )}
                {report.plan && <span style={{ color: "var(--text-dim)" }}>{report.plan}</span>}
              </div>
              {report.noLimits ? (
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("sidebar.usageEmpty")}</span>
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
          {hasAny && (
            <button
              type="button"
              onClick={load}
              style={{ alignSelf: "flex-start", border: "none", background: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: 11, padding: 0 }}
            >
              {t("sidebar.usageRefresh")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : undefined, transition: "transform var(--dur-fast) var(--ease-out-warm)" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

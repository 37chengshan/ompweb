"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Gauge, LoaderCircle, RefreshCw, Settings2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { formatCompactNumber } from "@/lib/format";
import type { ProviderUsageReport, ProviderUsageWindow } from "@/lib/provider-usage-types";

const USAGE_PANEL_OPEN_KEY = "omp-web:usage-panel-open";
const USAGE_VISIBLE_ACCOUNTS_KEY = "omp-web:usage-visible-accounts";

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
  const [closing, setClosing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [manageAccounts, setManageAccounts] = useState(false);
  const [hiddenAccounts, setHiddenAccounts] = useState<Set<string>>(new Set());
  const loadedRef = useRef(false);

  const load = useCallback(() => {
    setError(false);
    setRefreshing(true);
    const startedAt = Date.now();
    void Promise.all([
      fetch("/api/usage-summary").then((res) => (res.ok ? res.json() as Promise<UsageSummary> : null)),
      fetch("/api/provider-usage").then((res) => (res.ok ? res.json() as Promise<{ reports: ProviderUsageReport[] }> : null)),
    ])
      .then(([sum, usage]) => {
        setSummary(sum);
        setReports(usage?.reports ?? null);
        if (sum || usage) setError(false);
        setUpdatedAt(Date.now());
      })
      .catch(() => setError(true))
      .finally(() => {
        // Keep the spinner visible long enough to be perceivable, so a manual
        // refresh feels acknowledged instead of silently finishing.
        const remaining = 350 - (Date.now() - startedAt);
        window.setTimeout(() => setRefreshing(false), Math.max(0, remaining));
      });
  }, []);

  useEffect(() => {
    if (open && !loadedRef.current) {
      loadedRef.current = true;
      load();
    }
  }, [open, load]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(USAGE_VISIBLE_ACCOUNTS_KEY) || "[]") as unknown;
      if (Array.isArray(saved)) setHiddenAccounts(new Set(saved.filter((value): value is string => typeof value === "string")));
    } catch { /* ignore malformed/private storage */ }
  }, []);

  const accountKey = useCallback((report: ProviderUsageReport, index: number) => `${report.provider}:${report.accountLabel ?? report.accountIndex ?? index + 1}`, []);
  const toggleAccount = useCallback((key: string) => {
    setHiddenAccounts((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { window.localStorage.setItem(USAGE_VISIBLE_ACCOUNTS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Keep the body mounted briefly after close so the exit animation can play.
  useEffect(() => {
    if (open) {
      setClosing(false);
      return;
    }
    if (!loadedRef.current) return;
    setClosing(true);
    const timer = window.setTimeout(() => setClosing(false), 180);
    return () => window.clearTimeout(timer);
  }, [open]);

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

      {(open || closing) && (
        <div
          className={open ? "animate-slide-down" : "animate-slide-down-out"}
          style={{ maxHeight: "min(50vh, 380px)", overflowY: "auto", padding: "8px 12px 12px", display: "flex", flexDirection: "column", gap: 10 }}
        >
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

          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ flex: 1, fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>{t("sidebar.usageLimits")}</div>
            <button type="button" onClick={() => setManageAccounts((value) => !value)} aria-expanded={manageAccounts} aria-label={t("sidebar.usageManageAccounts")} title={t("sidebar.usageManageAccounts")} style={{ display: "grid", placeItems: "center", width: 22, height: 22, padding: 0, border: "1px solid var(--border)", borderRadius: 5, background: manageAccounts ? "var(--bg-selected)" : "var(--bg-panel)", color: manageAccounts ? "var(--accent)" : "var(--text-dim)", cursor: "pointer" }}><Settings2 size={12} aria-hidden="true" /></button>
          </div>
          {manageAccounts && (reports ?? []).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "6px 7px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-subtle)" }}>
              <div style={{ fontSize: 10, color: "var(--text-dim)", lineHeight: 1.4 }}>{t("sidebar.usageManageHint")}</div>
              {(reports ?? []).map((report, index) => {
                const key = accountKey(report, index);
                const hidden = hiddenAccounts.has(key);
                return <button key={`manage-${key}`} type="button" onClick={() => toggleAccount(key)} aria-pressed={!hidden} style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 24, padding: "2px 3px", border: 0, background: "transparent", color: hidden ? "var(--text-dim)" : "var(--text)", cursor: "pointer", textAlign: "left", fontSize: 10.5, opacity: hidden ? 0.65 : 1 }}>
                  {hidden ? <EyeOff size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{report.provider} · {report.accountLabel ?? t("appShell.account", { number: report.accountIndex ?? index + 1 })}</span>
                </button>;
              })}
            </div>
          )}
          {(reports ?? []).length === 0 && !error && (
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("sidebar.usageEmpty")}</span>
          )}
          {(reports ?? []).map((report, index) => ({ report, index, key: accountKey(report, index) })).filter(({ key }) => !hiddenAccounts.has(key)).map(({ report, index, key }) => (
            <div key={key} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
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
          {(reports ?? []).length > 0 && (reports ?? []).every((report, index) => hiddenAccounts.has(accountKey(report, index))) && (
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("sidebar.usageAllHidden")}</span>
          )}
          {hasAny && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={load}
                disabled={refreshing}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "none", background: "none", color: "var(--text-dim)", cursor: refreshing ? "default" : "pointer", fontSize: 11, padding: 0 }}
              >
                {refreshing ? <LoaderCircle size={12} strokeWidth={2} className="icon-spin" aria-hidden="true" /> : <RefreshCw size={12} strokeWidth={2} aria-hidden="true" />}
                {refreshing ? t("sidebar.usageUpdating") : t("sidebar.usageRefresh")}
              </button>
              {updatedAt && (<span style={{ fontSize: 10, color: "var(--text-dim)" }}>{t("sidebar.usageUpdated", { time: new Date(updatedAt).toLocaleTimeString(locale) })}</span>)}
            </div>
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

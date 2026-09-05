"use client";

import { useI18n } from "@/lib/i18n";
import { SvgGaugeRing } from "./charts/SvgGaugeRing";
import { formatResetTime } from "@/lib/usage-format";
import { Zap, Calendar, RefreshCw } from "lucide-react";

interface LimitScope {
  provider?: string;
  windowId?: string;
  shared?: boolean;
}

interface LimitWindow {
  id?: string;
  label?: string;
  resetsAt?: number;
  durationMs?: number;
}

interface LimitAmount {
  used?: number;
  usedFraction?: number;
  remainingFraction?: number;
  unit?: string;
}

interface AccountLimit {
  id: string;
  label: string;
  scope?: LimitScope;
  window?: LimitWindow;
  amount?: LimitAmount;
  status?: string;
}

export interface UsageReport {
  provider: string;
  fetchedAt?: number;
  limits?: AccountLimit[];
  metadata?: {
    planType?: string;
    endpoint?: string;
    email?: string;
    accountId?: string;
  };
}

export interface CapacityWindow {
  window: string;
  accounts: number;
  usedAccounts: number;
  remainingAccounts: number;
}

interface Props {
  reports: UsageReport[];
  capacity?: Record<string, CapacityWindow[]>;
  onRefresh?: () => void;
  loading?: boolean;
}

export function UsageTabLimits({ reports, capacity, onRefresh, loading }: Props) {
  const { t } = useI18n();

  if (!reports || reports.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 20px",
          color: "var(--text-muted)",
          textAlign: "center",
          gap: 12,
        }}
      >
        <Zap size={32} strokeWidth={1.5} style={{ color: "var(--accent)", opacity: 0.6 }} />
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
          {loading ? "正在同步实时配额数据..." : (t("usage.noAccountsFound") || "暂无账户配额数据")}
        </div>
        <div style={{ fontSize: 12, maxWidth: 400, lineHeight: 1.5 }}>
          {loading ? "请稍候，正在获取最新配额与用量..." : (t("usage.noAccountsHint") || "当前配置的 Provider 尚未返回动态用量限额，或正在等待刷新。")}
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            style={{
              marginTop: 8,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              background: "var(--accent-strong)",
              color: "var(--on-accent)",
              border: "none",
              borderRadius: "var(--radius-control)",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            {t("usage.refreshQuota") || "重新获取配额"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: "4px 0" }}>
      {/* Capacity Overview Bar if available */}
      {capacity && Object.keys(capacity).length > 0 && (
        <div
          style={{
            padding: "16px",
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-card)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {t("usage.accountPoolCapacity") || "账号池整体负载容量 (Pool Capacity)"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            {Object.entries(capacity).map(([providerName, windows]) => (
              <div key={providerName} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{providerName}</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {windows.map((win) => {
                    const pct = win.accounts > 0 ? Math.round((win.usedAccounts / win.accounts) * 100) : 0;
                    return (
                      <div
                        key={win.window}
                        style={{
                          padding: "8px 12px",
                          background: "var(--bg-panel)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-control)",
                          fontSize: 11,
                          flex: 1,
                          minWidth: 100,
                        }}
                      >
                        <div style={{ color: "var(--text-dim)", textTransform: "uppercase", fontSize: 10 }}>
                          {win.window}
                        </div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4 }}>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700, color: pct >= 80 ? "var(--status-error)" : "var(--text)" }}>
                            {pct}%
                          </span>
                          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                            ({win.usedAccounts.toFixed(1)} / {win.accounts} 账号)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Individual Account Rate Limit Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {reports.map((report, idx) => {
          const accountTitle = report.metadata?.email || report.metadata?.accountId || `${report.provider} #${idx + 1}`;
          const planLabel = report.metadata?.planType || report.provider;

          return (
            <div
              key={idx}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 16,
                padding: "18px",
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-card)",
                boxShadow: "var(--shadow-card)",
              }}
            >
              {/* Account Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: "color-mix(in srgb, var(--accent) 12%, transparent)",
                      color: "var(--accent)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Zap size={15} strokeWidth={2} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                      {accountTitle}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                      {planLabel}
                    </div>
                  </div>
                </div>

                {report.fetchedAt && (
                  <div style={{ fontSize: 11, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 4 }}>
                    <Calendar size={12} />
                    {new Date(report.fetchedAt).toLocaleTimeString()}
                  </div>
                )}
              </div>

              {/* Gauge Grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 16,
                }}
              >
                {(report.limits ?? []).map((limit) => {
                  const fraction = limit.amount?.usedFraction ?? (limit.amount?.used !== undefined ? limit.amount.used / 100 : 0);
                  const resetDetail = limit.window?.resetsAt ? formatResetTime(limit.window.resetsAt) : undefined;

                  return (
                    <SvgGaugeRing
                      key={limit.id}
                      fraction={fraction}
                      label={limit.label}
                      sublabel={limit.window?.label || limit.id}
                      detail={resetDetail}
                      status={limit.status}
                      size={120}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

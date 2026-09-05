"use client";

import { useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { formatTokenCount, formatCostUsd, formatTokensPerSecond, formatDurationMs } from "@/lib/usage-format";
import { SvgDonutChart } from "./charts/SvgDonutChart";
import { SvgStackedBarChart } from "./charts/SvgStackedBarChart";
import { Trophy, Flame, Gauge, Sparkles } from "lucide-react";

export interface ModelStatItem {
  model: string;
  provider: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  errorRate: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  cacheRate: number;
  cacheSavings: number;
  totalCost: number;
  avgDuration: number | null;
  avgTtft: number | null;
  avgTokensPerSecond: number | null;
}

export interface OverallStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  errorRate: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  cacheRate: number;
  cacheSavings: number;
  totalCost: number;
  avgDuration: number;
  avgTtft: number;
  avgTokensPerSecond: number;
}

interface Props {
  overall: OverallStats | null;
  byModel: ModelStatItem[];
}

export function UsageTabModels({ overall, byModel }: Props) {
  const { t, locale } = useI18n();

  // Sort models by total tokens descending
  const sortedModels = useMemo(() => {
    return [...byModel].sort((a, b) => {
      const aTokens = a.totalInputTokens + a.totalOutputTokens + a.totalCacheReadTokens;
      const bTokens = b.totalInputTokens + b.totalOutputTokens + b.totalCacheReadTokens;
      return bTokens - aTokens;
    });
  }, [byModel]);

  const topTokenModel = sortedModels[0] ?? null;
  const topCostModel = useMemo(() => {
    return [...byModel].sort((a, b) => b.totalCost - a.totalCost)[0] ?? null;
  }, [byModel]);

  const fastestModel = useMemo(() => {
    const valid = byModel.filter((m) => (m.avgTokensPerSecond ?? 0) > 0);
    return valid.sort((a, b) => (b.avgTokensPerSecond ?? 0) - (a.avgTokensPerSecond ?? 0))[0] ?? null;
  }, [byModel]);

  // Donut data for Token Share
  const tokenDonutItems = useMemo(() => {
    return sortedModels.slice(0, 6).map((m) => {
      const total = m.totalInputTokens + m.totalOutputTokens + m.totalCacheReadTokens;
      return {
        label: m.model,
        value: total,
        color: "",
        sublabel: m.provider,
      };
    });
  }, [sortedModels]);

  // Donut data for Cost Share
  const costDonutItems = useMemo(() => {
    return [...byModel]
      .filter((m) => m.totalCost > 0)
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, 6)
      .map((m) => ({
        label: m.model,
        value: m.totalCost,
        color: "",
        sublabel: m.provider,
      }));
  }, [byModel]);

  // Global Token Breakdown
  const globalTokenSegments = useMemo(() => {
    if (!overall) return [];
    return [
      { label: t("usage.cacheRead") || "缓存读取 (Cache Read)", value: overall.totalCacheReadTokens, color: "#f59e0b" },
      { label: t("usage.inputTokens") || "输入 (Input)", value: overall.totalInputTokens, color: "#3b82f6" },
      { label: t("usage.outputTokens") || "输出 (Output)", value: overall.totalOutputTokens, color: "#10b981" },
    ];
  }, [overall, t]);

  const maxModelTokens = useMemo(() => {
    if (!sortedModels.length) return 1;
    const first = sortedModels[0];
    return first.totalInputTokens + first.totalOutputTokens + first.totalCacheReadTokens || 1;
  }, [sortedModels]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: "4px 0" }}>
      {/* 4 Hero KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        {/* Top Token Consuming Model */}
        <div
          style={{
            padding: "16px",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-card)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {t("usage.mostUsedModel") || "🏆 消耗最高模型"}
            </span>
            <div style={{ width: 26, height: 26, borderRadius: 6, background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Trophy size={14} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={topTokenModel?.model}>
              {topTokenModel?.model ?? "无"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>
              {topTokenModel ? `${formatTokenCount(topTokenModel.totalInputTokens + topTokenModel.totalOutputTokens + topTokenModel.totalCacheReadTokens, locale)} Tokens` : "-"}
            </div>
          </div>
        </div>

        {/* Highest Cost Model */}
        <div
          style={{
            padding: "16px",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-card)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {t("usage.highestCostModel") || "💰 支出最高模型"}
            </span>
            <div style={{ width: 26, height: 26, borderRadius: 6, background: "color-mix(in srgb, #ef4444 15%, transparent)", color: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Flame size={14} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={topCostModel?.model}>
              {topCostModel?.model ?? "无"}
            </div>
            <div style={{ fontSize: 12, color: "var(--status-error)", fontWeight: 600, marginTop: 2 }}>
              {topCostModel ? formatCostUsd(topCostModel.totalCost) : "$0.00"}
            </div>
          </div>
        </div>

        {/* Fastest Model Tokens/sec */}
        <div
          style={{
            padding: "16px",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-card)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {t("usage.fastestModel") || "⚡ 吞吐峰值模型"}
            </span>
            <div style={{ width: 26, height: 26, borderRadius: 6, background: "color-mix(in srgb, #10b981 15%, transparent)", color: "#10b981", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Gauge size={14} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={fastestModel?.model}>
              {fastestModel?.model ?? "无"}
            </div>
            <div style={{ fontSize: 12, color: "#10b981", fontFamily: "var(--font-mono)", fontWeight: 600, marginTop: 2 }}>
              {fastestModel?.avgTokensPerSecond ? `${fastestModel.avgTokensPerSecond.toFixed(1)} tok/s` : "-"}
            </div>
          </div>
        </div>

        {/* Global Cache Rate */}
        <div
          style={{
            padding: "16px",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-card)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {t("usage.cacheRate") || "🎯 全局缓存命中率"}
            </span>
            <div style={{ width: 26, height: 26, borderRadius: 6, background: "color-mix(in srgb, #f59e0b 15%, transparent)", color: "#f59e0b", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Sparkles size={14} />
            </div>
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
              {overall ? `${(overall.cacheRate * 100).toFixed(1)}%` : "0%"}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
              {overall ? `${formatTokenCount(overall.totalCacheReadTokens, locale)} Tokens 已由缓存加速` : "-"}
            </div>
          </div>
        </div>
      </div>

      {/* Global Token Composition Stacked Bar */}
      {overall && (
        <div
          style={{
            padding: "16px",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-card)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {t("usage.globalTokenMix") || "Token 全局构成分析 (Token Distribution)"}
          </div>
          <SvgStackedBarChart
            segments={globalTokenSegments}
            height={20}
            valueFormatter={(v) => formatTokenCount(v, locale)}
          />
        </div>
      )}

      {/* Side-by-side Donut Charts */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <SvgDonutChart
          title={t("usage.modelTokenShare") || "模型 Token 消耗份额"}
          items={tokenDonutItems}
          centerTitle={t("usage.totalTokens") || "总 Tokens"}
          valueFormatter={(v) => formatTokenCount(v, locale)}
        />
        {costDonutItems.length > 0 ? (
          <SvgDonutChart
            title={t("usage.modelCostShare") || "模型费用支出份额 (USD)"}
            items={costDonutItems}
            centerTitle={t("usage.totalCost") || "总费用"}
            valueFormatter={(v) => formatCostUsd(v)}
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-card)",
              color: "var(--text-dim)",
              fontSize: 12,
            }}
          >
            {t("usage.zeroCostHint") || "当前会话暂无商业计费模型支出或全部来自免费/包月额度。"}
          </div>
        )}
      </div>

      {/* Detailed Model Consumption Leaderboard Table */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: "16px",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-card)",
          overflowX: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
            {t("usage.modelLeaderboard") || "模型消耗排行榜 (Model Breakdown Leaderboard)"}
          </div>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            共 {sortedModels.length} 个模型
          </span>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-dim)", textAlign: "left" }}>
              <th style={{ padding: "8px 10px", width: 50 }}>#</th>
              <th style={{ padding: "8px 10px" }}>模型</th>
              <th style={{ padding: "8px 10px" }}>提供商</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>请求数</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>总 Tokens</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>缓存率</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>tok/s</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>TTFT</th>
              <th style={{ padding: "8px 10px", textAlign: "right" }}>费用</th>
            </tr>
          </thead>
          <tbody>
            {sortedModels.map((m, idx) => {
              const totalTokens = m.totalInputTokens + m.totalOutputTokens + m.totalCacheReadTokens;
              const barPct = Math.max(2, (totalTokens / maxModelTokens) * 100);

              return (
                <tr
                  key={`${m.model}-${m.provider}`}
                  style={{
                    borderBottom: "1px solid var(--border)",
                    transition: "background var(--dur-fast) var(--ease-out-warm)",
                  }}
                  className="hover:bg-bg-hover"
                >
                  {/* Rank */}
                  <td style={{ padding: "10px", fontFamily: "var(--font-mono)", fontWeight: 600, color: idx === 0 ? "var(--accent)" : "var(--text-dim)" }}>
                    {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : idx + 1}
                  </td>

                  {/* Model */}
                  <td style={{ padding: "10px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontWeight: 600, color: "var(--text)" }}>{m.model}</span>
                      <div style={{ width: 140, height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${barPct}%`, height: "100%", background: idx === 0 ? "var(--accent)" : "var(--text-muted)" }} />
                      </div>
                    </div>
                  </td>

                  {/* Provider */}
                  <td style={{ padding: "10px" }}>
                    <span
                      style={{
                        fontSize: 10.5,
                        padding: "2px 7px",
                        borderRadius: 999,
                        background: "var(--bg-subtle)",
                        border: "1px solid var(--border)",
                        color: "var(--text-muted)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {m.provider}
                    </span>
                  </td>

                  {/* Requests */}
                  <td style={{ padding: "10px", textAlign: "right", fontFamily: "var(--font-mono)" }}>
                    <span style={{ color: "var(--text)" }}>{m.totalRequests}</span>
                    {m.failedRequests > 0 && (
                      <span style={{ color: "var(--status-error)", fontSize: 10, marginLeft: 4 }}>
                        ({m.failedRequests} 失败)
                      </span>
                    )}
                  </td>

                  {/* Total Tokens */}
                  <td style={{ padding: "10px", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text)" }}>
                    {formatTokenCount(totalTokens, locale)}
                  </td>

                  {/* Cache Rate */}
                  <td style={{ padding: "10px", textAlign: "right", fontFamily: "var(--font-mono)", color: m.cacheRate > 0.8 ? "#10b981" : "var(--text-dim)" }}>
                    {(m.cacheRate * 100).toFixed(1)}%
                  </td>

                  {/* tok/s */}
                  <td style={{ padding: "10px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--text)" }}>
                    {formatTokensPerSecond(m.avgTokensPerSecond)}
                  </td>

                  {/* TTFT */}
                  <td style={{ padding: "10px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                    {formatDurationMs(m.avgTtft)}
                  </td>

                  {/* Cost */}
                  <td style={{ padding: "10px", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600, color: m.totalCost > 0 ? "var(--status-error)" : "var(--text-dim)" }}>
                    {formatCostUsd(m.totalCost)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

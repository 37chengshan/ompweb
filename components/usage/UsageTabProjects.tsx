"use client";

import { useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { formatTokenCount, formatCostUsd } from "@/lib/usage-format";
import { FolderGit2, Bot } from "lucide-react";

export interface FolderStatItem {
  folder: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  cacheRate: number;
  totalCost: number;
}

export interface AgentTypeStatItem {
  agentType: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCost: number;
}

interface Props {
  byFolder: FolderStatItem[];
  byAgentType: AgentTypeStatItem[];
  onSelectProject?: (folder: string) => void;
}

export function UsageTabProjects({ byFolder, byAgentType, onSelectProject }: Props) {
  const { t, locale } = useI18n();

  const sortedFolders = useMemo(() => {
    return [...byFolder].sort((a, b) => {
      const aTokens = a.totalInputTokens + a.totalOutputTokens + a.totalCacheReadTokens;
      const bTokens = b.totalInputTokens + b.totalOutputTokens + b.totalCacheReadTokens;
      return bTokens - aTokens;
    });
  }, [byFolder]);

  const maxFolderTokens = useMemo(() => {
    if (!sortedFolders.length) return 1;
    const f = sortedFolders[0];
    return f.totalInputTokens + f.totalOutputTokens + f.totalCacheReadTokens || 1;
  }, [sortedFolders]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: "4px 0" }}>
      {/* Agent Type Breakdown (Main vs Subagent) */}
      {byAgentType.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 14,
          }}
        >
          {byAgentType.map((ag) => {
            const totalTokens = ag.totalInputTokens + ag.totalOutputTokens + ag.totalCacheReadTokens;
            const isSubagent = ag.agentType !== "main";

            return (
              <div
                key={ag.agentType}
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
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Bot size={16} style={{ color: isSubagent ? "#8b5cf6" : "var(--accent)" }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", textTransform: "capitalize" }}>
                      {isSubagent ? (t("usage.subagents") || "Subagents (子智能体)") : (t("usage.mainAgent") || "Main Agent (主智能体)")}
                    </span>
                  </div>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
                    {ag.totalRequests} 请求
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 700, color: "var(--text)" }}>
                    {formatTokenCount(totalTokens, locale)}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Tokens</span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-dim)", borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 4 }}>
                  <span>费用支出: {formatCostUsd(ag.totalCost)}</span>
                  <span>输出: {formatTokenCount(ag.totalOutputTokens, locale)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Projects List Card */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          padding: "18px",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FolderGit2 size={16} style={{ color: "var(--accent)" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
              {t("usage.projectRanking") || "项目目录消耗排行 (Project / Folder Breakdown)"}
            </span>
          </div>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            共 {sortedFolders.length} 个项目
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sortedFolders.map((f, idx) => {
            const totalTokens = f.totalInputTokens + f.totalOutputTokens + f.totalCacheReadTokens;
            const barPct = Math.max(2, (totalTokens / maxFolderTokens) * 100);
            const folderDisplayName = f.folder.replace(/^-/, "").replace(/-/g, "/");

            return (
              <div
                key={f.folder}
                role={onSelectProject ? "button" : undefined}
                onClick={onSelectProject ? () => onSelectProject(f.folder) : undefined}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: "10px 12px",
                  borderRadius: "var(--radius-control)",
                  background: "var(--bg-subtle)",
                  border: "1px solid var(--border)",
                  cursor: onSelectProject ? "pointer" : "default",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: idx === 0 ? "var(--accent)" : "var(--text-dim)", width: 16 }}>
                      {idx + 1}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.folder}>
                      {folderDisplayName}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                        {formatTokenCount(totalTokens, locale)}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-dim)" }}>
                        {f.totalRequests} 请求 · {formatCostUsd(f.totalCost)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Progress bar */}
                <div style={{ width: "100%", height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${barPct}%`,
                      height: "100%",
                      background: idx === 0 ? "var(--accent)" : "var(--accent-hover)",
                      borderRadius: 3,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { UsageTabLimits, type UsageReport, type CapacityWindow } from "./UsageTabLimits";
import { UsageTabModels, type OverallStats, type ModelStatItem } from "./UsageTabModels";
import { UsageTabProjects, type FolderStatItem, type AgentTypeStatItem } from "./UsageTabProjects";
import { UsageTabLogs } from "./UsageTabLogs";
import {
  Activity,
  BarChart3,
  Cpu,
  FolderGit2,
  Maximize2,
  Minimize2,
  RefreshCw,
  X,
  Zap,
} from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: "limits" | "models" | "projects" | "logs";
  onOpenSessionFile?: (sessionFile: string) => void;
}

export interface StatsDataPayload {
  overall: OverallStats | null;
  byModel: ModelStatItem[];
  byFolder: FolderStatItem[];
  byAgentType: AgentTypeStatItem[];
  reports: UsageReport[];
  capacity: Record<string, CapacityWindow[]>;
}

// Module-level global cache to eliminate modal opening delay and provide instant 0ms rendering
let globalCachedStatsData: StatsDataPayload | null = null;

export function prewarmStatsData() {
  if (typeof window === "undefined") return;
  fetch("/api/usage/stats")
    .then((res) => (res.ok ? (res.json() as Promise<StatsDataPayload>) : null))
    .then((data) => {
      if (data) globalCachedStatsData = data;
    })
    .catch(() => { /* silent */ });
}

export function UsageDashboardModal({
  open,
  onOpenChange,
  initialTab = "limits",
  onOpenSessionFile,
}: Props) {
  const [activeTab, setActiveTab] = useState<"limits" | "models" | "projects" | "logs">(initialTab);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Aggregated stats state initialized from global cache for instant zero-latency display
  const [statsData, setStatsData] = useState<StatsDataPayload | null>(() => globalCachedStatsData);
  const [loading, setLoading] = useState(false);
  const hasDataRef = useRef(Boolean(globalCachedStatsData));

  const loadStats = useCallback(async (isBackground = false) => {
    // Manual refresh (isBackground=false) always gives visible feedback: the
    // refresh button spins and success/failure surfaces via toast. Background
    // polls stay silent so the auto-refresh timer never spams the user.
    if (!isBackground) {
      setLoading(true);
    }
    try {
      const res = await fetch("/api/usage/stats");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as StatsDataPayload;
      globalCachedStatsData = data;
      hasDataRef.current = true;
      setStatsData(data);
      if (!isBackground) toast.success("用量数据已刷新");
    } catch (error) {
      if (!isBackground) {
        toast.error(error instanceof Error ? `刷新失败：${error.message}` : "刷新失败，请重试");
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // Always do a background refresh when opened so data is fresh without showing loading placeholder
    void loadStats(hasDataRef.current);

    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void loadStats(true);
    }, 2000);

    const onVisibilityChange = () => {
      if (!document.hidden && open) {
        void loadStats(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [open, loadStats]);

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  const tabs = [
    { id: "limits" as const, label: "账户限额与配额", icon: Zap },
    { id: "models" as const, label: "模型消耗与排行", icon: Cpu },
    { id: "projects" as const, label: "项目与角色分布", icon: FolderGit2 },
    { id: "logs" as const, label: "实时调用与异常日志", icon: Activity },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ariaLabel="用量与日志全景分析"
        style={{
          width: isFullscreen ? "98vw" : 1080,
          maxWidth: "min(96vw, 1200px)",
          height: isFullscreen ? "96vh" : "min(90vh, 850px)",
          maxHeight: "96vh",
          padding: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          transition: "all var(--dur-med) var(--ease-out-warm)",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-panel)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "var(--radius-control)",
                background: "color-mix(in srgb, var(--accent) 15%, transparent)",
                color: "var(--accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <BarChart3 size={18} strokeWidth={2} />
            </div>
            <div>
              <DialogTitle style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                用量与日志分析全景仪表盘
              </DialogTitle>
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                <span className="live-status-dot live-pulse inline-block h-2 w-2 rounded-full bg-accent" />
                <span>实时同步 omp stats / omp usage</span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={() => void loadStats()}
              disabled={loading}
              title="刷新数据"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 30,
                height: 30,
                borderRadius: "var(--radius-control)",
                border: "1px solid var(--border)",
                background: "var(--bg-hover)",
                color: "var(--text)",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>

            <button
              type="button"
              onClick={() => setIsFullscreen((f) => !f)}
              title={isFullscreen ? "还原窗口" : "全屏查看"}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 30,
                height: 30,
                borderRadius: "var(--radius-control)",
                border: "1px solid var(--border)",
                background: "var(--bg-hover)",
                color: "var(--text)",
                cursor: "pointer",
              }}
            >
              {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>

            <button
              type="button"
              onClick={() => onOpenChange(false)}
              title="关闭"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 30,
                height: 30,
                borderRadius: "var(--radius-control)",
                border: "none",
                background: "none",
                color: "var(--text-dim)",
                cursor: "pointer",
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tab Switcher Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg)",
            flexShrink: 0,
            overflowX: "auto",
            gap: 6,
          }}
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "12px 14px",
                  border: "none",
                  borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                  background: "transparent",
                  color: isActive ? "var(--accent)" : "var(--text-muted)",
                  fontWeight: isActive ? 600 : 500,
                  fontSize: 13,
                  cursor: "pointer",
                  transition: "all var(--dur-fast) var(--ease-out-warm)",
                  whiteSpace: "nowrap",
                }}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Scrollable Tab Content Viewport */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px",
            background: "var(--bg)",
          }}
        >
          {activeTab === "limits" && (
            <UsageTabLimits
              reports={statsData?.reports ?? []}
              capacity={statsData?.capacity}
              onRefresh={() => void loadStats()}
              loading={loading}
            />
          )}

          {activeTab === "models" && (
            <UsageTabModels
              overall={statsData?.overall ?? null}
              byModel={statsData?.byModel ?? []}
            />
          )}

          {activeTab === "projects" && (
            <UsageTabProjects
              byFolder={statsData?.byFolder ?? []}
              byAgentType={statsData?.byAgentType ?? []}
            />
          )}

          {activeTab === "logs" && (
            <UsageTabLogs
              onOpenSessionFile={onOpenSessionFile}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

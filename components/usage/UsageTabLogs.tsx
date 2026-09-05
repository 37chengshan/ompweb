"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import {
  formatTokenCount,
  formatCostUsd,
  formatDurationMs,
  formatTimestampFull,
} from "@/lib/usage-format";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import {
  Search,
  RefreshCw,
  AlertTriangle,
  XCircle,
  Copy,
  ExternalLink,
  Globe,
} from "lucide-react";

export interface LogEntry {
  id: number;
  timestamp: number;
  model: string;
  provider: string;
  api: string;
  duration: number | null;
  ttft: number | null;
  stopReason: string;
  errorMessage: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costTotal: number;
  agentType: string;
  entryId: string;
  sessionFile: string;
  folder: string;
}

interface Props {
  onOpenSessionFile?: (sessionFile: string) => void;
}

export function UsageTabLogs({ onOpenSessionFile }: Props) {
  const { locale } = useI18n();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorOnly, setErrorOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  // Auto refresh interval: 0 (off), 2000, 5000, 10000, 30000
  const [autoRefreshMs, setAutoRefreshMs] = useState(2000);
  const [detailEntry, setDetailEntry] = useState<LogEntry | null>(null);
  const reqSeqRef = useRef(0);

  // Debounce search query changes by 300ms
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const fetchLogs = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    const currentSeq = ++reqSeqRef.current;
    try {
      const params = new URLSearchParams();
      params.set("limit", String(pageSize));
      params.set("offset", String(page * pageSize));
      if (errorOnly) params.set("errorsOnly", "true");
      if (modelFilter) params.set("model", modelFilter);
      if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());

      const res = await fetch(`/api/usage/logs?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { total: number; logs: LogEntry[] };
      if (reqSeqRef.current === currentSeq) {
        setLogs(data.logs ?? []);
        setTotal(data.total ?? 0);
      }
    } catch {
      if (!isBackground && reqSeqRef.current === currentSeq) {
        toast.error("加载日志数据失败");
      }
    } finally {
      if (!isBackground && reqSeqRef.current === currentSeq) {
        setLoading(false);
      }
    }
  }, [page, pageSize, errorOnly, modelFilter, debouncedQuery]);

  // Initial and reactive fetch
  useEffect(() => {
    void fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh interval
  useEffect(() => {
    if (autoRefreshMs <= 0) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      void fetchLogs(true);
    }, autoRefreshMs);
    return () => clearInterval(timer);
  }, [autoRefreshMs, fetchLogs]);

  const copyToClipboard = useCallback((text: string, label = "已复制") => {
    navigator.clipboard.writeText(text);
    toast.success(label);
  }, []);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "4px 0" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          padding: "12px 16px",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        {/* Left: Filter Pills */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "var(--bg-subtle)",
              borderRadius: "var(--radius-control)",
              padding: 2,
              border: "1px solid var(--border)",
            }}
          >
            <button
              onClick={() => { setErrorOnly(false); setPage(0); }}
              style={{
                padding: "4px 12px",
                borderRadius: 6,
                border: "none",
                background: !errorOnly ? "var(--bg-selected)" : "transparent",
                color: !errorOnly ? "var(--text)" : "var(--text-muted)",
                fontWeight: !errorOnly ? 600 : 400,
                fontSize: 12,
                cursor: "pointer",
                transition: "all var(--dur-fast) var(--ease-out-warm)",
              }}
            >
              全部记录
            </button>
            <button
              onClick={() => { setErrorOnly(true); setPage(0); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "4px 12px",
                borderRadius: 6,
                border: "none",
                background: errorOnly ? "color-mix(in srgb, var(--status-error) 15%, transparent)" : "transparent",
                color: errorOnly ? "var(--status-error)" : "var(--text-muted)",
                fontWeight: errorOnly ? 600 : 400,
                fontSize: 12,
                cursor: "pointer",
                transition: "all var(--dur-fast) var(--ease-out-warm)",
              }}
            >
              <AlertTriangle size={12} />
              仅看报错
            </button>
          </div>

          {/* Search box */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-control)",
              width: 220,
            }}
          >
            <Search size={13} style={{ color: "var(--text-dim)", flexShrink: 0 }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
              placeholder="搜索模型、提供方、错误..."
              style={{
                border: "none",
                outline: "none",
                background: "transparent",
                color: "var(--text)",
                fontSize: 12,
                width: "100%",
              }}
            />
          </div>

          {modelFilter && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 8px",
                borderRadius: 6,
                background: "var(--bg-selected)",
                border: "1px solid var(--border)",
                color: "var(--accent)",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
              }}
            >
              <span>模型: {modelFilter}</span>
              <button
                type="button"
                onClick={() => { setModelFilter(""); setPage(0); }}
                title="清除模型筛选"
                style={{
                  border: "none",
                  background: "none",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 12,
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {/* Right: Live Polling & Manual Refresh */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-dim)" }}>
            <span>实时刷新:</span>
            <select
              value={autoRefreshMs}
              onChange={(e) => setAutoRefreshMs(Number(e.target.value))}
              style={{
                padding: "3px 8px",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-control)",
                color: "var(--text)",
                fontSize: 11,
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value={0}>关 (Off)</option>
              <option value={2000}>2秒</option>
              <option value={5000}>5秒</option>
              <option value={10000}>10秒</option>
              <option value={30000}>30秒</option>
            </select>
          </div>

          <button
            onClick={() => void fetchLogs()}
            disabled={loading}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              background: "var(--bg-hover)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-control)",
              color: "var(--text)",
              fontSize: 12,
              cursor: loading ? "not-allowed" : "pointer",
              transition: "background var(--dur-fast) var(--ease-out-warm)",
            }}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            刷新
          </button>
        </div>
      </div>

      {/* Main Request Logs Table (Exact replica of user screenshot layout) */}
      <div
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-card)",
          overflow: "hidden",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--border)",
                  background: "var(--bg-subtle)",
                  color: "var(--text-dim)",
                  textAlign: "left",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                <th style={{ padding: "10px 14px" }}>时间</th>
                <th style={{ padding: "10px 14px" }}>Token 数</th>
                <th style={{ padding: "10px 14px" }}>tok/s</th>
                <th style={{ padding: "10px 14px" }}>~$</th>
                <th style={{ padding: "10px 14px" }}>模型</th>
                <th style={{ padding: "10px 14px" }}>推理强度 / 角色</th>
                <th style={{ padding: "10px 14px" }}>提供方</th>
                <th style={{ padding: "10px 14px" }}>状态</th>
                <th style={{ padding: "10px 14px" }}>请求</th>
                <th style={{ padding: "10px 14px", textAlign: "right" }}>耗时</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: "40px 14px", textAlign: "center", color: "var(--text-muted)" }}>
                    {loading ? "正在加载实时日志..." : "未找到匹配的请求记录"}
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isError = log.stopReason === "error" || Boolean(log.errorMessage);
                  const isAborted = log.stopReason === "aborted";
                  const totalTokensFormatted = formatTokenCount(log.totalTokens, locale);
                  const cacheReadFormatted = log.cacheReadTokens > 0 ? formatTokenCount(log.cacheReadTokens, locale) : null;
                  const tokPerSec = log.duration && log.duration > 0 && log.outputTokens > 0
                    ? ((log.outputTokens / (log.duration / 1000))).toFixed(1)
                    : null;

                  return (
                    <tr
                      key={log.id}
                      style={{
                        borderBottom: "1px solid var(--border)",
                        transition: "background var(--dur-fast) var(--ease-out-warm)",
                        background: isError ? "color-mix(in srgb, var(--status-error) 4%, transparent)" : "transparent",
                      }}
                      className="hover:bg-bg-hover"
                    >
                      {/* 时间 */}
                      <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                        {formatTimestampFull(log.timestamp)}
                      </td>

                      {/* Token 数 */}
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", flexDirection: "column" }}>
                          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text)" }}>
                            {totalTokensFormatted}
                          </span>
                          {cacheReadFormatted && (
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)" }}>
                              c {cacheReadFormatted}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* tok/s */}
                      <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)", color: "var(--text)", whiteSpace: "nowrap" }}>
                        {tokPerSec ?? "-"}
                      </td>

                      {/* ~$ */}
                      <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)", color: log.costTotal > 0 ? "var(--text)" : "var(--text-dim)", whiteSpace: "nowrap" }}>
                        {formatCostUsd(log.costTotal)}
                      </td>

                      {/* 模型 */}
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                        <button
                          type="button"
                          onClick={() => { setModelFilter(log.model); setPage(0); }}
                          title={`筛选模型: ${log.model}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            padding: 0,
                            color: "inherit",
                          }}
                        >
                          <Globe size={13} style={{ color: "var(--text-dim)", flexShrink: 0 }} />
                          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: modelFilter === log.model ? "var(--accent)" : "var(--text)", textDecoration: modelFilter === log.model ? "underline" : "none" }}>
                            {log.model}
                          </span>
                        </button>
                      </td>

                      {/* 推理强度 / 角色 */}
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                        <span
                          style={{
                            fontSize: 10.5,
                            padding: "2px 6px",
                            borderRadius: 4,
                            background: "var(--bg-subtle)",
                            color: "var(--text-muted)",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {log.agentType || "main"}
                        </span>
                      </td>

                      {/* 提供方 */}
                      <td style={{ padding: "10px 14px", color: "var(--text-muted)", whiteSpace: "nowrap", fontSize: 11 }}>
                        {log.provider}
                      </td>

                      {/* 状态 */}
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {isError ? (
                            <span style={{ color: "var(--status-error)", fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                              Error
                            </span>
                          ) : isAborted ? (
                            <span style={{ color: "#f59e0b", fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                              Aborted
                            </span>
                          ) : (
                            <span style={{ color: "var(--status-success)", fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                              200
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setDetailEntry(log)}
                            style={{
                              background: "none",
                              border: "none",
                              padding: 0,
                              color: "var(--accent)",
                              cursor: "pointer",
                              fontSize: 11,
                              textDecoration: "underline",
                            }}
                          >
                            查看详情
                          </button>
                        </div>
                      </td>

                      {/* 请求 */}
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span
                            style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: 11,
                              color: "var(--text-dim)",
                              maxWidth: 110,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                            title={log.entryId}
                          >
                            {log.entryId}
                          </span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(log.entryId, "已复制请求 ID")}
                            title="复制请求 ID"
                            style={{
                              background: "none",
                              border: "none",
                              color: "var(--text-dim)",
                              cursor: "pointer",
                              padding: 2,
                              display: "flex",
                              alignItems: "center",
                            }}
                          >
                            <Copy size={11} />
                          </button>
                        </div>
                      </td>

                      {/* 耗时 */}
                      <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                        {formatDurationMs(log.duration)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 16px",
            borderTop: "1px solid var(--border)",
            background: "var(--bg-subtle)",
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          <div>
            共 <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text)" }}>{total}</span> 条记录
            {totalPages > 1 && ` · 第 ${page + 1} / ${totalPages} 页`}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page <= 0}
              style={{
                padding: "4px 10px",
                borderRadius: "var(--radius-control)",
                border: "1px solid var(--border)",
                background: page <= 0 ? "transparent" : "var(--bg-panel)",
                color: page <= 0 ? "var(--text-dim)" : "var(--text)",
                cursor: page <= 0 ? "not-allowed" : "pointer",
                fontSize: 11,
              }}
            >
              上一页
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={(page + 1) * pageSize >= total}
              style={{
                padding: "4px 10px",
                borderRadius: "var(--radius-control)",
                border: "1px solid var(--border)",
                background: (page + 1) * pageSize >= total ? "transparent" : "var(--bg-panel)",
                color: (page + 1) * pageSize >= total ? "var(--text-dim)" : "var(--text)",
                cursor: (page + 1) * pageSize >= total ? "not-allowed" : "pointer",
                fontSize: 11,
              }}
            >
              下一页
            </button>
          </div>
        </div>
      </div>

      {/* Detail Dialog */}
      {detailEntry && (
        <Dialog open={Boolean(detailEntry)} onOpenChange={(open) => { if (!open) setDetailEntry(null); }}>
          <DialogContent ariaLabel="请求详情" style={{ width: 640, maxWidth: "min(92vw, 640px)", padding: 22 }}>
            <DialogTitle>请求调用详情</DialogTitle>

            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 14 }}>
              {/* Error Callout if error exists */}
              {detailEntry.errorMessage && (
                <div
                  style={{
                    padding: "12px 14px",
                    background: "color-mix(in srgb, var(--status-error) 8%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--status-error) 25%, transparent)",
                    borderRadius: "var(--radius-control)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--status-error)", fontSize: 12, fontWeight: 700 }}>
                    <XCircle size={14} />
                    <span>报错信息 (Error Message):</span>
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: "8px 10px",
                      background: "var(--bg)",
                      borderRadius: 6,
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      color: "var(--text)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                      maxHeight: 140,
                      overflowY: "auto",
                    }}
                  >
                    {detailEntry.errorMessage}
                  </pre>
                </div>
              )}

              {/* Grid of Key Properties */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, 1fr)",
                  gap: 12,
                  fontSize: 12,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ color: "var(--text-dim)", fontSize: 11 }}>模型 (Model):</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text)" }}>
                    {detailEntry.model}
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ color: "var(--text-dim)", fontSize: 11 }}>提供方 (Provider):</span>
                  <span style={{ color: "var(--text)" }}>{detailEntry.provider}</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ color: "var(--text-dim)", fontSize: 11 }}>时间 (Timestamp):</span>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
                    {formatTimestampFull(detailEntry.timestamp)}
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ color: "var(--text-dim)", fontSize: 11 }}>状态码 (Status):</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: detailEntry.errorMessage ? "var(--status-error)" : "var(--status-success)" }}>
                    {detailEntry.stopReason}
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ color: "var(--text-dim)", fontSize: 11 }}>耗时 (Duration):</span>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
                    {formatDurationMs(detailEntry.duration)} {detailEntry.ttft ? `(TTFT: ${Math.round(detailEntry.ttft)}ms)` : ""}
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ color: "var(--text-dim)", fontSize: 11 }}>估算费用 (Cost):</span>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
                    {formatCostUsd(detailEntry.costTotal)}
                  </span>
                </div>
              </div>

              {/* Tokens breakdown card */}
              <div
                style={{
                  padding: "12px",
                  background: "var(--bg-subtle)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-control)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>
                  Tokens 统计细则
                </span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, textAlign: "center" }}>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)" }}>输入 (Input)</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text)" }}>
                      {detailEntry.inputTokens.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)" }}>输出 (Output)</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text)" }}>
                      {detailEntry.outputTokens.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)" }}>缓存读取 (Cache)</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text)" }}>
                      {detailEntry.cacheReadTokens.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)" }}>总计 (Total)</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--accent)" }}>
                      {detailEntry.totalTokens.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Session File & Entry ID */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-dim)" }}>请求 ID:</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{detailEntry.entryId}</code>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(detailEntry.entryId, "已复制请求 ID")}
                      style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer" }}
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>会话文件:</span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={detailEntry.sessionFile}
                  >
                    {detailEntry.sessionFile}
                  </span>
                </div>
              </div>

              {/* Modal footer actions */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setDetailEntry(null)}
                  style={{
                    padding: "6px 14px",
                    background: "var(--bg-hover)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-control)",
                    color: "var(--text)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  关闭
                </button>
                {onOpenSessionFile && detailEntry.sessionFile && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenSessionFile(detailEntry.sessionFile);
                      setDetailEntry(null);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 14px",
                      background: "var(--accent-strong)",
                      border: "none",
                      borderRadius: "var(--radius-control)",
                      color: "var(--on-accent)",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    <ExternalLink size={13} />
                    跳转至此会话
                  </button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

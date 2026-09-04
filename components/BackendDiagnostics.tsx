"use client";

import { useEffect, useState, useCallback, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { Activity, Check, Copy, Eraser, ExternalLink, RefreshCw, RotateCcw } from "lucide-react";

export interface DiagnosticsData {
  server: { node: string; platform: string; arch: string; uptimeSeconds: number };
  omp: { installed: boolean; path: string | null; version: string | null };
  proxy: { config: { mode: string; url?: string }; effective: string | null };
  rpc: { activeSessions: number; recentFailures?: string[]; orphanRustHosts?: number };
  instances?: { selfPort: number; others: number[] };
  web: { port: string; url: string };
  /** Per-domain authority from backend-ownership.yaml (doc 15 / v4 P40). */
  backendOwnership?: Record<string, string>;
  /** Rust host binary resolution (doc 16 route 3). */
  rustHost?: { mode: string; path: string; available: boolean };
  /** Rust-domain failures recorded by lib/backend-errors.ts (Phase 1). */
  backendErrors?: Array<{ at: number; kind: string; detail: string }>;
}

export type BackendHealth = "ok" | "warn" | "error";

export type BackendHealthSnapshot = { health: BackendHealth; ready: boolean; refreshing: boolean; diagnostics: DiagnosticsData | null };
const INITIAL_HEALTH_SNAPSHOT: BackendHealthSnapshot = { health: "ok", ready: false, refreshing: false, diagnostics: null };
const healthListeners = new Set<() => void>();
let healthSnapshot = INITIAL_HEALTH_SNAPSHOT;
let healthRequest: Promise<void> | null = null;
let healthTimer: ReturnType<typeof setInterval> | null = null;
let healthFailureStreak = 0;

function publishHealth(next: BackendHealthSnapshot): void {
  healthSnapshot = next;
  healthListeners.forEach((listener) => listener());
}

/** Share one diagnostics request between the top-left button and banner. */
function refreshBackendHealth(): void {
  if (healthRequest) return;
  publishHealth({ ...healthSnapshot, refreshing: true });
  healthRequest = fetch("/api/diagnostics", { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json() as Promise<DiagnosticsData>;
    })
    .then((data) => {
      healthFailureStreak = 0;
      publishHealth({ health: healthOf(data), ready: true, refreshing: false, diagnostics: data });
      // 异常转警告/错误时自动尝试一次静默修复（冷却防抖）。
      if (healthOf(data) !== "ok") maybeAutoFix();
    })
    .catch(() => {
      healthFailureStreak += 1;
      // A single transient request failure must not flash the entire app red.
      // Keep the last confirmed state until two consecutive failures.
      const exposeError = healthFailureStreak >= 2;
      publishHealth({ ...healthSnapshot, health: exposeError ? "error" : healthSnapshot.health, ready: healthSnapshot.ready, refreshing: false });
    })
    .finally(() => {
      healthRequest = null;
    });
}

function subscribeBackendHealth(listener: () => void): () => void {
  healthListeners.add(listener);
  ensureHealthPolling();
  return () => healthListeners.delete(listener);
}

function ensureHealthPolling(): void {
  if (healthTimer) return;
  refreshBackendHealth();
  healthTimer = setInterval(refreshBackendHealth, 30_000);
}

// ── 自动静默修复 ─────────────────────────────────────────────────────────
// 健康转异常时自动跑一次与「重启 OMP 会话」按钮相同的修复动作
// （host repair 清孤儿 + 重启 RPC 会话 + 清错误环），成功后横幅自行消失；
// 5 分钟冷却防止抖动循环。手动点击修复按钮同样重置冷却。
const AUTO_FIX_COOLDOWN_MS = 5 * 60_000;
let lastAutoFixAt = 0;
let autoFixInFlight = false;

/** 冷却判定（导出供测试）：上次修复距今超过冷却期才允许再次自动修复。 */
export function shouldAutoFix(lastAttemptAt: number, now: number): boolean {
  return now - lastAttemptAt >= AUTO_FIX_COOLDOWN_MS;
}

function markManualFix(): void {
  lastAutoFixAt = Date.now();
}

function maybeAutoFix(): void {
  if (autoFixInFlight) return;
  if (!shouldAutoFix(lastAutoFixAt, Date.now())) return;
  const data = healthSnapshot.diagnostics;
  if (!data) return;
  // 只在「host 级故障」时自动修复，且修复动作仅清孤儿 host —— 绝不重启用户
  // 的 RPC 会话（避免代理暂断/普通 warn 时误杀正在进行的对话）。
  const hostDead = data.rustHost && data.rustHost.mode !== "node" && !data.rustHost.available;
  const hostCrash = (data.backendErrors ?? []).some((e) => e.kind === "host_crash" || e.kind === "host_unavailable");
  const orphanHost = (data.rpc.orphanRustHosts ?? 0) > 0;
  // Orphaned supervisors are safe to clean automatically: they are
  // reparented to launchd/init and are explicitly excluded from the current
  // host manager. Leaving them around is what makes every fresh instance
  // report a warning even though its own host is healthy.
  if (!hostDead && !hostCrash && !orphanHost) return;
  autoFixInFlight = true;
  lastAutoFixAt = Date.now();
  // 「repair」= 无损：只清孤儿 host + 清错误环，不重启用户会话。
  void fetch("/api/omp-update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "repair" }),
  })
    .then((res) => res.json())
    .then((data) => {
      // 自动动作成功后再取一次快照，横幅据此自行消失；失败则保持异常态
      // 留给用户手动处理（冷却期内不会重试循环）。
      if (data && (data.success ?? data.ok)) {
        window.setTimeout(refreshBackendHealth, 600);
      }
    })
    .catch(() => {
      // 网络失败：静默，等下一轮轮询。
    })
    .finally(() => {
      autoFixInFlight = false;
    });
}

// Display order for the ownership coverage badges (doc 16 nine domains).
const DOMAIN_ORDER = ["agent", "event", "session", "pty", "files", "git", "settings", "commands", "remote"] as const;

/**
 * Overall health. Beyond omp installation: a missing Rust host binary (rust
 * mode) is a hard failure — every agent/session mutation fails closed; host
 * unavailable/crash and session-domain failures recorded in the backend error
 * ring surface here; recent RPC failures mean messages cannot actually be
 * sent. Without these the UI lies ("服务正常" while the backend is down).
 */
export function healthOf(d: DiagnosticsData): BackendHealth {
  if (!d.omp.installed) return "error";
  if (d.rustHost && d.rustHost.mode !== "node" && !d.rustHost.available) return "error";
  const backendErrors = d.backendErrors ?? [];
  if (backendErrors.some((e) => e.kind === "host_unavailable" || e.kind === "host_crash")) return "error";
  const failures = d.rpc.recentFailures?.length ?? 0;
  if (failures >= 2) return "error";
  if (backendErrors.length >= 2) return "error";
  if (failures >= 1) return "warn";
  if (backendErrors.length >= 1) return "warn";
  if ((d.rpc.orphanRustHosts ?? 0) > 0) return "warn";
  // A development server and the packaged desktop app intentionally run
  // side-by-side during local verification (30178/30179). Presence of another
  // healthy loopback instance is informational; only its own RPC/host errors
  // should change the health state. The diagnostics row still exposes the
  // instance and offers an explicit stop action when it is actually stale.
  if (!d.proxy.effective && d.proxy.config.mode === "auto") return "warn";
  return "ok";
}

function Row({ label, ok, detail, action }: { label: string; ok: boolean; detail: string; action?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, lineHeight: 1.5 }}>
      <span
        aria-hidden="true"
        style={{ width: 7, height: 7, borderRadius: "50%", background: ok ? "var(--status-success)" : "var(--status-error)", flexShrink: 0 }}
      />
      <span style={{ color: "var(--text-muted)", minWidth: 78, flexShrink: 0 }}>{label}</span>
      <code style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
        {detail}
      </code>
      {action}
    </div>
  );
}

/** Small inline copy button for row details (path / URL). */
function CopyButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
      aria-label={title}
      title={title}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, padding: 0, border: "none", borderRadius: 4, background: "transparent", color: copied ? "var(--status-success)" : "var(--text-dim)", cursor: "pointer", flexShrink: 0 }}
    >
      {copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
    </button>
  );
}

/** Labeled pill button used by the always-visible action row. */
function ActionButton({ onClick, disabled, icon, label, tone }: { onClick: () => void; disabled?: boolean; icon: ReactNode; label: string; tone?: "accent" | "quiet" }) {
  const accent = tone !== "quiet";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px",
        borderRadius: "var(--radius-control)",
        background: accent ? "var(--accent)" : "var(--bg)",
        color: accent ? "var(--on-accent)" : "var(--text)",
        border: accent ? "none" : "1px solid var(--border)",
        fontSize: 11, fontWeight: 600, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.6 : 1,
      }}
    >
      {icon}
      {label}
    </button>
  );
}

/** Diagnostics panel body: health summary, per-service rows, backend coverage,
 * recorded errors, fix actions. */
export function BackendDiagnosticsBody() {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const { diagnostics: diag, refresh, refreshing } = useBackendDiagnostics();

  const refreshDetails = useCallback(() => {
    setError(null);
    refresh();
  }, [refresh]);

  useEffect(() => {
    refreshDetails();
  }, [refreshDetails]);

  const restartRpc = useCallback(async () => {
    setRestarting(true);
    setSuccess(null);
    setError(null);
    try {
      const res = await fetch("/api/omp-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restart" }),
      });
      const data = await res.json() as { ok?: boolean; success?: boolean; error?: string };
      // 路由返回 { success: true, sessionsRestarted }——检查 success，旧的
      // ok 检查会让"重启成功"永远显示为失败。
      if (!res.ok || !(data.success ?? data.ok)) {
        setError(data.error ?? "restart failed");
      } else {
        markManualFix();
        setSuccess(t("diagnostics.restartSuccess"));
        refreshDetails();
        window.dispatchEvent(new CustomEvent("omp-rpc-restarted"));
        window.setTimeout(() => refreshDetails(), 500);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRestarting(false);
    }
  }, [refreshDetails, t]);

  const clearErrors = useCallback(async () => {
    setActionBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      if (!res.ok) {
        setError("clear failed");
      } else {
        setSuccess(t("diagnostics.errorsCleared"));
        refreshDetails();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  }, [refreshDetails, t]);

  const repairHost = useCallback(async () => {
    // 「修复」= 无损动作：只清孤儿 host + 清错误环，不重启用户会话。
    setActionBusy(true);
    setSuccess(null);
    setError(null);
    try {
      const res = await fetch("/api/omp-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "repair" }),
      });
      const data = await res.json() as { ok?: boolean; success?: boolean; error?: string };
      if (!res.ok || !(data.success ?? data.ok)) {
        setError(data.error ?? "repair failed");
      } else {
        markManualFix();
        setSuccess(t("diagnostics.repairSuccess"));
        refreshDetails();
        window.setTimeout(() => refreshDetails(), 500);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  }, [refreshDetails, t]);

  const copyReport = useCallback(() => {
    if (!diag) return;
    const backendErrors = diag.backendErrors ?? [];
    const lines = [
      `ompweb diagnostics @ ${new Date().toISOString()}`,
      `health: ${healthOf(diag)}`,
      `omp: ${diag.omp.installed ? `${diag.omp.version ?? "?"} @ ${diag.omp.path ?? ""}` : "missing"}`,
      `rust host: ${diag.rustHost ? `${diag.rustHost.mode} available=${diag.rustHost.available} ${diag.rustHost.path}` : "n/a"}`,
      `proxy: ${diag.proxy.effective ?? "off"} (mode ${diag.proxy.config.mode})`,
      `rpc: ${diag.rpc.activeSessions} active, ${diag.rpc.recentFailures?.length ?? 0} recent failures, ${diag.rpc.orphanRustHosts ?? 0} orphan hosts`,
      `web: ${diag.web.url}`,
      `ownership: ${Object.entries(diag.backendOwnership ?? {}).map(([domain, authority]) => `${domain}=${authority}`).join(" ")}`,
      ...backendErrors.map((e) => `[${e.kind}] ${e.detail}`),
    ];
    void navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setSuccess(t("diagnostics.reportCopied"));
      window.setTimeout(() => setSuccess(null), 2500);
    });
  }, [diag, t]);

  const health = diag ? healthOf(diag) : null;
  const healthColor = health === null ? "var(--text-dim)" : health === "ok" ? "var(--status-success)" : health === "warn" ? "var(--status-warning)" : "var(--status-error)";
  const backendErrors = diag?.backendErrors ?? [];

  return (
    <div style={{ minWidth: 300, maxWidth: 380, padding: 8, display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "2px 4px" }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: healthColor, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
          {health === null ? t("diagnostics.refreshing") : health === "ok" ? t("diagnostics.healthy") : health === "warn" ? t("diagnostics.warning") : t("diagnostics.error")}
        </span>
        <button
          type="button"
          onClick={() => refreshDetails()}
          disabled={refreshing || restarting}
          aria-label={t("diagnostics.refresh")}
          title={t("diagnostics.refresh")}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, marginLeft: "auto", padding: 0, border: "none", borderRadius: 5, background: "transparent", color: "var(--text-dim)", cursor: "pointer" }}
        >
          <RefreshCw size={11} className={refreshing ? "animate-spin" : undefined} aria-hidden="true" />
        </button>
      </div>
      {error && <div style={{ fontSize: 11, color: "var(--status-error)", padding: "0 4px" }}>{t("diagnostics.error")}: {error}</div>}
      {success && <div role="status" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--status-success)", padding: "0 4px" }}><Check size={11} aria-hidden="true" />{success}</div>}
      {diag && (
        <>
          {/* A classified recovery queue keeps the page actionable: each
              detected fault is paired with the least-destructive operation
              that can actually resolve it. */}
          {(() => {
            const hostDown = Boolean(diag.rustHost && diag.rustHost.mode !== "node" && !diag.rustHost.available);
            const hostCrash = backendErrors.some((entry) => entry.kind === "host_crash" || entry.kind === "host_unavailable");
            const rpcFailed = (diag.rpc.recentFailures?.length ?? 0) > 0;
            const orphan = (diag.rpc.orphanRustHosts ?? 0) > 0;
            const proxyMissing = !diag.proxy.effective && diag.proxy.config.mode === "auto";
            const missingOmp = !diag.omp.installed;
            const issues = [
              missingOmp ? { key: "omp", title: "OMP 未安装", detail: "安装 omp 后再重试。", action: undefined } : null,
              hostDown || hostCrash ? { key: "host", title: "Rust host 不可用", detail: "清理孤儿 host 并重新探测，不会重启正在运行的会话。", action: <ActionButton onClick={() => void repairHost()} disabled={actionBusy} icon={<Activity size={11} />} label={t("diagnostics.repair")} /> } : null,
              orphan ? { key: "orphan", title: "发现孤儿 host", detail: "孤儿进程可能占用锁或 PTY。", action: <ActionButton onClick={() => void repairHost()} disabled={actionBusy} icon={<Activity size={11} />} label={t("diagnostics.repair")} /> } : null,
              rpcFailed ? { key: "rpc", title: "RPC 会话失败", detail: `${diag.rpc.recentFailures?.length ?? 0} 次最近失败；重启只影响活动 RPC 会话。`, action: <ActionButton onClick={() => void restartRpc()} disabled={restarting || actionBusy} icon={<RotateCcw size={11} />} label={t("diagnostics.restartRpc")} tone="quiet" /> } : null,
              backendErrors.length > 0 && !hostCrash ? { key: "errors", title: "后端错误记录", detail: `${backendErrors.length} 条错误仍在错误环中。`, action: <ActionButton onClick={() => void clearErrors()} disabled={actionBusy} icon={<Eraser size={11} />} label={t("diagnostics.clearErrors")} tone="quiet" /> } : null,
              proxyMissing ? { key: "proxy", title: "代理未生效", detail: "当前为自动代理模式，但没有可用端点；请检查代理客户端或改为手动配置。", action: <ActionButton onClick={() => refreshDetails()} disabled={refreshing} icon={<RefreshCw size={11} />} label={t("diagnostics.refresh")} tone="quiet" /> } : null,
            ].filter(Boolean) as Array<{ key: string; title: string; detail: string; action?: ReactNode }>;
            if (!issues.length) return null;
            return <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "4px", border: "1px solid color-mix(in srgb, var(--status-warning) 40%, var(--border))", borderRadius: "var(--radius-control)", background: "color-mix(in srgb, var(--status-warning) 5%, var(--bg))" }}><span style={{ fontSize: 10, fontWeight: 700, color: "var(--status-warning)", textTransform: "uppercase" }}>Recovery queue</span>{issues.map((issue) => <div key={issue.key} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8, alignItems: "center", padding: "5px 2px" }}><div><div style={{ fontSize: 11, fontWeight: 650, color: "var(--text)" }}>{issue.title}</div><div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.35 }}>{issue.detail}</div></div>{issue.action}</div>)}</div>;
          })()}
          <Row
            label={t("diagnostics.omp")}
            ok={diag.omp.installed}
            detail={diag.omp.installed ? `${diag.omp.version ?? "?"} · ${diag.omp.path ?? ""}` : t("diagnostics.ompMissing")}
            action={diag.omp.path ? <CopyButton text={diag.omp.path} title={t("diagnostics.copy")} /> : undefined}
          />
          <Row
            label={t("diagnostics.rustHost")}
            ok={!diag.rustHost || diag.rustHost.available || diag.rustHost.mode === "node"}
            detail={diag.rustHost ? (diag.rustHost.available ? `${diag.rustHost.mode} · ${diag.rustHost.path}` : `${diag.rustHost.mode} · ${t("diagnostics.rustHostUnavailable")}`) : "—"}
            action={diag.rustHost?.path ? <CopyButton text={diag.rustHost.path} title={t("diagnostics.copy")} /> : undefined}
          />
          <Row label={t("diagnostics.proxy")} ok={Boolean(diag.proxy.effective)} detail={diag.proxy.effective ?? t("diagnostics.proxyOff")} />
          <Row label={t("diagnostics.rpc")} ok={(diag.rpc.recentFailures?.length ?? 0) === 0} detail={diag.rpc.recentFailures?.length ? `${diag.rpc.recentFailures.length} ${t("diagnostics.recentFailures")}` : `${diag.rpc.activeSessions} ${t("diagnostics.sessions")}`} />
          <Row label={t("diagnostics.server")} ok detail={`${diag.server.platform}/${diag.server.arch} · node ${diag.server.node}`} />
          {(diag.instances?.others.length ?? 0) > 0 && diag.instances!.others.map((port) => (
            <Row
              key={port}
              label={t("diagnostics.otherInstance")}
              ok
              detail={`127.0.0.1:${port}`}
              action={
                <button
                  type="button"
                  onClick={() => {
                    setActionBusy(true);
                    void fetch("/api/omp-update", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "stop-instance", port }),
                    })
                      .then((res) => res.json())
                      .then((data) => {
                        if (data && !data.success && data.error) setError(data.error);
                        else { setSuccess(t("diagnostics.instanceStopped")); window.setTimeout(() => refresh(), 500); }
                      })
                      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                      .finally(() => setActionBusy(false));
                  }}
                  aria-label={`${t("diagnostics.stopInstance")} :${port}`}
                  title={`${t("diagnostics.stopInstance")} :${port}`}
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, padding: 0, border: "none", borderRadius: 4, background: "transparent", color: "var(--status-error)", cursor: "pointer", flexShrink: 0 }}
                >
                  <RotateCcw size={11} aria-hidden="true" />
                </button>
              }
            />
          ))}
          {diag.web && (
            <Row
              label={t("diagnostics.webPort")}
              ok
              detail={diag.web.url}
              action={
                <>
                  <CopyButton text={diag.web.url} title={t("diagnostics.copy")} />
                  <button
                    type="button"
                    onClick={() => window.open(diag.web.url, "_blank", "noopener")}
                    aria-label={t("diagnostics.openBrowser")}
                    title={t("diagnostics.openBrowser")}
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, padding: 0, border: "none", borderRadius: 4, background: "transparent", color: "var(--accent)", cursor: "pointer", flexShrink: 0 }}
                  >
                    <ExternalLink size={11} aria-hidden="true" />
                  </button>
                </>
              }
            />
          )}
          {diag.backendOwnership && Object.keys(diag.backendOwnership).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "2px 4px" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>{t("diagnostics.coverage")}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {DOMAIN_ORDER.filter((domain) => diag.backendOwnership![domain] !== undefined).map((domain) => {
                  const authority = diag.backendOwnership![domain];
                  const isRust = authority === "rust";
                  return (
                    <span
                      key={domain}
                      title={`${domain}: ${authority}`}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "2px 7px", borderRadius: 999,
                        fontSize: 10, fontFamily: "var(--font-mono)",
                        border: `1px solid ${isRust ? "color-mix(in srgb, var(--status-success) 35%, var(--border))" : "var(--border)"}`,
                        background: isRust ? "color-mix(in srgb, var(--status-success) 10%, var(--bg))" : "var(--bg-subtle)",
                        color: isRust ? "var(--status-success)" : "var(--text-dim)",
                      }}
                    >
                      {domain} · {authority}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          {backendErrors.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "2px 4px" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--status-error)", textTransform: "uppercase", letterSpacing: 0.4 }}>{t("diagnostics.backendErrors")}</span>
              {backendErrors.slice(-5).reverse().map((entry, index) => (
                <div key={`${entry.at}-${index}`} style={{ display: "flex", gap: 6, fontSize: 10.5, lineHeight: 1.45 }}>
                  <code style={{ fontFamily: "var(--font-mono)", color: "var(--status-error)", flexShrink: 0 }}>{entry.kind}</code>
                  <span style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.detail}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "2px 4px" }}>
            <ActionButton
              onClick={() => void repairHost()}
              disabled={actionBusy}
              icon={<Activity size={11} aria-hidden="true" />}
              label={t("diagnostics.repair")}
            />
            <ActionButton
              onClick={() => void restartRpc()}
              disabled={restarting || actionBusy}
              icon={<RotateCcw size={11} aria-hidden="true" />}
              label={restarting ? t("diagnostics.restarting") : t("diagnostics.restartRpc")}
              tone="quiet"
            />
            <ActionButton
              onClick={copyReport}
              disabled={!diag}
              icon={<Copy size={11} aria-hidden="true" />}
              label={t("diagnostics.copyReport")}
              tone="quiet"
            />
            {backendErrors.length > 0 && (
              <ActionButton
                onClick={() => void clearErrors()}
                disabled={actionBusy}
                icon={<Eraser size={11} aria-hidden="true" />}
                label={t("diagnostics.clearErrors")}
                tone="quiet"
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Shared backend health polling (every 30s). Both the status button and the
 * error banner consume this so the abnormal state surfaces consistently.
 */
export function useBackendHealth(): { health: BackendHealth; refresh: () => void; refreshing: boolean } {
  const snapshot = useBackendDiagnostics();
  return { health: snapshot.ready ? snapshot.health : "ok", refresh: snapshot.refresh, refreshing: snapshot.refreshing };
}

export function useBackendDiagnostics(): BackendHealthSnapshot & { refresh: () => void } {
  const snapshot = useSyncExternalStore(
    subscribeBackendHealth,
    () => healthSnapshot,
    () => INITIAL_HEALTH_SNAPSHOT,
  );
  const refresh = useCallback(() => refreshBackendHealth(), []);
  return { ...snapshot, refresh };
}

/**
 * Top-left status button (next to the logo): a colored health dot that opens
 * the diagnostics panel on click. When health turns abnormal the panel
 * auto-opens once so the recovery actions are immediately visible.
 */
export function BackendStatusButton() {
  const { t } = useI18n();
  const { health, ready, refreshing } = useBackendDiagnostics();
  const [open, setOpen] = useState(false);
  const prevHealthRef = useRef<BackendHealth>("ok");
  const autoOpenedRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // 健康状态转为 error 时自动弹出诊断面板（warn 级别只显示横幅，不弹面板，
// 避免面板覆盖内容造成抖动感；用户手动关闭后不再强制弹）。
  useEffect(() => {
    const abnormal = health === "error";
    const wasNormal = prevHealthRef.current === "ok";
    prevHealthRef.current = health;
    if (abnormal && wasNormal && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setOpen(true);
    }
    if (health === "ok") autoOpenedRef.current = false;
  }, [health]);

  // Close on any pointer press outside the panel/button, or on Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const color = !ready || refreshing ? "var(--text-dim)" : health === "ok" ? "var(--status-success)" : health === "warn" ? "var(--status-warning)" : "var(--status-error)";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("diagnostics.status")}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t("diagnostics.status")}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 24, padding: "0 6px", border: "none", borderRadius: "var(--radius-control)", background: open ? "var(--bg-selected)" : "transparent", color: "var(--text-dim)", cursor: "pointer", position: "relative" }}
      >
        <Activity size={13} strokeWidth={2} aria-hidden="true" />
        <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: color, border: "1.5px solid var(--bg-panel)" }} />
        {health === "error" && (
          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--status-error)" }}>{t("diagnostics.error")}</span>
        )}
      </button>
      {open && (
        <div
          ref={panelRef}
          role="menu"
          style={{ position: "fixed", zIndex: 1100, top: 46, left: 14, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-pop)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <BackendDiagnosticsBody />
        </div>
      )}
    </>
  );
}

/**
 * Persistent recovery banner shown when backend health is abnormal: status
 * text + refresh/restart actions + inline diagnostics body. Rendered under
 * the app top bar; hidden when healthy.
 */
export function BackendHealthBanner() {
  const { t } = useI18n();
  const { health, refresh, refreshing } = useBackendHealth();
  const [showDetails, setShowDetails] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [restartSuccess, setRestartSuccess] = useState(false);

  if (health === "ok") return null;

  const restart = async () => {
    setRestarting(true);
    setRestartError(null);
    setRestartSuccess(false);
    try {
      const res = await fetch("/api/omp-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restart" }),
      });
      const data = await res.json() as { ok?: boolean; success?: boolean; sessionsRestarted?: number; error?: string };
      if (!res.ok || !(data.success ?? data.ok) || data.error) {
        setRestartError(data.error ?? "restart failed");
      } else {
        setRestartSuccess(true);
        window.dispatchEvent(new CustomEvent("omp-rpc-restarted"));
        window.setTimeout(() => refresh(), 500);
        window.setTimeout(() => setRestartSuccess(false), 3500);
      }
    } catch (e) {
      setRestartError(e instanceof Error ? e.message : String(e));
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div
      role="alert"
      style={{
        display: "flex", alignItems: "center", gap: 8, flexShrink: 0, position: "relative",
        padding: "5px 10px", borderBottom: "1px solid var(--border)",
        background: "color-mix(in srgb, var(--status-error) 8%, var(--bg-panel))",
        fontSize: 11.5, color: "var(--text)",
      }}
    >
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: health === "warn" ? "var(--status-warning)" : "var(--status-error)", flexShrink: 0 }} />
      <span style={{ fontWeight: 600, color: health === "warn" ? "var(--status-warning)" : "var(--status-error)" }}>
        {health === "warn" ? t("diagnostics.warning") : t("diagnostics.error")}
      </span>
      <span style={{ color: "var(--text-muted)" }}>{health === "warn" ? t("diagnostics.bannerHintWarn") : t("diagnostics.bannerHint")}</span>
      <button type="button" onClick={refresh} disabled={refreshing} style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: "auto", padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 11, cursor: refreshing ? "default" : "pointer", opacity: refreshing ? 0.65 : 1 }}>
        <RefreshCw size={10} className={refreshing ? "animate-spin" : undefined} aria-hidden="true" />
        {refreshing ? t("diagnostics.refreshing") : t("diagnostics.refresh")}
      </button>
      <button
        type="button"
        onClick={() => void restart()}
        disabled={restarting}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, border: "none", background: "var(--accent)", color: "var(--on-accent)", fontSize: 11, fontWeight: 600, cursor: restarting ? "default" : "pointer", opacity: restarting ? 0.6 : 1 }}
      >
        <RotateCcw size={10} aria-hidden="true" />
        {restarting ? t("diagnostics.restarting") : t("diagnostics.restartRpc")}
      </button>
      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        style={{ display: "inline-flex", alignItems: "center", padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}
      >
        {showDetails ? t("diagnostics.hideDetails") : t("diagnostics.showDetails")}
      </button>
      {restartError && <span style={{ color: "var(--status-error)" }}>{restartError}</span>}
      {restartSuccess && <span role="status" style={{ color: "var(--status-success)", fontSize: 11 }}>{t("diagnostics.restartSuccess")}</span>}
      {showDetails && (
        <div style={{ position: "absolute", top: "100%", right: 10, zIndex: 1100, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-pop)" }}>
          <BackendDiagnosticsBody />
        </div>
      )}
    </div>
  );
}

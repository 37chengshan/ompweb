"use client";

import { useEffect, useState, useCallback, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  Clock,
  Copy,
  Cpu,
  Eraser,
  ExternalLink,
  FileCode,
  FolderOpen,
  Layers,
  Network,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { toast } from "@/components/ui/toast";

export interface DiagnosticsData {
  server: { node: string; platform: string; arch: string; uptimeSeconds: number; tools?: Record<string, boolean> };
  system?: {
    memory: { rss: number; heapUsed: number; heapTotal: number };
    cpus: number;
    hostname: string;
  };
  paths?: {
    ompBin: string | null;
    rustHostBin: string | null;
    configRoot: string;
    agentDir: string;
    sessionsDir: string;
    settingsPath: string;
    modelsPath: string;
  };
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

function formatUptime(sec: number, isZh: boolean): string {
  if (sec < 60) return isZh ? `${sec} 秒` : `${sec}s`;
  const mins = Math.floor(sec / 60);
  if (mins < 60) return isZh ? `${mins} 分钟` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return isZh ? `${hours} 小时 ${remMins} 分` : `${hours}h ${remMins}m`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return isZh ? `${days} 天 ${remHours} 小时` : `${days}d ${remHours}h`;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const DOMAIN_INFO: Record<string, { labelZh: string; labelEn: string; descZh: string; descEn: string }> = {
  agent: { labelZh: "代理调度", labelEn: "Agent", descZh: "OMP 代理子进程生命周期调度与交互", descEn: "Agent process lifecycle & RPC" },
  event: { labelZh: "实时事件", labelEn: "Events", descZh: "SSE 流式事件多路复用与心跳保证", descEn: "SSE stream multiplexing & frames" },
  session: { labelZh: "会话历史", labelEn: "Sessions", descZh: "会话树形历史解析与快照索引", descEn: "Session JSONL tree & snapshot index" },
  pty: { labelZh: "终端仿真", labelEn: "Terminal PTY", descZh: "原生伪终端 Shell 会话与输入输出流", descEn: "Native pseudo-terminal PTY session" },
  files: { labelZh: "安全文件", labelEn: "Files", descZh: "沙箱路径受限的文件树与文件访问", descEn: "Sandboxed workspace file explorer" },
  git: { labelZh: "Git 仓库", labelEn: "Git VCS", descZh: "工作区状态、分支管理与提交推送", descEn: "Git status, branches, commit & push" },
  settings: { labelZh: "配置管理", labelEn: "Settings", descZh: "原生 config.yml 与 models.yml 管理", descEn: "Native YAML settings & models" },
  commands: { labelZh: "快捷命令", labelEn: "Commands", descZh: "注册脚本与安全快速指令执行", descEn: "Quick scripts & command execution" },
  remote: { labelZh: "远程接入", labelEn: "Remote", descZh: "移动端与跨设备安全访问配对运行时", descEn: "Device pairing & remote gateway" },
};

function RevealButton({ path, label = "在访达中显示" }: { path?: string | null; label?: string }) {
  const [busy, setBusy] = useState(false);
  if (!path) return null;

  const handleReveal = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? "定位失败");
      } else {
        toast.success("已在系统文件管理器中打开");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "定位失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleReveal}
      disabled={busy}
      title={label}
      aria-label={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        borderRadius: "var(--radius-control)",
        border: "1px solid var(--border)",
        background: "var(--bg-subtle)",
        color: "var(--text-muted)",
        fontSize: 11,
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1,
        whiteSpace: "nowrap",
        flexShrink: 0,
        transition: "all var(--dur-fast)",
      }}
    >
      <FolderOpen size={11} aria-hidden="true" />
      <span>{busy ? "定位中…" : label}</span>
    </button>
  );
}

/** Popover layout used in top bar button and recovery banner */
function BackendDiagnosticsPopoverView() {
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
      const data = (await res.json()) as { ok?: boolean; success?: boolean; error?: string };
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
    setActionBusy(true);
    setSuccess(null);
    setError(null);
    try {
      const res = await fetch("/api/omp-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "repair" }),
      });
      const data = (await res.json()) as { ok?: boolean; success?: boolean; error?: string };
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

/** Full-width developer-grade system diagnostics & recovery control center */
function BackendDiagnosticsFullView() {
  const { t, locale } = useI18n();
  const isZh = locale.startsWith("zh");
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
      const data = (await res.json()) as { ok?: boolean; success?: boolean; error?: string };
      if (!res.ok || !(data.success ?? data.ok)) {
        const msg = data.error ?? "restart failed";
        setError(msg);
        toast.error("重启失败", msg);
      } else {
        markManualFix();
        setSuccess(t("diagnostics.restartSuccess"));
        toast.success(t("diagnostics.restartSuccess"));
        refreshDetails();
        window.dispatchEvent(new CustomEvent("omp-rpc-restarted"));
        window.setTimeout(() => refreshDetails(), 500);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("重启失败", msg);
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
        toast.error("清除错误失败");
      } else {
        setSuccess(t("diagnostics.errorsCleared"));
        toast.success(t("diagnostics.errorsCleared"));
        refreshDetails();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("清除错误失败", msg);
    } finally {
      setActionBusy(false);
    }
  }, [refreshDetails, t]);

  const repairHost = useCallback(async () => {
    setActionBusy(true);
    setSuccess(null);
    setError(null);
    try {
      const res = await fetch("/api/omp-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "repair" }),
      });
      const data = (await res.json()) as { ok?: boolean; success?: boolean; error?: string };
      if (!res.ok || !(data.success ?? data.ok)) {
        const msg = data.error ?? "repair failed";
        setError(msg);
        toast.error("自愈修复失败", msg);
      } else {
        markManualFix();
        setSuccess(t("diagnostics.repairSuccess"));
        toast.success(t("diagnostics.repairSuccess"));
        refreshDetails();
        window.setTimeout(() => refreshDetails(), 500);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("自愈修复失败", msg);
    } finally {
      setActionBusy(false);
    }
  }, [refreshDetails, t]);

  const copyReport = useCallback(() => {
    if (!diag) return;
    const backendErrors = diag.backendErrors ?? [];
    const lines = [
      `=== ompweb 系统诊断报告 (${new Date().toISOString()}) ===`,
      `整体健康: ${healthOf(diag)}`,
      `OMP 引擎: ${diag.omp.installed ? `${diag.omp.version ?? "?"} (${diag.omp.path ?? ""})` : "未安装"}`,
      `Rust Host: ${diag.rustHost ? `${diag.rustHost.mode} (可用: ${diag.rustHost.available}) ${diag.rustHost.path}` : "未就绪"}`,
      `网络代理: ${diag.proxy.effective ?? "直连未启用"} (模式: ${diag.proxy.config.mode})`,
      `会话状态: ${diag.rpc.activeSessions} 个活跃会话, ${diag.rpc.recentFailures?.length ?? 0} 次近期失败, ${diag.rpc.orphanRustHosts ?? 0} 个孤立 Host`,
      `系统环境: ${diag.server.platform}/${diag.server.arch} (Node ${diag.server.node}, 运行: ${diag.server.uptimeSeconds}s)`,
      `Web 端口: ${diag.web.url}`,
      `9 域权威: ${Object.entries(diag.backendOwnership ?? {}).map(([d, a]) => `${d}=${a}`).join(", ")}`,
      ...(backendErrors.length ? [`--- 后端异常记录 (${backendErrors.length} 条) ---`, ...backendErrors.map((e) => `[${new Date(e.at).toLocaleTimeString()}] [${e.kind}] ${e.detail}`)] : []),
    ];
    void navigator.clipboard.writeText(lines.join("\n")).then(() => {
      toast.success(t("diagnostics.reportCopied"));
      setSuccess(t("diagnostics.reportCopied"));
      window.setTimeout(() => setSuccess(null), 2500);
    });
  }, [diag, t]);

  const stopOtherInstance = useCallback(async (port: number) => {
    setActionBusy(true);
    try {
      const res = await fetch("/api/omp-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop-instance", port }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (data && !data.success && data.error) {
        toast.error("清理冲突实例失败", data.error);
      } else {
        toast.success(t("diagnostics.instanceStopped"));
        window.setTimeout(() => refreshDetails(), 500);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "清理失败");
    } finally {
      setActionBusy(false);
    }
  }, [refreshDetails, t]);

  const health = diag ? healthOf(diag) : null;
  const healthColor = health === null ? "var(--text-dim)" : health === "ok" ? "var(--status-success)" : health === "warn" ? "var(--status-warning)" : "var(--status-error)";
  const backendErrors = diag?.backendErrors ?? [];

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 18 }}>
      {/* TOP HEADER & ACTION BAR */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          padding: "16px 20px",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 38,
              height: 38,
              borderRadius: "50%",
              background: `color-mix(in srgb, ${healthColor} 14%, var(--bg))`,
              border: `1px solid color-mix(in srgb, ${healthColor} 30%, var(--border))`,
            }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: healthColor,
                boxShadow: `0 0 10px ${healthColor}`,
              }}
            />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", letterSpacing: -0.2 }}>
                {health === null
                  ? t("diagnostics.refreshing")
                  : health === "ok"
                    ? (isZh ? "所有服务运行正常 (All Systems Operational)" : "All Systems Operational")
                    : health === "warn"
                      ? (isZh ? "系统运行有警告 (Needs Attention)" : "System Warning")
                      : (isZh ? "后端服务异常 (Critical Error)" : "Critical Backend Failure")}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: `color-mix(in srgb, ${healthColor} 12%, var(--bg))`,
                  color: healthColor,
                  border: `1px solid color-mix(in srgb, ${healthColor} 25%, var(--border))`,
                }}
              >
                {health?.toUpperCase() ?? "CHECKING"}
              </span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Clock size={12} aria-hidden="true" />
                {isZh ? "自动轮询: 每 30 秒" : "Polling: every 30s"}
              </span>
              <span>·</span>
              <span>
                {diag?.server ? `${diag.server.platform}/${diag.server.arch} (Node ${diag.server.node})` : "探测中…"}
              </span>
            </div>
          </div>
        </div>

        {/* Action Toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => void repairHost()}
            disabled={actionBusy}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 14px",
              borderRadius: "var(--radius-control)",
              background: "var(--accent)",
              color: "var(--on-accent)",
              border: "none",
              fontSize: 12,
              fontWeight: 600,
              cursor: actionBusy ? "default" : "pointer",
              opacity: actionBusy ? 0.7 : 1,
              transition: "opacity var(--dur-fast)",
            }}
          >
            <Activity size={13} className={actionBusy ? "animate-spin" : undefined} aria-hidden="true" />
            {isZh ? "一键无损修复" : "Repair Host"}
          </button>

          <button
            type="button"
            onClick={() => void restartRpc()}
            disabled={restarting || actionBusy}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 14px",
              borderRadius: "var(--radius-control)",
              background: "var(--bg-subtle)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              fontSize: 12,
              fontWeight: 600,
              cursor: restarting || actionBusy ? "default" : "pointer",
              opacity: restarting || actionBusy ? 0.7 : 1,
              transition: "all var(--dur-fast)",
            }}
          >
            <RotateCcw size={13} className={restarting ? "animate-spin" : undefined} aria-hidden="true" />
            {restarting ? t("diagnostics.restarting") : t("diagnostics.restartRpc")}
          </button>

          <button
            type="button"
            onClick={copyReport}
            disabled={!diag}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 12px",
              borderRadius: "var(--radius-control)",
              background: "var(--bg-subtle)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              fontSize: 12,
              fontWeight: 500,
              cursor: !diag ? "default" : "pointer",
              transition: "all var(--dur-fast)",
            }}
          >
            <Copy size={13} aria-hidden="true" />
            {t("diagnostics.copyReport")}
          </button>

          <button
            type="button"
            onClick={() => refreshDetails()}
            disabled={refreshing || restarting}
            title={t("diagnostics.refresh")}
            aria-label={t("diagnostics.refresh")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: "var(--radius-control)",
              background: "var(--bg-subtle)",
              color: "var(--text-muted)",
              border: "1px solid var(--border)",
              cursor: refreshing ? "default" : "pointer",
              transition: "all var(--dur-fast)",
            }}
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : undefined} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* FEEDBACK NOTICES */}
      {error && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderRadius: "var(--radius-control)",
            background: "color-mix(in srgb, var(--status-error) 10%, var(--bg-panel))",
            border: "1px solid color-mix(in srgb, var(--status-error) 30%, var(--border))",
            color: "var(--status-error)",
            fontSize: 12,
          }}
        >
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderRadius: "var(--radius-control)",
            background: "color-mix(in srgb, var(--status-success) 10%, var(--bg-panel))",
            border: "1px solid color-mix(in srgb, var(--status-success) 30%, var(--border))",
            color: "var(--status-success)",
            fontSize: 12,
          }}
        >
          <Check size={15} aria-hidden="true" />
          <span>{success}</span>
        </div>
      )}

      {/* RECOVERY QUEUE */}
      {diag && (() => {
        const hostDown = Boolean(diag.rustHost && diag.rustHost.mode !== "node" && !diag.rustHost.available);
        const hostCrash = backendErrors.some((entry) => entry.kind === "host_crash" || entry.kind === "host_unavailable");
        const rpcFailed = (diag.rpc.recentFailures?.length ?? 0) > 0;
        const orphan = (diag.rpc.orphanRustHosts ?? 0) > 0;
        const otherInstances = diag.instances?.others ?? [];
        const missingOmp = !diag.omp.installed;

        const issues = [
          missingOmp ? { key: "omp", title: "OMP 引擎缺失", detail: "系统路径下未检测到 omp 可执行文件，代理核心功能受限。", action: undefined } : null,
          hostDown || hostCrash ? { key: "host", title: "Rust Host 守护进程异常", detail: "Host 未就绪或发生崩溃，一键修复将清理孤立进程并自动重新拉起。", action: <button type="button" onClick={() => void repairHost()} disabled={actionBusy} style={{ padding: "5px 12px", borderRadius: "var(--radius-control)", background: "var(--accent)", color: "var(--on-accent)", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{t("diagnostics.repair")}</button> } : null,
          orphan ? { key: "orphan", title: `检测到 ${diag.rpc.orphanRustHosts} 个孤立 Host 进程`, detail: "孤儿进程可能占用系统会话锁或伪终端句柄，建议及时回收。", action: <button type="button" onClick={() => void repairHost()} disabled={actionBusy} style={{ padding: "5px 12px", borderRadius: "var(--radius-control)", background: "var(--accent)", color: "var(--on-accent)", border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>清理孤立进程</button> } : null,
          rpcFailed ? { key: "rpc", title: `近期有 ${diag.rpc.recentFailures?.length} 次 RPC 会话失败`, detail: "可能由模型子进程异常终止引起，重启 RPC 可恢复所有断开通道。", action: <button type="button" onClick={() => void restartRpc()} disabled={restarting || actionBusy} style={{ padding: "5px 12px", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", border: "1px solid var(--border)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{t("diagnostics.restartRpc")}</button> } : null,
          ...otherInstances.map((port) => ({
            key: `instance-${port}`,
            title: `检测到端口冲突实例 (127.0.0.1:${port})`,
            detail: "另一 ompweb 实例正在运行，可能产生会话并发读写竞争或锁冲突。",
            action: <button type="button" onClick={() => void stopOtherInstance(port)} disabled={actionBusy} style={{ padding: "5px 12px", borderRadius: "var(--radius-control)", background: "color-mix(in srgb, var(--status-error) 15%, var(--bg))", color: "var(--status-error)", border: "1px solid var(--status-error)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>关闭该实例</button>,
          })),
        ].filter(Boolean) as Array<{ key: string; title: string; detail: string; action?: ReactNode }>;

        if (!issues.length) return null;

        return (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: "14px 16px",
              borderRadius: "var(--radius-card)",
              background: "color-mix(in srgb, var(--status-warning) 7%, var(--bg-panel))",
              border: "1px solid color-mix(in srgb, var(--status-warning) 30%, var(--border))",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--status-warning)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              <ShieldAlert size={15} aria-hidden="true" />
              <span>{isZh ? "系统自愈就绪队列 (Recovery Queue)" : "Recovery Queue"}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {issues.map((issue) => (
                <div
                  key={issue.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "8px 12px",
                    background: "var(--bg-panel)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-control)",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 650, color: "var(--text)" }}>{issue.title}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{issue.detail}</div>
                  </div>
                  {issue.action}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* 4 HERO KPI CARDS */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 14,
        }}
      >
        {/* KPI 1: System & Environment */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "16px",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Server size={14} aria-hidden="true" />
              {isZh ? "系统与环境" : "System & Env"}
            </span>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--status-success)" }} />
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: -0.5 }}>
              {diag ? formatUptime(diag.server.uptimeSeconds, isZh) : "—"}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>{isZh ? "持续运行时间" : "Uptime"}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Node.js / 架构:</span>
              <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{diag?.server ? `${diag.server.node} (${diag.server.arch})` : "—"}</code>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>内存占用 (RSS):</span>
              <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{formatBytes(diag?.system?.memory.rss)}</code>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>CPU / 主机:</span>
              <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{diag?.system ? `${diag.system.cpus} 核 · ${diag.system.hostname}` : "—"}</code>
            </div>
          </div>
        </div>

        {/* KPI 2: OMP Engine Runtime */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "16px",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Terminal size={14} aria-hidden="true" />
              {isZh ? "OMP 核心引擎" : "OMP Engine"}
            </span>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: diag?.omp.installed ? "var(--status-success)" : "var(--status-error)",
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: -0.5 }}>
              {diag?.omp.installed ? (diag.omp.version ?? "已就绪") : (isZh ? "未安装" : "Missing")}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
              {diag?.omp.installed ? (isZh ? "CLI 引擎版本" : "CLI Engine Version") : (isZh ? "需安装 omp CLI" : "CLI Required")}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "var(--text-muted)" }}>安装状态:</span>
              <span style={{ color: diag?.omp.installed ? "var(--status-success)" : "var(--status-error)", fontWeight: 600 }}>
                {diag?.omp.installed ? (isZh ? "已安装就绪" : "Installed") : (isZh ? "缺失" : "Missing")}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>网络代理:</span>
              <span style={{ color: diag?.proxy.effective ? "var(--accent)" : "var(--text-dim)" }}>
                {diag?.proxy.effective ?? (isZh ? "直连模式" : "Direct")}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>工具链:</span>
              <span style={{ color: "var(--text)" }}>
                {diag?.server.tools ? Object.entries(diag.server.tools).filter(([, ok]) => ok).map(([k]) => k).join(", ") : "—"}
              </span>
            </div>
          </div>
        </div>

        {/* KPI 3: Rust Host Daemon */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "16px",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Cpu size={14} aria-hidden="true" />
              {isZh ? "Rust Host 守护进程" : "Rust Host IPC"}
            </span>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: diag?.rustHost?.available ? "var(--status-success)" : "var(--status-warning)",
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: -0.5 }}>
              {diag?.rustHost?.available ? (isZh ? "运行中" : "Available") : (isZh ? "未就绪" : "Unavailable")}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
              {diag?.rustHost?.mode ? `${isZh ? "运行模式" : "Mode"}: ${diag.rustHost.mode}` : "—"}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>IPC 协议:</span>
              <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>TCP 127.0.0.1</code>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>孤立进程:</span>
              <span style={{ color: (diag?.rpc.orphanRustHosts ?? 0) > 0 ? "var(--status-warning)" : "var(--text-dim)" }}>
                {diag?.rpc.orphanRustHosts ?? 0} {isZh ? "个孤儿 host" : "orphans"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>守护状态:</span>
              <span style={{ color: "var(--status-success)", fontWeight: 500 }}>Supervisor Active</span>
            </div>
          </div>
        </div>

        {/* KPI 4: RPC Sessions & Ports */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "16px",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-card)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Activity size={14} aria-hidden="true" />
              {isZh ? "RPC 会话与服务" : "Sessions & Port"}
            </span>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: (diag?.rpc.recentFailures?.length ?? 0) > 0 ? "var(--status-warning)" : "var(--status-success)",
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: -0.5 }}>
              {diag?.rpc.activeSessions ?? 0} {isZh ? "活跃" : "Active"}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>{isZh ? "活动 RPC 会话" : "Active RPC Sessions"}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Web 绑定:</span>
              <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>127.0.0.1:{diag?.web.port ?? "—"}</code>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>近期失败:</span>
              <span style={{ color: (diag?.rpc.recentFailures?.length ?? 0) > 0 ? "var(--status-error)" : "var(--text-dim)" }}>
                {diag?.rpc.recentFailures?.length ?? 0} {isZh ? "次" : ""}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>冲突实例:</span>
              <span style={{ color: (diag?.instances?.others.length ?? 0) > 0 ? "var(--status-warning)" : "var(--text-dim)" }}>
                {(diag?.instances?.others.length ?? 0) === 0 ? (isZh ? "无冲突" : "None") : `${diag!.instances!.others.length} 个实例`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* RUNTIME TOPOLOGY */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: "16px 20px",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Network size={15} aria-hidden="true" />
            <span>{isZh ? "运行服务拓扑与网络流 (Runtime Architecture Topology)" : "Runtime Topology"}</span>
          </div>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {diag?.proxy.effective ? `代理: ${diag.proxy.effective}` : (isZh ? "网络: 直连模式" : "Network: Direct")}
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            alignItems: "center",
            gap: 8,
            padding: "8px 0",
          }}
        >
          {/* Node 1: Browser */}
          <div
            style={{
              padding: "10px 12px",
              borderRadius: "var(--radius-control)",
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>Web UI 客户端</span>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--status-success)" }} />
            </div>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Next.js Client / Electron</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)" }}>
            <ArrowRight size={14} aria-hidden="true" />
            <span style={{ fontSize: 9.5, fontFamily: "var(--font-mono)", margin: "0 4px" }}>SSE / Fetch</span>
          </div>

          {/* Node 2: Web Server */}
          <div
            style={{
              padding: "10px 12px",
              borderRadius: "var(--radius-control)",
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>Next.js 服务端</span>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--status-success)" }} />
            </div>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Port {diag?.web.port ?? "30178"} · Node {diag?.server.node}</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)" }}>
            <ArrowRight size={14} aria-hidden="true" />
            <span style={{ fontSize: 9.5, fontFamily: "var(--font-mono)", margin: "0 4px" }}>Local TCP</span>
          </div>

          {/* Node 3: Rust Host */}
          <div
            style={{
              padding: "10px 12px",
              borderRadius: "var(--radius-control)",
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>Rust Host 守护</span>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: diag?.rustHost?.available ? "var(--status-success)" : "var(--status-warning)",
                }}
              />
            </div>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>ompweb-host supervisor</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)" }}>
            <ArrowRight size={14} aria-hidden="true" />
            <span style={{ fontSize: 9.5, fontFamily: "var(--font-mono)", margin: "0 4px" }}>NDJSON stdio</span>
          </div>

          {/* Node 4: OMP Engine */}
          <div
            style={{
              padding: "10px 12px",
              borderRadius: "var(--radius-control)",
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: 3,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>OMP 引擎进程</span>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: diag?.omp.installed ? "var(--status-success)" : "var(--status-error)",
                }}
              />
            </div>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>omp --mode rpc-ui</span>
          </div>
        </div>
      </div>

      {/* SYSTEM PATHS & REVEAL IN FINDER */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: "16px 20px",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <FolderOpen size={15} aria-hidden="true" />
            <span>{isZh ? "核心系统路径与文件定位 (System Paths & Inspection)" : "Core System Paths"}</span>
          </div>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {isZh ? "支持一键在访达中高亮显示或复制完整绝对路径" : "Click to reveal in file manager"}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            {
              label: isZh ? "OMP 核心可执行文件" : "OMP Binary",
              path: diag?.paths?.ompBin ?? diag?.omp.path,
              desc: isZh ? "omp CLI 二进制程序入口" : "OMP executable binary",
            },
            {
              label: isZh ? "Rust Host 宿主程序" : "Rust Host Binary",
              path: diag?.paths?.rustHostBin ?? diag?.rustHost?.path,
              desc: isZh ? "ompweb-host 宿主守护进程程序" : "ompweb-host supervisor binary",
            },
            {
              label: isZh ? "会话历史存储目录" : "Sessions Directory",
              path: diag?.paths?.sessionsDir,
              desc: isZh ? "所有会话 JSONL 与分支树快照存放路径" : "Session JSONL records & tree branches",
            },
            {
              label: isZh ? "全局配置根目录" : "OMP Config Root",
              path: diag?.paths?.configRoot,
              desc: isZh ? "~/.omp 核心配置与资源存储目录" : "OMP home directory root",
            },
            {
              label: isZh ? "设置配置文件 (config.yml)" : "Settings Config",
              path: diag?.paths?.settingsPath,
              desc: isZh ? "OMP 原生全局设置文件" : "OMP native settings YAML",
            },
            {
              label: isZh ? "模型配置文件 (models.yml)" : "Models Config",
              path: diag?.paths?.modelsPath,
              desc: isZh ? "模型提供方与自定义配置" : "Models & provider configuration YAML",
            },
          ]
            .filter((item) => Boolean(item.path))
            .map((item) => (
              <div
                key={item.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "8px 12px",
                  borderRadius: "var(--radius-control)",
                  background: "var(--bg-subtle)",
                  border: "1px solid var(--border)",
                }}
              >
                <div style={{ minWidth: 160, flexShrink: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 650, color: "var(--text)" }}>{item.label}</div>
                  <div style={{ fontSize: 10.5, color: "var(--text-dim)" }}>{item.desc}</div>
                </div>

                <code
                  title={item.path!}
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--text)",
                    background: "var(--bg)",
                    padding: "4px 8px",
                    borderRadius: 4,
                    border: "1px solid var(--border)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {item.path}
                </code>

                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <CopyButton text={item.path!} title={t("diagnostics.copy")} />
                  <RevealButton path={item.path!} label={isZh ? "在访达中显示" : "Reveal"} />
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* 9-DOMAIN BACKEND OWNERSHIP */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: "16px 20px",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Layers size={15} aria-hidden="true" />
            <span>{isZh ? "9 域后端权威与迁移状态 (Backend Authority Matrix)" : "Backend Authority Matrix"}</span>
          </div>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            backend-ownership.yaml (doc 15 / doc 16)
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 8,
          }}
        >
          {DOMAIN_ORDER.map((domain) => {
            const authority = diag?.backendOwnership?.[domain] ?? "node";
            const isRust = authority === "rust";
            const info = DOMAIN_INFO[domain];
            return (
              <div
                key={domain}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: "var(--radius-control)",
                  background: isRust ? "color-mix(in srgb, var(--status-success) 5%, var(--bg-subtle))" : "var(--bg-subtle)",
                  border: `1px solid ${isRust ? "color-mix(in srgb, var(--status-success) 35%, var(--border))" : "var(--border)"}`,
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <code style={{ fontSize: 11.5, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--text)" }}>{domain}</code>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>({isZh ? info?.labelZh : info?.labelEn})</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 2 }}>{isZh ? info?.descZh : info?.descEn}</div>
                </div>

                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: "var(--font-mono)",
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: isRust ? "color-mix(in srgb, var(--status-success) 15%, var(--bg))" : "var(--bg)",
                    border: `1px solid ${isRust ? "var(--status-success)" : "var(--border)"}`,
                    color: isRust ? "var(--status-success)" : "var(--text-dim)",
                    flexShrink: 0,
                  }}
                >
                  {isRust ? "RUST 宿主" : "NODE.JS"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* BACKEND ERROR RING CONSOLE */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: "16px 20px",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <FileCode size={15} aria-hidden="true" />
            <span>{isZh ? "后端错误环记录控制台 (Error Ring Console)" : "Backend Error Console"}</span>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 999,
                background: backendErrors.length > 0 ? "var(--status-error)" : "var(--status-success)",
                color: "var(--on-accent)",
              }}
            >
              {backendErrors.length}
            </span>
          </div>

          {backendErrors.length > 0 && (
            <button
              type="button"
              onClick={() => void clearErrors()}
              disabled={actionBusy}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "4px 10px",
                borderRadius: "var(--radius-control)",
                background: "var(--bg-subtle)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                fontSize: 11,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              <Eraser size={12} aria-hidden="true" />
              <span>{t("diagnostics.clearErrors")}</span>
            </button>
          )}
        </div>

        {backendErrors.length === 0 ? (
          <div
            style={{
              padding: "14px",
              borderRadius: "var(--radius-control)",
              background: "var(--bg-subtle)",
              border: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "var(--status-success)",
            }}
          >
            <ShieldCheck size={16} aria-hidden="true" />
            <span>{isZh ? "当前无任何后端未决异常，错误环为空 (0 errors recorded)" : "No unresolved backend errors recorded"}</span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {backendErrors.slice(-10).reverse().map((entry, index) => (
              <div
                key={`${entry.at}-${index}`}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "8px 12px",
                  borderRadius: "var(--radius-control)",
                  background: "color-mix(in srgb, var(--status-error) 6%, var(--bg))",
                  border: "1px solid color-mix(in srgb, var(--status-error) 25%, var(--border))",
                  fontSize: 11.5,
                  lineHeight: 1.5,
                }}
              >
                <code
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: "var(--status-error)",
                    fontWeight: 700,
                    fontSize: 11,
                    flexShrink: 0,
                  }}
                >
                  [{entry.kind}]
                </code>
                <span style={{ color: "var(--text)", flex: 1, wordBreak: "break-all" }}>{entry.detail}</span>
                <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>
                  {new Date(entry.at).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Diagnostics panel body: switches between compact popover and full-width dashboard */
export function BackendDiagnosticsBody({ variant = "popover" }: { variant?: "popover" | "full" }) {
  if (variant === "full") {
    return <BackendDiagnosticsFullView />;
  }
  return <BackendDiagnosticsPopoverView />;
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

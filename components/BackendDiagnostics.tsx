"use client";

import { useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { Activity, ExternalLink, RefreshCw, RotateCcw } from "lucide-react";

export interface DiagnosticsData {
  server: { node: string; platform: string; arch: string; uptimeSeconds: number };
  omp: { installed: boolean; path: string | null; version: string | null };
  proxy: { config: { mode: string; url?: string }; effective: string | null };
  rpc: { activeSessions: number; recentFailures?: string[] };
  instances?: { selfPort: number; others: number[] };
  web: { port: string; url: string };
}

export type BackendHealth = "ok" | "warn" | "error";

/**
 * Overall health. Beyond omp installation, recent RPC failures (unexpected
 * child exits / session splits caused by other instances holding the session
 * file) mean messages cannot actually be sent — that must flip the indicator,
 * otherwise the UI lies ("服务正常" while sends fail).
 */
export function healthOf(d: DiagnosticsData): BackendHealth {
  if (!d.omp.installed) return "error";
  const failures = d.rpc.recentFailures?.length ?? 0;
  if (failures >= 2) return "error";
  if (failures >= 1) return "warn";
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

/** Diagnostics panel body: health summary, per-service rows, fix actions. */
export function BackendDiagnosticsBody() {
  const { t } = useI18n();
  const [diag, setDiag] = useState<DiagnosticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  const refresh = useCallback(() => {
    setError(null);
    void fetch("/api/diagnostics")
      .then((res) => (res.ok ? res.json() as Promise<DiagnosticsData> : null))
      .then((data) => {
        if (data) setDiag(data);
        else setError("HTTP failed");
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const restartRpc = useCallback(async () => {
    setRestarting(true);
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
        setTimeout(refresh, 1500);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRestarting(false);
    }
  }, [refresh]);

  const health = diag ? healthOf(diag) : null;
  const healthColor = health === "ok" ? "var(--status-success)" : health === "warn" ? "var(--status-warning)" : "var(--status-error)";

  return (
    <div style={{ minWidth: 300, maxWidth: 380, padding: 8, display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "2px 4px" }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: healthColor, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
          {health === "ok" ? t("diagnostics.healthy") : health === "warn" ? t("diagnostics.warning") : t("diagnostics.error")}
        </span>
        <button
          type="button"
          onClick={() => refresh()}
          aria-label={t("diagnostics.refresh")}
          title={t("diagnostics.refresh")}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, marginLeft: "auto", padding: 0, border: "none", borderRadius: 5, background: "transparent", color: "var(--text-dim)", cursor: "pointer" }}
        >
          <RefreshCw size={11} aria-hidden="true" />
        </button>
      </div>
      {error && <div style={{ fontSize: 11, color: "var(--status-error)", padding: "0 4px" }}>{t("diagnostics.error")}: {error}</div>}
      {diag && (
        <>
          <Row label={t("diagnostics.omp")} ok={diag.omp.installed} detail={diag.omp.installed ? `${diag.omp.version ?? "?"} · ${diag.omp.path ?? ""}` : t("diagnostics.ompMissing")} />
          <Row label={t("diagnostics.proxy")} ok={Boolean(diag.proxy.effective)} detail={diag.proxy.effective ?? t("diagnostics.proxyOff")} />
          <Row label={t("diagnostics.rpc")} ok={(diag.rpc.recentFailures?.length ?? 0) === 0} detail={diag.rpc.recentFailures?.length ? `${diag.rpc.recentFailures.length} ${t("diagnostics.recentFailures")}` : `${diag.rpc.activeSessions} ${t("diagnostics.sessions")}`} />
          <Row label={t("diagnostics.server")} ok detail={`${diag.server.platform}/${diag.server.arch} · node ${diag.server.node}`} />
          {(diag.instances?.others.length ?? 0) > 0 && diag.instances!.others.map((port) => (
            <Row
              key={port}
              label={t("diagnostics.otherInstance")}
              ok={false}
              detail={`127.0.0.1:${port}`}
              action={
                <button
                  type="button"
                  onClick={() => {
                    void fetch("/api/omp-update", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "stop-instance", port }),
                    })
                      .then((res) => res.json())
                      .then((data) => {
                        if (data && !data.success && data.error) setError(data.error);
                        else setTimeout(refresh, 1500);
                      })
                      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
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
                <button
                  type="button"
                  onClick={() => window.open(diag.web.url, "_blank", "noopener")}
                  aria-label={t("diagnostics.openBrowser")}
                  title={t("diagnostics.openBrowser")}
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, padding: 0, border: "none", borderRadius: 4, background: "transparent", color: "var(--accent)", cursor: "pointer", flexShrink: 0 }}
                >
                  <ExternalLink size={11} aria-hidden="true" />
                </button>
              }
            />
          )}
          {(health === "error" || !diag.omp.installed || diag.rpc.activeSessions === 0) && (
            <button
              type="button"
              onClick={() => void restartRpc()}
              disabled={restarting}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, alignSelf: "flex-start", padding: "4px 10px", borderRadius: "var(--radius-control)", background: "var(--accent)", color: "var(--on-accent)", border: "none", fontSize: 11, fontWeight: 600, cursor: restarting ? "default" : "pointer", opacity: restarting ? 0.6 : 1 }}
            >
              <RotateCcw size={11} aria-hidden="true" />
              {restarting ? t("diagnostics.restarting") : t("diagnostics.restartRpc")}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Shared backend health polling (every 30s). Both the status button and the
 * error banner consume this so the abnormal state surfaces consistently.
 */
export function useBackendHealth(): { health: BackendHealth; refresh: () => void } {
  const [health, setHealth] = useState<BackendHealth>("ok");
  const refresh = useCallback(() => {
    void fetch("/api/diagnostics")
      .then((res) => (res.ok ? res.json() as Promise<DiagnosticsData> : null))
      .then((data) => {
        if (data) setHealth(healthOf(data));
      })
      .catch(() => setHealth("error"));
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);
  return { health, refresh };
}

/**
 * Top-left status button (next to the logo): a colored health dot that opens
 * the diagnostics panel on click. When health turns abnormal the panel
 * auto-opens once so the recovery actions are immediately visible.
 */
export function BackendStatusButton() {
  const { t } = useI18n();
  const { health } = useBackendHealth();
  const [open, setOpen] = useState(false);
  const prevHealthRef = useRef<BackendHealth>("ok");
  const autoOpenedRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // 健康状态从正常转为异常时自动弹出诊断面板（用户手动关闭后不再强制弹）。
  useEffect(() => {
    const abnormal = health === "error" || health === "warn";
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

  const color = health === "ok" ? "var(--status-success)" : health === "warn" ? "var(--status-warning)" : "var(--status-error)";

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
  const { health, refresh } = useBackendHealth();
  const [showDetails, setShowDetails] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

  if (health === "ok") return null;

  const restart = async () => {
    setRestarting(true);
    setRestartError(null);
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
        setTimeout(refresh, 1500);
        setTimeout(() => setShowDetails(false), 1200);
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
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--status-error)", flexShrink: 0 }} />
      <span style={{ fontWeight: 600, color: "var(--status-error)" }}>{t("diagnostics.error")}</span>
      <span style={{ color: "var(--text-muted)" }}>{t("diagnostics.bannerHint")}</span>
      <button type="button" onClick={refresh} style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: "auto", padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 11, cursor: "pointer" }}>
        <RefreshCw size={10} aria-hidden="true" />
        {t("diagnostics.refresh")}
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
      {showDetails && (
        <div style={{ position: "absolute", top: "100%", right: 10, zIndex: 1100, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-card)", boxShadow: "var(--shadow-pop)" }}>
          <BackendDiagnosticsBody />
        </div>
      )}
    </div>
  );
}

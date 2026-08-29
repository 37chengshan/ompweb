"use client";

import { useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { Activity, ExternalLink, RefreshCw, RotateCcw } from "lucide-react";

export interface DiagnosticsData {
  server: { node: string; platform: string; arch: string; uptimeSeconds: number };
  omp: { installed: boolean; path: string | null; version: string | null };
  proxy: { config: { mode: string; url?: string }; effective: string | null };
  rpc: { activeSessions: number };
  web: { port: string; url: string };
}

export type BackendHealth = "ok" | "warn" | "error";

/** Overall health: everything green unless omp is missing or unreachable. */
export function healthOf(d: DiagnosticsData): BackendHealth {
  if (!d.omp.installed) return "error";
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
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
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
          <Row label={t("diagnostics.rpc")} ok={diag.rpc.activeSessions > 0} detail={`${diag.rpc.activeSessions} ${t("diagnostics.sessions")}`} />
          <Row label={t("diagnostics.server")} ok detail={`${diag.server.platform}/${diag.server.arch} · node ${diag.server.node}`} />
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
          {(!diag.omp.installed || diag.rpc.activeSessions === 0) && (
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
 * Top-left status button (next to the logo): a colored health dot that opens
 * the diagnostics panel on click. Polls /api/diagnostics every 30s.
 */
export function BackendStatusButton() {
  const { t } = useI18n();
  const [health, setHealth] = useState<BackendHealth>("ok");
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      void fetch("/api/diagnostics")
        .then((res) => (res.ok ? res.json() as Promise<DiagnosticsData> : null))
        .then((data) => {
          if (!cancelled && data) setHealth(healthOf(data));
        })
        .catch(() => {
          if (!cancelled) setHealth("error");
        });
    };
    check();
    const timer = setInterval(check, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

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
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, padding: 0, border: "none", borderRadius: "var(--radius-control)", background: open ? "var(--bg-selected)" : "transparent", color: "var(--text-dim)", cursor: "pointer", position: "relative" }}
      >
        <Activity size={13} strokeWidth={2} aria-hidden="true" />
        <span aria-hidden="true" style={{ position: "absolute", right: 3, bottom: 3, width: 6, height: 6, borderRadius: "50%", background: color, border: "1.5px solid var(--bg-panel)" }} />
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

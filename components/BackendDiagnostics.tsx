"use client";

import { useEffect, useState, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import { Activity, RefreshCw } from "lucide-react";

interface Diagnostics {
  server: { node: string; platform: string; arch: string; uptimeSeconds: number };
  omp: { installed: boolean; path: string | null; version: string | null };
  proxy: { config: { mode: string; url?: string }; effective: string | null };
  rpc: { activeSessions: number };
}

function Row({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, lineHeight: 1.5 }}>
      <span
        aria-hidden="true"
        style={{ width: 8, height: 8, borderRadius: "50%", background: ok ? "var(--status-success)" : "var(--status-error)", flexShrink: 0 }}
      />
      <span style={{ color: "var(--text-muted)", minWidth: 90, flexShrink: 0 }}>{label}</span>
      <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {detail}
      </code>
    </div>
  );
}

/** Backend service diagnostics: omp runtime, proxy, server, RPC sessions. */
export function BackendDiagnostics() {
  const { t } = useI18n();
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    void fetch("/api/diagnostics")
      .then((res) => (res.ok ? res.json() as Promise<Diagnostics> : null))
      .then((data) => {
        if (data) setDiag(data);
        else setError("HTTP " + "failed");
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 520 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Activity size={13} style={{ color: "var(--accent)" }} aria-hidden="true" />
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{t("diagnostics.title")}</span>
        <button
          type="button"
          onClick={() => refresh()}
          aria-label={t("diagnostics.refresh")}
          title={t("diagnostics.refresh")}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, padding: 0, border: "none", borderRadius: 6, background: "transparent", color: "var(--text-dim)", cursor: "pointer" }}
        >
          <RefreshCw size={12} aria-hidden="true" />
        </button>
      </div>
      {error && (
        <div style={{ fontSize: 12, color: "var(--status-error)" }}>{t("diagnostics.error")}: {error}</div>
      )}
      {diag && (
        <>
          <Row label={t("diagnostics.omp")} ok={diag.omp.installed} detail={diag.omp.installed ? `${diag.omp.version ?? "?"} · ${diag.omp.path ?? ""}` : t("diagnostics.ompMissing")} />
          <Row label={t("diagnostics.proxy")} ok={Boolean(diag.proxy.effective)} detail={diag.proxy.effective ?? t("diagnostics.proxyOff")} />
          <Row label={t("diagnostics.rpc")} ok={diag.rpc.activeSessions > 0} detail={`${diag.rpc.activeSessions} ${t("diagnostics.sessions")}`} />
          <Row label={t("diagnostics.server")} ok detail={`${diag.server.platform}/${diag.server.arch} · node ${diag.server.node} · ${Math.floor(diag.server.uptimeSeconds / 60)}m`} />
        </>
      )}
    </div>
  );
}
"use client";

import { useEffect, useState, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import { Network } from "lucide-react";

interface ProxyState {
  config: { mode: "auto" | "manual" | "off"; url?: string };
  detection: {
    candidates: Array<{ url: string; source: string }>;
    recommended: string | null;
    manualReachable: boolean;
  };
  effective: string | null;
}

const SELECT_STYLE: React.CSSProperties = {
  background: "var(--bg)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-control)",
  padding: "6px 10px",
  fontSize: 13,
  fontFamily: "inherit",
};

/**
 * Network proxy settings: auto-detect (system proxy / local ports), manual
 * URL, or off. Applies to omp child processes and the GitHub client — no TUN
 * mode required.
 */
export function NetworkProxyConfig() {
  const { t } = useI18n();
  const [state, setState] = useState<ProxyState | null>(null);
  const [mode, setMode] = useState<"auto" | "manual" | "off">("auto");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const refresh = useCallback(() => {
    void fetch("/api/proxy")
      .then((res) => (res.ok ? res.json() as Promise<ProxyState> : null))
      .then((data) => {
        if (!data) return;
        setState(data);
        setMode(data.config.mode);
        setUrl(data.config.url ?? "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/proxy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, url: url.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({})) as ProxyState & { error?: string };
      if (!res.ok) {
        window.alert(data.error ?? "Failed to save proxy config");
        return;
      }
      setState(data);
      setSaved(true);
    } catch {
      window.alert("Failed to save proxy config");
    } finally {
      setSaving(false);
    }
  }, [mode, url]);

  const candidates = state?.detection.candidates ?? [];
  const effective = state?.effective ?? null;

  return (
    <div style={{ marginTop: 12, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
      <h4 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px", color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
        <Network size={13} aria-hidden="true" />
        {t("proxy.title")}
      </h4>
      <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--text-muted)" }}>
        {t("proxy.description")}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 520 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select
            style={SELECT_STYLE}
            value={mode}
            onChange={(e) => setMode(e.target.value as "auto" | "manual" | "off")}
            aria-label={t("proxy.mode")}
          >
            <option value="auto" style={{ background: "var(--bg)" }}>{t("proxy.modeAuto")}</option>
            <option value="manual" style={{ background: "var(--bg)" }}>{t("proxy.modeManual")}</option>
            <option value="off" style={{ background: "var(--bg)" }}>{t("proxy.modeOff")}</option>
          </select>
          {mode === "manual" && (
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://127.0.0.1:7890"
              aria-label={t("proxy.url")}
              style={{
                ...SELECT_STYLE,
                flex: 1,
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                outline: "none",
              }}
            />
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || (mode === "manual" && !url.trim())}
            style={{
              padding: "6px 14px",
              borderRadius: "var(--radius-control)",
              background: "var(--accent)",
              color: "var(--on-accent)",
              border: "none",
              fontSize: 12,
              fontWeight: 600,
              cursor: saving ? "default" : "pointer",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? t("proxy.saving") : saved ? t("proxy.saved") : t("proxy.save")}
          </button>
        </div>

        {candidates.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>{t("proxy.detected")}</div>
            {candidates.map((c, i) => (
              <div key={i} style={{ fontFamily: "var(--font-mono)" }}>
                {c.url} <span style={{ color: "var(--text-dim)" }}>({c.source})</span>
              </div>
            ))}
          </div>
        )}
        {effective && (
          <div style={{ fontSize: 11, color: "var(--status-success)", fontFamily: "var(--font-mono)" }}>
            ✓ {t("proxy.effective")}: {effective}
          </div>
        )}
      </div>
    </div>
  );
}
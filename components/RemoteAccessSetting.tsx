"use client";

import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, RefreshCw, ShieldOff, Smartphone, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { PairingConfig } from "@/lib/remote-pairing";
import type { PairedDevice } from "@/lib/remote-pairing";
import { Check, Field } from "./ui/field";

interface DevicesResponse {
  devices: Array<PairedDevice & { online: boolean }>;
  config: PairingConfig;
}

interface TokenResponse {
  token: string;
  expiresAt: number;
  qrData: string;
  phoneUrl: string;
  desktopUrl: string;
}

const NUM_FIELDS: Array<{ key: keyof PairingConfig; label: string; min?: number; step?: number }> = [
  { key: "tokenTtlMs", label: "tokenTtlMs", min: 30_000, step: 30_000 },
  { key: "offlineAfterMs", label: "offlineAfterMs", min: 5_000, step: 5_000 },
  { key: "maxDevices", label: "maxDevices", min: 1, step: 1 },
  { key: "idleExpireMs", label: "idleExpireMs", min: 60_000, step: 60_000 },
];

export function RemoteAccessSetting() {
  const { t } = useI18n();
  const isWindows = typeof navigator !== "undefined" && /Win/i.test(navigator.userAgent);
  const port = typeof window !== "undefined" ? (window.location.port || "30179") : "30179";
  const firewallCommand = `netsh advfirewall firewall add rule name="OmpWeb-${port}" dir=in action=allow protocol=TCP localport=${port}`;
  const [data, setData] = useState<DevicesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<TokenResponse | null>(null);
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<{
    port: string;
    hostname: string | null;
    physicalAddresses: Array<{ name: string; address: string }>;
    virtualAddresses: Array<{ name: string; address: string }>;
    platform: string;
    firewallRuleExists: boolean | null;
  } | null>(null);

  // Fetch reachability diagnostics alongside the QR so the user can see at a
  // glance which address the phone must reach and whether Windows needs a
  // firewall rule.
  useEffect(() => {
    if (!qr) return;
    fetch("/api/pair/diagnostics")
      .then((res) => (res.ok ? res.json() as Promise<typeof diagnostics> : null))
      .then((d) => setDiagnostics(d))
      .catch(() => undefined);
  }, [qr]);


  const refresh = useCallback(() => {
    fetch("/api/pair/devices")
      .then((res) => (res.ok ? res.json() as Promise<DevicesResponse> : null))
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch(() => setError("network"));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const issueToken = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/pair/token", { method: "POST" });
      if (!res.ok) throw new Error();
      setQr((await res.json()) as TokenResponse);
    } catch {
      setError("network");
    } finally {
      setBusy(false);
    }
  };

  const updateConfig = async (patch: Partial<PairingConfig>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/pair/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as { config: PairingConfig };
      setData((prev) => (prev ? { ...prev, config: body.config } : prev));
    } catch {
      setError("network");
    } finally {
      setBusy(false);
    }
  };

  const revokeDevice = async (id: string) => {
    await fetch(`/api/pair/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
    refresh();
  };

  const revokeAll = async () => {
    await fetch("/api/pair/revoke-all", { method: "POST" });
    setQr(null);
    refresh();
  };

  const startTunnel = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/pair/tunnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port: typeof window !== "undefined" ? Number(window.location.port || 80) : undefined }),
      });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "tunnel_failed");
      setTunnelUrl(body.url ?? null);
    } catch {
      setError("tunnel");
    } finally {
      setBusy(false);
    }
  };

  const config = data?.config;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{t("settingsConfig.remoteAccess")}</h3>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>{t("settingsConfig.remoteAccessDesc")}</p>
      </div>

      {/* Pairing state / QR */}
      <section style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Smartphone size={16} strokeWidth={1.8} style={{ color: "var(--accent)" }} aria-hidden="true" />
            <span style={{ fontSize: 13, fontWeight: 600 }}>{t("settingsConfig.pairedDevices")}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={issueToken} disabled={busy} className="btn-secondary" style={{ height: 30, padding: "0 12px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text)", fontSize: 12, cursor: "pointer" }}>
              {t("settingsConfig.showPairingQr")}
            </button>
            <button type="button" onClick={revokeAll} disabled={busy} className="btn-secondary" style={{ height: 30, padding: "0 12px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--status-error)", fontSize: 12, cursor: "pointer" }}>
              {t("settingsConfig.revokeAll")}
            </button>
          </div>
        </div>

        {qr && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--bg)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {t("settingsConfig.qrExpires", { minutes: Math.max(1, Math.round((qr.expiresAt - Date.now()) / 60_000)) })}
              </span>
              <button type="button" onClick={() => setQr(null)} aria-label={t("chatWindow.close")} style={{ border: "none", background: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2 }}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <QRCodeSVG value={qr.qrData} size={200} level="M" />
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
              <code style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-muted)", wordBreak: "break-all", maxWidth: "100%" }}>{qr.phoneUrl}</code>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(qr.phoneUrl).catch(() => undefined)}
                aria-label={t("appShell.copyLink")}
                style={{ border: "none", background: "none", color: "var(--accent)", cursor: "pointer", padding: 2, display: "inline-flex" }}
              >
                <Copy size={14} aria-hidden="true" />
              </button>
            </div>
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
              {t("settingsConfig.qrHint")} <RefreshCw size={11} style={{ display: "inline", verticalAlign: -1 }} aria-hidden="true" /> {t("settingsConfig.qrRefreshHint")}
            </span>

            {/* Reachability diagnostics: which address/port the phone must
                reach, and (Windows) whether a firewall rule exists. */}
            {diagnostics && (() => {
              const lanIps = diagnostics.physicalAddresses.length > 0
                ? diagnostics.physicalAddresses
                : diagnostics.virtualAddresses;
              const loopbackBound = Boolean(diagnostics.hostname && /^(127\.|localhost|::1)/i.test(diagnostics.hostname));
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-subtle)", fontSize: 11, color: "var(--text-muted)" }}>
                  <span>{t("settingsConfig.pairDiagnostics")}</span>
                  {loopbackBound && (
                    <span style={{ color: "var(--status-error)" }}>{t("settingsConfig.pairLoopbackWarning")}</span>
                  )}
                  {lanIps.length === 0 ? (
                    <span style={{ color: "var(--status-warning)" }}>{t("settingsConfig.pairNoLanIp")}</span>
                  ) : (
                    <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {lanIps.map(({ address }) => (
                        <code
                          key={address}
                          style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--accent)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, padding: "2px 6px", cursor: "pointer" }}
                          onClick={() => navigator.clipboard?.writeText(`http://${address}:${diagnostics.port}`).catch(() => undefined)}
                          title={t("appShell.copyLink")}
                        >
                          http://{address}:{diagnostics.port}
                        </code>
                      ))}
                    </span>
                  )}
                  <span>{t("settingsConfig.pairLanHint")}</span>
                  {diagnostics.platform === "win32" && (
                    <span style={{ color: diagnostics.firewallRuleExists ? "var(--status-ok, #2e9e5b)" : "var(--status-error)" }}>
                      {diagnostics.firewallRuleExists ? t("settingsConfig.firewallRuleOk") : t("settingsConfig.firewallRuleMissing")}
                    </span>
                  )}
                </div>
              );
            })()}

            {isWindows && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-subtle)", fontSize: 11, color: "var(--text-muted)" }}>
                <span>{t("settingsConfig.firewallHint")}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <code style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 10.5, wordBreak: "break-all", color: "var(--text)" }}>{firewallCommand}</code>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(firewallCommand).catch(() => undefined)}
                    aria-label={t("appShell.copyCommand")}
                    style={{ border: "none", background: "none", color: "var(--accent)", cursor: "pointer", display: "inline-flex", padding: 2 }}
                  >
                    <Copy size={13} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tunnelUrl && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
            <span style={{ color: "var(--text-muted)" }}>{t("settingsConfig.tunnelUrl")}</span>
            <code style={{ fontFamily: "var(--font-mono)", color: "var(--accent)", wordBreak: "break-all" }}>{tunnelUrl}</code>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(tunnelUrl).catch(() => undefined)}
              aria-label={t("appShell.copyLink")}
              style={{ border: "none", background: "none", color: "var(--accent)", cursor: "pointer", display: "inline-flex" }}
            >
              <Copy size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Device list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(data?.devices.length ?? 0) === 0 ? (
            <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("settingsConfig.noDevices")}</span>
          ) : (
            data?.devices.map((device) => (
              <div key={device.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)" }}>
                <span
                  aria-hidden="true"
                  style={{ width: 8, height: 8, borderRadius: "50%", background: device.online ? "var(--status-ok, #2e9e5b)" : "var(--text-dim)", flexShrink: 0 }}
                />
                <span style={{ fontSize: 12, fontWeight: 500 }}>{device.name}</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                  {new Date(device.lastActiveAt).toLocaleString()}
                </span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={() => revokeDevice(device.id)}
                  style={{ border: "none", background: "none", color: "var(--status-error)", cursor: "pointer", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  <ShieldOff size={12} aria-hidden="true" />
                  {t("settingsConfig.revoke")}
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Config fields */}
      {config && (
        <section style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{t("settingsConfig.remoteBehavior")}</span>
          <Check
            checked={config.requirePairingForLan}
            onChange={(v) => updateConfig({ requirePairingForLan: v })}
            label={t("settingsConfig.requirePairingForLan")}
            disabled={busy}
          />
          <span style={{ fontSize: 11, color: "var(--text-dim)", marginTop: -6 }}>{t("settingsConfig.requirePairingForLanDesc")}</span>
          <Check
            checked={config.autoTunnel}
            onChange={(v) => updateConfig({ autoTunnel: v })}
            label={t("settingsConfig.autoTunnel")}
            disabled={busy}
          />
          <span style={{ fontSize: 11, color: "var(--text-dim)", marginTop: -6 }}>{t("settingsConfig.autoTunnelDesc")}</span>
          <Check
            checked={config.mobileEnterToSend}
            onChange={(v) => updateConfig({ mobileEnterToSend: v })}
            label={t("settingsConfig.mobileEnterToSend")}
            disabled={busy}
          />
          <span style={{ fontSize: 11, color: "var(--text-dim)", marginTop: -6 }}>{t("settingsConfig.mobileEnterToSendDesc")}</span>
          {NUM_FIELDS.map(({ key, min, step }) => (
            <Field key={key} label={t(`settingsConfig.${key}`)} hint={String(config[key])}>
              <input
                type="number"
                min={min}
                step={step}
                defaultValue={Number(config[key])}
                onBlur={(e) => {
                  const value = Number(e.target.value);
                  if (Number.isFinite(value) && value !== Number(config[key])) {
                    updateConfig({ [key]: value } as Partial<PairingConfig>);
                  }
                }}
                style={{ width: "100%", padding: "6px 8px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12 }}
              />
            </Field>
          ))}
          <Field label={t("settingsConfig.cookieName")} hint={config.cookieName}>
            <input
              type="text"
              defaultValue={config.cookieName}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value && value !== config.cookieName && /^[A-Za-z0-9_-]{1,64}$/.test(value)) {
                  updateConfig({ cookieName: value });
                }
              }}
              style={{ width: "100%", padding: "6px 8px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12 }}
            />
          </Field>
          <Field label={t("settingsConfig.publicUrl")} hint={config.publicUrl ?? t("settingsConfig.publicUrlHint")}>
            <input
              type="text"
              defaultValue={config.publicUrl ?? ""}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value !== (config.publicUrl ?? "")) {
                  updateConfig({ publicUrl: value || undefined });
                }
              }}
              placeholder="https://example.com"
              style={{ width: "100%", padding: "6px 8px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12 }}
            />
          </Field>
          <div>
            <button type="button" onClick={startTunnel} disabled={busy} className="btn-secondary" style={{ height: 30, padding: "0 12px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text)", fontSize: 12, cursor: "pointer" }}>
              {t("settingsConfig.startTunnel")}
            </button>
          </div>
        </section>
      )}

      {error && (
        <div style={{ fontSize: 12, color: "var(--status-error)" }}>
          {error === "tunnel" ? t("settingsConfig.tunnelFailed") : t("settingsConfig.saveFailed")}
        </div>
      )}
    </div>
  );
}

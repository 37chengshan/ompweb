"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, Clipboard, Download, LoaderCircle, MonitorCog, RefreshCw, ShieldCheck, Terminal, X } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { useI18n } from "@/lib/i18n";
import { NetworkProxyConfig } from "./NetworkProxyConfig";
import { Dialog, DialogContent, DialogTitle } from "./ui/primitives";

type Platform = "darwin" | "linux" | "win32";

type Diagnostics = {
  omp: { installed: boolean; path: string | null; version: string | null };
  server: { platform: string; arch: string };
};

type DesktopBridge = {
  isDesktop?: boolean;
  getAutoLaunch?: () => Promise<{ supported?: boolean; enabled?: boolean }>;
  setAutoLaunch?: (enabled: boolean) => Promise<{ supported?: boolean; enabled?: boolean }>;
};

const PLATFORMS: Array<{ id: Platform; label: string }> = [
  { id: "darwin", label: "macOS" },
  { id: "win32", label: "Windows" },
  { id: "linux", label: "Linux" },
];

const INSTALL_COMMANDS: Record<Platform, { command: string; alternative?: string }> = {
  darwin: {
    command: "curl -fsSL https://omp.sh/install | sh",
    alternative: "brew install can1357/tap/omp",
  },
  linux: {
    command: "curl -fsSL https://omp.sh/install | sh",
  },
  win32: {
    command: "irm https://omp.sh/install.ps1 | iex",
  },
};

function supportedPlatform(value: string | undefined): Platform {
  return value === "darwin" || value === "linux" || value === "win32" ? value : "darwin";
}

/**
 * First-run recovery when the web shell is installed before its local OMP
 * runtime. The UI only presents copyable commands; it never downloads or runs
 * an installer on the user's behalf. That keeps the privilege boundary clear
 * while giving each desktop platform a dependency-free route.
 */
export function OmpSetupWizard({ open, onOpenChange, onDetected }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDetected?: () => void;
}) {
  const { t } = useI18n();
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>("darwin");
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [autoLaunchSupported, setAutoLaunchSupported] = useState(false);
  const [savingAutoLaunch, setSavingAutoLaunch] = useState(false);

  const text = useCallback((key: string, fallback: string) => {
    const translated = t(key);
    return translated === key ? fallback : translated;
  }, [t]);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch("/api/diagnostics", { cache: "no-store" });
      const data = response.ok ? await response.json() as Diagnostics : null;
      if (!data) return;
      setDiagnostics(data);
      setSelectedPlatform(supportedPlatform(data.server.platform));
      if (data.omp.installed) {
        onDetected?.();
      }
    } finally {
      setChecking(false);
    }
  }, [onDetected]);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const bridge = (window as Window & { piDesktop?: DesktopBridge }).piDesktop;
    if (!bridge?.isDesktop || !bridge.getAutoLaunch) return;
    void bridge.getAutoLaunch().then((result) => {
      setAutoLaunchSupported(Boolean(result.supported));
      setAutoLaunch(Boolean(result.enabled));
    }).catch(() => setAutoLaunchSupported(false));
  }, [open, refresh]);

  const command = useMemo(() => INSTALL_COMMANDS[selectedPlatform], [selectedPlatform]);
  const isInstalled = Boolean(diagnostics?.omp.installed);

  const copyCommand = useCallback((value: string) => {
    void copyText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }).catch(() => setCopied(false));
  }, []);

  const updateAutoLaunch = useCallback(async (enabled: boolean) => {
    const bridge = (window as Window & { piDesktop?: DesktopBridge }).piDesktop;
    if (!bridge?.setAutoLaunch) return;
    setSavingAutoLaunch(true);
    try {
      const result = await bridge.setAutoLaunch(enabled);
      if (result.supported) setAutoLaunch(Boolean(result.enabled));
    } finally {
      setSavingAutoLaunch(false);
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent ariaLabel={text("ompSetup.title", "Set up OMP runtime")} style={{ width: "min(92vw, 680px)", padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "22px 24px 18px", background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 16%, var(--bg-panel)), var(--bg-panel))", borderBottom: "1px solid var(--border)", position: "relative" }}>
          <button type="button" onClick={() => onOpenChange(false)} aria-label={text("appShell.dismiss", "Dismiss")} style={{ position: "absolute", right: 14, top: 14, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "none", borderRadius: 7, background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}>
            <X size={16} aria-hidden="true" />
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--accent)", marginBottom: 8 }}>
            <span style={{ width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 10, background: "color-mix(in srgb, var(--accent) 16%, transparent)" }}><Download size={17} aria-hidden="true" /></span>
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 700, letterSpacing: ".08em" }}>LOCAL RUNTIME</span>
          </div>
          <DialogTitle style={{ marginBottom: 6 }}>{isInstalled ? text("ompSetup.detectedTitle", "OMP is ready") : text("ompSetup.title", "Set up OMP runtime")}</DialogTitle>
          <p style={{ margin: 0, maxWidth: 550, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.55 }}>
            {isInstalled
              ? text("ompSetup.detectedBody", "OMP is available to this app. You can start a new AI session now.")
              : text("ompSetup.intro", "OMP runs locally. The recommended installer downloads the correct standalone binary, so Node and Bun are not required.")}
          </p>
        </div>

        <div style={{ padding: "18px 24px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", borderRadius: "var(--radius-control)", background: isInstalled ? "color-mix(in srgb, var(--status-success) 12%, var(--bg-subtle))" : "color-mix(in srgb, var(--status-warning) 12%, var(--bg-subtle))", border: `1px solid ${isInstalled ? "color-mix(in srgb, var(--status-success) 35%, var(--border))" : "color-mix(in srgb, var(--status-warning) 35%, var(--border))"}` }}>
            {isInstalled ? <Check size={16} color="var(--status-success)" aria-hidden="true" /> : <CircleAlert size={16} color="var(--status-warning)" aria-hidden="true" />}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 650 }}>{isInstalled ? text("ompSetup.detected", "Runtime detected") : text("ompSetup.missing", "Runtime not detected")}</div>
              <div style={{ marginTop: 2, fontSize: 11.5, color: "var(--text-muted)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{isInstalled ? `${diagnostics?.omp.version ?? "omp"} · ${diagnostics?.omp.path ?? ""}` : text("ompSetup.refreshHint", "Install it, reopen your terminal, then verify here.")}</div>
            </div>
            <button type="button" onClick={() => void refresh()} disabled={checking} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", fontSize: 11, cursor: checking ? "wait" : "pointer" }}>
              {checking ? <LoaderCircle size={12} className="spin" aria-hidden="true" /> : <RefreshCw size={12} aria-hidden="true" />} {text("ompSetup.verify", "Verify")}
            </button>
          </div>

          {!isInstalled && <>
            <div>
              <div style={{ fontSize: 12, fontWeight: 650, marginBottom: 8 }}>{text("ompSetup.choosePlatform", "Choose your platform")}</div>
              <div role="tablist" aria-label={text("ompSetup.choosePlatform", "Choose your platform")} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {PLATFORMS.map(({ id, label }) => (
                  <button key={id} type="button" role="tab" aria-selected={selectedPlatform === id} onClick={() => setSelectedPlatform(id)} style={{ padding: "6px 10px", borderRadius: 7, border: "1px solid var(--border)", background: selectedPlatform === id ? "var(--bg-selected)" : "var(--bg)", color: selectedPlatform === id ? "var(--text)" : "var(--text-muted)", cursor: "pointer", fontSize: 12, fontWeight: selectedPlatform === id ? 650 : 500 }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 650 }}><Terminal size={14} aria-hidden="true" /> {selectedPlatform === "win32" ? text("ompSetup.powershell", "Run in PowerShell") : text("ompSetup.terminal", "Run in Terminal")}</div>
              <div style={{ display: "flex", alignItems: "stretch", overflow: "hidden", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)" }}>
                <code style={{ flex: 1, padding: "10px 12px", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.5, overflowX: "auto", color: "var(--text)", whiteSpace: "nowrap" }}>{command.command}</code>
                <button type="button" onClick={() => copyCommand(command.command)} title={text("ompSetup.copy", "Copy command")} aria-label={text("ompSetup.copy", "Copy command")} style={{ width: 42, border: "none", borderLeft: "1px solid var(--border)", background: "var(--bg)", color: copied ? "var(--status-success)" : "var(--accent)", cursor: "pointer" }}>{copied ? <Check size={15} aria-hidden="true" /> : <Clipboard size={15} aria-hidden="true" />}</button>
              </div>
              <div style={{ display: "flex", gap: 7, alignItems: "flex-start", color: "var(--text-muted)", fontSize: 11.5, lineHeight: 1.5 }}><ShieldCheck size={14} aria-hidden="true" style={{ marginTop: 1, flexShrink: 0, color: "var(--accent)" }} />{text("ompSetup.noDeps", "No Node, Bun, or administrator setup is required for the recommended installer. It uses a standalone binary when Bun is unavailable.")}</div>
              {command.alternative && <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{text("ompSetup.alternative", "Alternative")}: <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{command.alternative}</code></div>}
            </div>

            <div style={{ padding: "12px", border: "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--bg-panel)", animation: "ui-fade-in var(--dur-med) var(--ease-out-warm) both" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 650, marginBottom: 2 }}><MonitorCog size={14} aria-hidden="true" /> {text("ompSetup.proxyTitle", "Behind a proxy?")}</div>
              <p style={{ margin: "0 0 4px", color: "var(--text-muted)", fontSize: 11.5, lineHeight: 1.5 }}>{text("ompSetup.proxyBody", "Set the proxy before installing. OmpWeb passes it to OMP and its own network requests; automatic detection also checks common local proxy ports.")}</p>
              <NetworkProxyConfig />
            </div>
          </>}

          {selectedPlatform === "win32" && autoLaunchSupported && (
            <label style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--bg-panel)", cursor: savingAutoLaunch ? "wait" : "pointer" }}>
              <input type="checkbox" checked={autoLaunch} disabled={savingAutoLaunch} onChange={(event) => void updateAutoLaunch(event.target.checked)} style={{ marginTop: 2, accentColor: "var(--accent)" }} />
              <span><span style={{ display: "block", fontSize: 12.5, fontWeight: 650 }}>{text("ompSetup.windowsStartup", "Open OmpWeb when I sign in")}</span><span style={{ display: "block", marginTop: 2, color: "var(--text-muted)", fontSize: 11.5, lineHeight: 1.45 }}>{text("ompSetup.windowsStartupBody", "The Windows installer also offers desktop and Start menu shortcuts. This option can be changed later.")}</span></span>
            </label>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

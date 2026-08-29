"use client";

import { useEffect, useState } from "react";
import { Download, RotateCcw, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type UpdateStatus = { status: string; version?: string; percent?: number; message?: string };

interface DesktopBridge {
  isDesktop?: boolean;
  updateDownload?: () => Promise<unknown>;
  updateApply?: () => Promise<unknown>;
  onUpdateStatus?: (cb: (s: UpdateStatus) => void) => () => void;
}

/**
 * Global update banner for the packaged desktop app: subscribes to the
 * native updater and walks available -> downloading (percent) -> downloaded
 * ("restart to apply"). Invisible in the browser/CLI modes.
 */
export function DesktopUpdateBanner() {
  const { t } = useI18n();
  const [state, setState] = useState<UpdateStatus>({ status: "idle" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const bridge = (window as { ompWebDesktop?: DesktopBridge }).ompWebDesktop;
    if (!bridge?.isDesktop || !bridge.onUpdateStatus) return;
    const unsubscribe = bridge.onUpdateStatus((status) => {
      setState(status);
      if (status.status === "available") setDismissed(false);
    });
    return unsubscribe;
  }, []);

  const bridge = (window as { ompWebDesktop?: DesktopBridge }).ompWebDesktop;
  if (!bridge?.isDesktop || dismissed) return null;

  if (state.status !== "available" && state.status !== "downloading" && state.status !== "downloaded") return null;

  const downloading = state.status === "downloading";
  const downloaded = state.status === "downloaded";

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 1000,
        maxWidth: 380,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-card)",
        background: "var(--bg-panel)",
        boxShadow: "var(--shadow-pop)",
        fontSize: 12,
        color: "var(--text)",
      }}
    >
      {downloaded ? (
        <RotateCcw size={14} style={{ color: "var(--accent)", flexShrink: 0 }} aria-hidden="true" />
      ) : (
        <Download size={14} style={{ color: "var(--accent)", flexShrink: 0 }} aria-hidden="true" />
      )}
      <span style={{ flex: 1, minWidth: 0, lineHeight: 1.4 }}>
        {downloaded
          ? t("desktopUpdate.ready", { version: state.version ?? "?" })
          : downloading
            ? `${t("desktopUpdate.downloading")} ${state.percent ?? 0}%`
            : t("desktopUpdate.available", { version: state.version ?? "?" })}
      </span>
      <button
        type="button"
        onClick={() => {
          if (downloaded) void bridge.updateApply?.();
          else void bridge.updateDownload?.();
        }}
        style={{
          flexShrink: 0,
          padding: "5px 10px",
          border: "1px solid var(--accent)",
          borderRadius: "var(--radius-control)",
          background: "var(--accent)",
          color: "var(--bg)",
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 600,
        }}
      >
        {downloaded ? t("desktopUpdate.restart") : downloading ? t("desktopUpdate.downloadingShort") : t("desktopUpdate.download")}
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t("chatWindow.close")}
        style={{ border: "none", background: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2, display: "inline-flex", flexShrink: 0 }}
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

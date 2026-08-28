"use client";

import { useI18n } from "@/lib/i18n";
import { Sparkles, X, ExternalLink } from "lucide-react";

/**
 * Minimal post-update notice: shown once after a version change, links to the
 * release notes, dismissible. Respects the settings toggle.
 */
export function UpdateNoticeDialog({ version, onClose }: { version: string; onClose: () => void }) {
  const { t } = useI18n();
  const releaseUrl = "https://github.com/37chengshan/ompweb/releases";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("updateNotice.title")}
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 1200,
        maxWidth: 340,
        background: "var(--bg-panel)",
        border: "1px solid color-mix(in srgb, var(--accent) 40%, var(--border))",
        borderRadius: "var(--radius-modal)",
        boxShadow: "var(--shadow-modal)",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            borderRadius: 8,
            background: "color-mix(in srgb, var(--accent) 14%, transparent)",
            color: "var(--accent)",
            flexShrink: 0,
          }}
        >
          <Sparkles size={14} aria-hidden="true" />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
            {t("updateNotice.title")}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.5 }}>
            {t("updateNotice.body", { version })}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("updateNotice.dismiss")}
          className="shell-toolbar-btn ui-focus-ring"
          style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0 }}
        >
          <X size={14} />
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
        <a
          href={releaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}
        >
          {t("updateNotice.releaseNotes")}
          <ExternalLink size={11} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
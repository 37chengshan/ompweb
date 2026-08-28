"use client";

import { useEffect, useState, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import { Sparkles, X, ExternalLink, LoaderCircle } from "lucide-react";
import type { UpdateRelease } from "@/app/api/app-update/releases/route";

function toReleaseNotes(body: string): string {
  // Collapse GitHub-style "## Changes" / bullet lists to compact text and
  // strip HTML/markdown link syntax so the dialog stays readable.
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      let l = line.replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "").replace(/`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
      if (/^[-*•]\s+/.test(l)) l = "• " + l.replace(/^[-*•]\s+/, "");
      return l;
    })
    .join("\n")
    .slice(0, 1400);
}

/**
 * Post-update notice: shows the GitHub release notes for the given version
 * inline (fetched through /api/app-update/releases, proxy-aware). History
 * items in Settings open this dialog for their own version. Falls back to
 * the Releases link when notes cannot be fetched.
 */
export function UpdateNoticeDialog({ version, onClose }: { version: string; onClose: () => void }) {
  const { t } = useI18n();
  const [notes, setNotes] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const releaseUrl = "https://github.com/37chengshan/ompweb/releases/tag/v" + version.replace(/^v/, "");

  useEffect(() => {
    let cancelled = false;
    setNotes(null);
    setError(false);
    void fetch("/api/app-update/releases")
      .then((res) => (res.ok ? res.json() as Promise<{ releases: UpdateRelease[] }> : null))
      .then((data) => {
        if (cancelled) return;
        const target = "v" + version.replace(/^v/, "");
        const rel = data?.releases.find((r) => r.tagName === target) ?? data?.releases.find((r) => r.tagName.toLowerCase().includes(version.replace(/^v/, "").toLowerCase()));
        if (rel && rel.body.trim()) {
          setNotes(toReleaseNotes(rel.body));
        } else {
          setError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const openRelease = useCallback(() => {
    window.open(releaseUrl, "_blank", "noopener,noreferrer");
  }, [releaseUrl]);

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
        width: 360,
        maxWidth: "calc(100vw - 16px)",
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
            {t("updateNotice.title")} · {version}
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
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55 }}>
        {notes === null && !error && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <LoaderCircle size={11} className="animate-spin" aria-hidden="true" />
            {t("updateNotice.loading")}
          </span>
        )}
        {error && (
          <span>{t("updateNotice.noNotes")} </span>
        )}
        {notes !== null && (
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12, color: "var(--text)", maxHeight: 240, overflowY: "auto" }}>
            {notes}
          </pre>
        )}
        {error && (
          <a href={releaseUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 600, color: "var(--accent)", textDecoration: "none", fontSize: 12 }}>
            {t("updateNotice.releaseNotes")}
            <ExternalLink size={10} aria-hidden="true" />
          </a>
        )}
      </div>
      {notes !== null && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={openRelease} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            {t("updateNotice.viewOnGithub")}
            <ExternalLink size={10} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

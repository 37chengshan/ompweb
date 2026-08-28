"use client";

import { useEffect, useState, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import { FolderGit2, ExternalLink } from "lucide-react";
import type { GitHubRepoStatus } from "@/lib/github";

/**
 * Top-bar GitHub PR/CI panel for the active workspace: repo identity, open PR
 * list with per-PR check state, and a link to the repository. Empty/absent
 * state when the cwd is not a GitHub checkout.
 */
export function GitHubStatusPanel({ cwd }: { cwd: string | null }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<GitHubRepoStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!cwd) {
      setStatus(null);
      return;
    }
    setLoading(true);
    void fetch(`/api/github/status?cwd=${encodeURIComponent(cwd)}`)
      .then((res) => (res.ok ? res.json() as Promise<{ repo?: GitHubRepoStatus | null }> : null))
      .then((data) => setStatus(data?.repo ?? null))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, [cwd]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!cwd) {
    return (
      <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-dim)" }}>
        {t("githubPanel.noWorkspace")}
      </div>
    );
  }
  if (loading && !status) {
    return (
      <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-dim)" }}>
        {t("githubPanel.loading")}
      </div>
    );
  }
  if (!status) {
    return (
      <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-dim)" }}>
        {t("githubPanel.noRepo")}
      </div>
    );
  }

  const prCount = status.pulls.length;
  return (
    <div style={{ minWidth: 320, maxWidth: 420, padding: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px 6px" }}>
        <FolderGit2 size={14} style={{ color: "var(--accent)", flexShrink: 0 }} aria-hidden="true" />
        <span style={{ fontWeight: 700, fontSize: 12.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {status.owner}/{status.repo}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
          {prCount > 0 ? t("githubPanel.openPrs", { count: prCount }) : t("githubPanel.noPrs")}
        </span>
        <button
          type="button"
          onClick={() => window.open(status.url, "_blank", "noopener,noreferrer")}
          title={t("githubPanel.openRepo")}
          aria-label={t("githubPanel.openRepo")}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, padding: 0, border: "none", borderRadius: 6, background: "transparent", color: "var(--text-dim)", cursor: "pointer" }}
        >
          <ExternalLink size={13} aria-hidden="true" />
        </button>
      </div>

      {status.pulls.length === 0 && (
        <div style={{ padding: "4px 10px 10px", fontSize: 11.5, color: "var(--text-dim)" }}>
          {t("githubPanel.noOpenPrs")}
        </div>
      )}
      {status.pulls.map((pr) => {
        const state = pr.checkStatus?.state;
        const color = state === "failure" ? "var(--status-error)" : state === "pending" ? "var(--status-warning)" : state === "success" ? "var(--status-success)" : "var(--text-dim)";
        return (
          <button
            key={pr.number}
            type="button"
            onClick={() => window.open(`${status.url}/pull/${pr.number}`, "_blank", "noopener,noreferrer")}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 10px", border: "none", borderRadius: 7, background: "transparent", color: "var(--text)", cursor: "pointer", textAlign: "left", fontSize: 12, lineHeight: 1.35 }}
          >
            <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", color: "var(--text-dim)", fontSize: 11 }}>#{pr.number}</span>
            <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pr.title}</span>
            <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-dim)" }}>
              {pr.headRef} → {pr.baseRef}
            </span>
            <span aria-hidden="true" style={{ flexShrink: 0, width: 8, height: 8, borderRadius: "50%", background: color }} />
          </button>
        );
      })}
    </div>
  );
}
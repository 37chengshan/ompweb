"use client";

import { useCallback, useEffect, useState } from "react";
import {
  GitBranch,
  CheckCircle2,
  CircleAlert,
  CloudUpload,
  ExternalLink,
  FileDiff,
  FolderGit2,
  GitCommitHorizontal,
  GitPullRequest,
  RefreshCw,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { createOmpwebClient } from "@/lib/client";
import type { GitHubRepoStatus } from "@/lib/github";
import type { SlashCommandInfo } from "@/hooks/useAgentSession";

// Route 1 (doc 16): git domain calls go through the OmpWebClient facade
// (legacy-http adapter today; route 10 swaps the backing to the Rust host).
const client = createOmpwebClient("legacy-http");

type GitHubStatusPanelProps = { cwd: string | null; slashCommands?: SlashCommandInfo[]; onInsertCommand?: (command: string) => void };

function statusColor(state: string | undefined): string {
  if (state === "failure") return "var(--status-error)";
  if (state === "pending") return "var(--status-warning)";
  if (state === "success") return "var(--status-success)";
  return "var(--text-dim)";
}

/**
 * GitHub and local Git status for the active workspace. The header
 * and footer stay fixed while the status list scrolls, matching the compact
 * Codex-style workspace panel with explicit commit/push actions.
 */
export function GitHubStatusPanel({ cwd, slashCommands = [], onInsertCommand }: GitHubStatusPanelProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<GitHubRepoStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [action, setAction] = useState<"commit" | "push" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!actionError && !actionNotice) return;
    const timeout = window.setTimeout(() => {
      setActionError(null);
      setActionNotice(null);
    }, actionError ? 8000 : 4500);
    return () => window.clearTimeout(timeout);
  }, [actionError, actionNotice]);

  const refresh = useCallback((force = false) => {
    if (!cwd) {
      setStatus(null);
      setLoadError(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    void client.git.status(cwd, { refresh: force })
      .then((data) => {
        const repo = data.repo ?? null;
        setStatus(repo ? { ...repo, git: data.git ?? repo.git } : null);
      })
      .catch((error) => {
        setStatus(null);
        setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setLoading(false));
  }, [cwd]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runCommit = useCallback(async () => {
    if (!cwd || !commitMessage.trim()) return;
    setAction("commit");
    setActionError(null);
    setActionNotice(null);
    try {
      const data = await client.git.commit(cwd, commitMessage.trim());
      setCommitOpen(false);
      setCommitMessage("");
      setActionNotice(t("githubPanel.commitSuccess", { hash: data.hash || "" }));
      toast.success(t("githubPanel.commitSuccess", { hash: data.hash || "" }));
      refresh(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setAction(null);
    }
  }, [commitMessage, cwd, refresh, t]);

  const runPush = useCallback(async () => {
    if (!cwd) return;
    setAction("push");
    setActionError(null);
    setActionNotice(null);
    try {
      const data = await client.git.push(cwd);
      setActionNotice(t("githubPanel.pushSuccess", { branch: data.branch || "" }));
      toast.success(t("githubPanel.pushSuccess", { branch: data.branch || "" }));
      refresh(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setAction(null);
    }
  }, [cwd, refresh, t]);

  if (!cwd) {
    return <div className="github-status-empty">{t("githubPanel.noWorkspace")}</div>;
  }

  if (!status && loading) {
    return (
      <div className="github-status-shell" role="status">
        <div className="github-status-body github-status-empty">
          <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
          {t("githubPanel.loading")}
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="github-status-shell">
        <div className="github-status-body github-status-empty">
          <CircleAlert size={14} aria-hidden="true" />
          {loadError || t("githubPanel.noRepo")}
        </div>
        <div className="github-status-footer">
          <button type="button" className="github-status-action github-status-action-primary" onClick={() => refresh(true)} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : undefined} aria-hidden="true" />
            {t("githubPanel.refresh")}
          </button>
        </div>
      </div>
    );
  }

  const git = status.git;
  const files = git?.files ?? [];
  const ahead = git?.ahead ?? 0;
  const behind = git?.behind ?? 0;
  const hasChanges = files.length > 0;
  const prCount = status.pulls.length;

  return (
    <div className="github-status-shell">
      <div className="github-status-header">
        <div className="github-status-repo">
          <FolderGit2 size={16} aria-hidden="true" />
          <span title={status.owner + "/" + status.repo}>{status.owner}/{status.repo}</span>
        </div>
        <div className="github-status-header-actions">
          <button type="button" className="github-status-icon-button" onClick={() => refresh(true)} disabled={loading} title={t("githubPanel.refresh")} aria-label={t("githubPanel.refresh")}>
            <RefreshCw size={14} className={loading ? "animate-spin" : undefined} aria-hidden="true" />
          </button>
          <button type="button" className="github-status-icon-button" onClick={() => window.open(status.url, "_blank", "noopener,noreferrer")} title={t("githubPanel.openRepo")} aria-label={t("githubPanel.openRepo")}>
            <ExternalLink size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="github-status-body">
        {loadError && (
          <div className="github-status-error" role="alert">
            <CircleAlert size={14} aria-hidden="true" />
            <span>{loadError}</span>
          </div>
        )}

        <section className="github-status-section" aria-labelledby="github-local-status">
          <div className="github-status-section-title" id="github-local-status">
            <GitBranch size={14} aria-hidden="true" />
            {t("githubPanel.localStatus")}
          </div>
          <div className="github-status-branch-row">
            <span className="github-status-branch">{git?.branch || t("githubPanel.detached")}</span>
            {git?.upstream && <span className="github-status-upstream">↔ {git.upstream}</span>}
            <span className="github-status-sync">
              <span className={ahead ? "github-status-sync-ahead" : undefined}>↑ {ahead}</span>
              <span className={behind ? "github-status-sync-behind" : undefined}>↓ {behind}</span>
            </span>
          </div>
          <div className="github-status-change-summary">
            <FileDiff size={14} aria-hidden="true" />
            <span>{hasChanges ? t("githubPanel.changedFiles", { count: files.length }) : t("githubPanel.clean")}</span>
            {hasChanges && <span className="github-status-change-count">{files.length}</span>}
          </div>
        </section>

        {slashCommands.length > 0 && (
          <section className="github-status-section" aria-labelledby="github-shortcuts">
            <div className="github-status-section-title" id="github-shortcuts"><GitCommitHorizontal size={14} aria-hidden="true" />{t("githubPanel.shortcuts")}<span className="github-status-section-count">{slashCommands.length}</span></div>
            <div className="github-status-shortcuts">
              {slashCommands.slice(0, 12).map((command) => (
                <button key={command.name} type="button" className="github-status-shortcut" onClick={() => onInsertCommand?.(`/${command.name}`)} title={command.description || command.name}>
                  <code>/{command.name}</code><span>{command.description || t("githubPanel.noShortcutDescription")}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="github-status-section" aria-labelledby="github-pr-status">
          <div className="github-status-section-title" id="github-pr-status">
            <GitPullRequest size={14} aria-hidden="true" />
            {t("githubPanel.pullRequests")}
            <span className="github-status-section-count">{prCount}</span>
          </div>
          {status.pulls.length === 0 ? (
            <div className="github-status-muted">{t("githubPanel.noOpenPrs")}</div>
          ) : status.pulls.map((pr) => {
            const state = pr.checkStatus?.state;
            return (
              <button key={pr.number} type="button" className="github-status-pr" onClick={() => window.open(status.url + "/pull/" + pr.number, "_blank", "noopener,noreferrer")}>
                <span className="github-status-pr-number">#{pr.number}</span>
                <span className="github-status-pr-main">
                  <span className="github-status-pr-title">{pr.title}</span>
                  <span className="github-status-pr-refs">{pr.headRef} → {pr.baseRef}</span>
                </span>
                <span className="github-status-ci" title={state || t("githubPanel.ciUnknown")} style={{ color: statusColor(state) }}>
                  {state === "success" ? <CheckCircle2 size={14} aria-hidden="true" /> : <span className="github-status-ci-dot" aria-hidden="true" />}
                </span>
              </button>
            );
          })}
        </section>
      </div>
      {(actionError || actionNotice) && (
        <div className={actionError ? "github-status-action-error" : "github-status-action-notice"} role={actionError ? "alert" : "status"}>
          {actionError || actionNotice}
        </div>
      )}

      <div className="github-status-footer">
        <button type="button" className="github-status-action" onClick={() => { setActionError(null); setCommitOpen(true); }} disabled={!hasChanges || action !== null} title={t("githubPanel.commitHint")}>
          <GitCommitHorizontal size={14} aria-hidden="true" />
          {t("githubPanel.commit")}
          {hasChanges && <span className="github-status-action-badge">{files.length}</span>}
        </button>
        <button type="button" className="github-status-action" onClick={() => setPushOpen(true)} disabled={!git?.branch || action !== null} title={t("githubPanel.pushHint")}>
          {action === "push" ? <RefreshCw size={14} className="animate-spin" aria-hidden="true" /> : <CloudUpload size={14} aria-hidden="true" />}
          {action === "push" ? t("githubPanel.working") : t("githubPanel.push")}
          {ahead > 0 && <span className="github-status-action-badge">{ahead}</span>}
        </button>
        <button type="button" className="github-status-action github-status-action-primary" onClick={() => window.open(status.url + "/pulls/new", "_blank", "noopener,noreferrer")} title={t("githubPanel.createPr")}>
          <GitPullRequest size={14} aria-hidden="true" />
          {t("githubPanel.createPr")}
        </button>
      </div>

      <Dialog open={commitOpen} onOpenChange={setCommitOpen}>
        <DialogContent ariaLabel={t("githubPanel.commitDialogTitle")} style={{ width: "min(92vw, 460px)" }}>
          <DialogTitle>{t("githubPanel.commitDialogTitle")}</DialogTitle>
          <p style={{ margin: "0 0 12px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>{t("githubPanel.commitDialogHint", { count: files.length })}</p>
          <textarea
            autoFocus
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void runCommit(); } }}
            placeholder={t("githubPanel.commitPlaceholder")}
            maxLength={200}
            rows={3}
            style={{ width: "100%", resize: "vertical", padding: 10, color: "var(--text)", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", font: "inherit" }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button type="button" className="github-status-dialog-button" onClick={() => setCommitOpen(false)}>{t("githubPanel.cancel")}</button>
            <button type="button" className="github-status-dialog-button github-status-dialog-primary" onClick={() => void runCommit()} disabled={!commitMessage.trim() || action === "commit"}>
              {action === "commit" && <RefreshCw size={13} className="animate-spin" aria-hidden="true" />}
              {action === "commit" ? t("githubPanel.working") : t("githubPanel.commit")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={pushOpen} onOpenChange={setPushOpen}>
        <DialogContent ariaLabel={t("githubPanel.pushDialogTitle")} style={{ width: "min(92vw, 440px)" }}>
          <DialogTitle>{t("githubPanel.pushDialogTitle")}</DialogTitle>
          <p style={{ margin: "0 0 12px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>{t("githubPanel.pushDialogHint", { branch: git?.branch || "", count: ahead })}</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="github-status-dialog-button" onClick={() => setPushOpen(false)}>{t("githubPanel.cancel")}</button>
            <button type="button" className="github-status-dialog-button github-status-dialog-primary" onClick={() => { setPushOpen(false); void runPush(); }} disabled={action !== null}>
              {action === "push" && <RefreshCw size={13} className="animate-spin" aria-hidden="true" />}{t("githubPanel.push")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

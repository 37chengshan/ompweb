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

// Route 1 (doc 16): git domain calls go through the OmpWebClient facade
// (legacy-http adapter today; route 10 swaps the backing to the Rust host).
const client = createOmpwebClient("legacy-http");

type GitHubStatusPanelProps = { cwd: string | null };

function statusColor(state: string | undefined): string {
  if (state === "failure") return "var(--status-error)";
  if (state === "pending") return "var(--status-warning)";
  if (state === "success") return "var(--status-success)";
  return "var(--text-dim)";
}

function gitBranch(status: GitHubRepoStatus | null): string {
  return status?.git?.branch || "";
}

/**
 * GitHub and local Git status for the active workspace. The header
 * and footer stay fixed while the status list scrolls, matching the compact
 * Codex-style workspace panel with explicit commit/push actions.
 */
export function GitHubStatusPanel({ cwd }: GitHubStatusPanelProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<GitHubRepoStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionOpen, setActionOpen] = useState(false);
  const [actionMode, setActionMode] = useState<"commit" | "commit-push" | "push">("commit-push");
  const [commitMessage, setCommitMessage] = useState("");
  const [branches, setBranches] = useState<Array<{ name: string; current: boolean }>>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [confirmStep, setConfirmStep] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [prOpen, setPrOpen] = useState(false);
  const [prConfirmStep, setPrConfirmStep] = useState(false);
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [prBaseBranch, setPrBaseBranch] = useState("main");
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
        if (!repo) {
          setLoadError(
            data.reason === "workspace_not_allowed"
              ? t("githubPanel.workspaceNotAllowed")
              : data.reason === "not_github"
                ? t("githubPanel.noRepo")
                : null,
          );
        }
        void client.git.branches(cwd).then((items) => {
          setBranches(items);
          setSelectedBranch(items.find((item) => item.current)?.name ?? data.git?.branch ?? "");
        }).catch(() => setBranches([]));
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

  const openAction = useCallback((mode: "commit" | "commit-push" | "push") => {
    setActionError(null);
    setActionNotice(null);
    setConfirmStep(false);
    setActionMode(mode);
    setActionOpen(true);
  }, []);

  const executeAction = useCallback(async () => {
    if (!cwd || (actionMode !== "push" && !commitMessage.trim())) return;
    setConfirming(true);
    setActionError(null);
    setActionNotice(null);
    try {
      if (selectedBranch && selectedBranch !== gitBranch(status)) await client.git.checkout(cwd, selectedBranch);
      let commitHash = "";
      let pushedBranch = selectedBranch || gitBranch(status) || "";
      if (actionMode !== "push") {
        const commitData = await client.git.commit(cwd, commitMessage.trim());
        commitHash = commitData.hash || "";
      }
      if (actionMode === "commit-push" || actionMode === "push") {
        const pushData = await client.git.push(cwd);
        pushedBranch = pushData.branch || pushedBranch;
      }
      setActionOpen(false);
      setCommitMessage("");
      setConfirmStep(false);
      const notice = actionMode === "push"
        ? t("githubPanel.pushSuccess", { branch: pushedBranch })
        : actionMode === "commit-push"
          ? `${t("githubPanel.commitSuccess", { hash: commitHash })} · ${t("githubPanel.pushSuccess", { branch: pushedBranch })}`
          : t("githubPanel.commitSuccess", { hash: commitHash });
      setActionNotice(notice);
      toast.success(notice);
      refresh(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setConfirming(false);
    }
  }, [actionMode, commitMessage, cwd, refresh, selectedBranch, status, t]);

  const requestAction = useCallback(() => {
    if (!cwd || (actionMode !== "push" && !commitMessage.trim())) return;
    if (!confirmStep) {
      setConfirmStep(true);
      return;
    }
    void executeAction();
  }, [actionMode, commitMessage, confirmStep, cwd, executeAction]);

  const openPullRequest = useCallback(() => {
    const head = selectedBranch || gitBranch(status);
    setPrTitle(head ? `${head} → main` : "");
    setPrBody("");
    setPrBaseBranch(branches.some((branch) => branch.name === "main") ? "main" : branches.find((branch) => !branch.current)?.name || "main");
    setPrConfirmStep(false);
    setPrOpen(true);
  }, [branches, selectedBranch, status]);

  const requestPullRequest = useCallback(() => {
    if (!prTitle.trim() || !selectedBranch) return;
    if (!prConfirmStep) {
      setPrConfirmStep(true);
      return;
    }
    const query = new URLSearchParams({
      head: selectedBranch,
      base: prBaseBranch || "main",
      title: prTitle.trim(),
      body: prBody.trim(),
    });
    window.open(`${status?.url || "https://github.com"}/pulls/new?${query.toString()}`, "_blank", "noopener,noreferrer");
    setPrOpen(false);
    setPrConfirmStep(false);
    const notice = "已打开 Pull Request 创建页";
    setActionNotice(notice);
    toast.success(notice);
  }, [prBaseBranch, prBody, prConfirmStep, prTitle, selectedBranch, status?.url]);

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
        <button type="button" className="github-status-action" onClick={() => openAction("commit")} disabled={!hasChanges || confirming} title={t("githubPanel.commitHint")}>
          <GitCommitHorizontal size={14} aria-hidden="true" />
          {t("githubPanel.commit")}
          {hasChanges && <span className="github-status-action-badge">{files.length}</span>}
        </button>
        <button type="button" className="github-status-action" onClick={() => openAction(hasChanges ? "commit-push" : "push")} disabled={!git?.branch || confirming} title={t("githubPanel.pushHint")}>
          {confirming ? <RefreshCw size={14} className="animate-spin" aria-hidden="true" /> : <CloudUpload size={14} aria-hidden="true" />}
          {confirming ? t("githubPanel.working") : t("githubPanel.push")}
          {ahead > 0 && <span className="github-status-action-badge">{ahead}</span>}
        </button>
        <button type="button" className="github-status-action github-status-action-primary" onClick={openPullRequest} disabled={!git?.branch} title={t("githubPanel.createPr")}>
          <GitPullRequest size={14} aria-hidden="true" />
          {t("githubPanel.createPr")}
        </button>
      </div>

      <Dialog open={actionOpen} onOpenChange={(open) => { setActionOpen(open); if (!open) setConfirmStep(false); }}>
        <DialogContent ariaLabel={t("githubPanel.commitDialogTitle")} style={{ width: "min(92vw, 460px)" }}>
          <DialogTitle>{t("githubPanel.commitDialogTitle")}</DialogTitle>
          <p style={{ margin: "0 0 12px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
            {actionMode === "push"
              ? t("githubPanel.pushDialogHint", { branch: selectedBranch || gitBranch(status), count: ahead })
              : t("githubPanel.commitDialogHint", { count: files.length })}
          </p>
          {!confirmStep && (
            <label style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10, fontSize: 12, color: "var(--text-muted)" }}>
              操作
              <select value={actionMode} onChange={(event) => { setConfirmStep(false); setActionMode(event.target.value as typeof actionMode); }} style={{ padding: 8, border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-panel)", color: "var(--text)" }}>
                <option value="commit" disabled={!hasChanges}>提交</option>
                <option value="commit-push" disabled={!hasChanges || !git?.branch}>提交并推送</option>
                <option value="push" disabled={!git?.branch}>仅推送</option>
              </select>
            </label>
          )}
          {!confirmStep && branches.length > 0 && <label style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10, fontSize: 12, color: "var(--text-muted)" }}>分支<select value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)} style={{ padding: 8, border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-panel)", color: "var(--text)" }}>{branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}{branch.current ? "（当前）" : ""}</option>)}</select></label>}
          {!confirmStep && actionMode !== "push" && (
          <textarea
            autoFocus
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); requestAction(); } }}
            placeholder={t("githubPanel.commitPlaceholder")}
            maxLength={200}
            rows={3}
            style={{ width: "100%", resize: "vertical", padding: 10, color: "var(--text)", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", font: "inherit" }}
          />
          )}
          {confirmStep && (
            <div className="github-status-confirmation" role="status">
              <strong>请确认操作</strong>
              <span>操作：{actionMode === "commit-push" ? "提交并推送" : actionMode === "push" ? "仅推送" : "提交"}</span>
              <span>分支：{selectedBranch || gitBranch(status) || "未选择"}</span>
              {actionMode !== "push" && <span>提交信息：{commitMessage.trim()}</span>}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button type="button" className="github-status-dialog-button" onClick={() => confirmStep ? setConfirmStep(false) : setActionOpen(false)} disabled={confirming}>{confirmStep ? "返回修改" : t("githubPanel.cancel")}</button>
            <button type="button" className="github-status-dialog-button github-status-dialog-primary" onClick={requestAction} disabled={(actionMode !== "push" && !commitMessage.trim()) || confirming}>
              {confirming && <RefreshCw size={13} className="animate-spin" aria-hidden="true" />}
              {confirming ? t("githubPanel.working") : confirmStep ? "确认并执行" : "下一步"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={prOpen} onOpenChange={(open) => { setPrOpen(open); if (!open) setPrConfirmStep(false); }}>
        <DialogContent ariaLabel={t("githubPanel.createPr")} style={{ width: "min(92vw, 520px)" }}>
          <DialogTitle>{t("githubPanel.createPr")}</DialogTitle>
          {!prConfirmStep ? (
            <div style={{ display: "grid", gap: 10 }}>
              <label style={{ display: "grid", gap: 5, fontSize: 12, color: "var(--text-muted)" }}>
                源分支
                <select value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)} style={{ padding: 8, border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-panel)", color: "var(--text)" }}>
                  {branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}{branch.current ? "（当前）" : ""}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 5, fontSize: 12, color: "var(--text-muted)" }}>
                目标分支
                <select value={prBaseBranch} onChange={(event) => setPrBaseBranch(event.target.value)} style={{ padding: 8, border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-panel)", color: "var(--text)" }}>
                  {branches.length > 0 ? branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>) : <option value="main">main</option>}
                </select>
              </label>
              <label style={{ display: "grid", gap: 5, fontSize: 12, color: "var(--text-muted)" }}>
                标题
                <input value={prTitle} onChange={(event) => setPrTitle(event.target.value)} placeholder="Pull Request 标题" maxLength={200} style={{ padding: 9, border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-panel)", color: "var(--text)", font: "inherit" }} />
              </label>
              <label style={{ display: "grid", gap: 5, fontSize: 12, color: "var(--text-muted)" }}>
                描述
                <textarea value={prBody} onChange={(event) => setPrBody(event.target.value)} placeholder="描述本次变更（可选）" rows={5} maxLength={4000} style={{ width: "100%", resize: "vertical", padding: 9, border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-panel)", color: "var(--text)", font: "inherit" }} />
              </label>
            </div>
          ) : (
            <div className="github-status-confirmation" role="status">
              <strong>请确认创建 Pull Request</strong>
              <span>{selectedBranch} → {prBaseBranch || "main"}</span>
              <span>标题：{prTitle.trim()}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button type="button" className="github-status-dialog-button" onClick={() => prConfirmStep ? setPrConfirmStep(false) : setPrOpen(false)}>{prConfirmStep ? "返回修改" : t("githubPanel.cancel")}</button>
            <button type="button" className="github-status-dialog-button github-status-dialog-primary" onClick={requestPullRequest} disabled={!selectedBranch || !prTitle.trim()}>{prConfirmStep ? "确认并打开" : "下一步"}</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

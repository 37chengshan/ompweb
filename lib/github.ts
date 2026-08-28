/**
 * Read-only GitHub REST API helpers for PR/CI status. Public repos work
 * without a token (rate-limited); GITHUB_TOKEN / GH_TOKEN raise the quota and
 * unlock private repos. Nothing here writes to GitHub.
 */

export interface GitHubCheckStatus {
  /** Aggregate check-run conclusion for the PR head commit. */
  state: "success" | "failure" | "pending" | "neutral" | "unknown";
  total: number;
  completed: number;
}

export interface GitHubPull {
  number: number;
  title: string;
  state: "open" | "closed";
  headRef: string;
  baseRef: string;
  /** Head commit SHA (used for check-runs lookups). */
  headSha: string;
  updatedAt: string;
  checkStatus: GitHubCheckStatus | null;
}

export interface GitHubRepoStatus {
  owner: string;
  repo: string;
  url: string;
  pulls: GitHubPull[];
}

const API_BASE = "https://api.github.com";
const USER_AGENT = "ompweb/4.0.0";
const PER_PAGE = 20;

function authToken(): string | undefined {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = authToken();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function ghFetch<T>(path: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: headers(), signal: controller.signal });
    if (res.status === 404) return null;
    if (!res.ok) return null; // 401/403 (rate limit, private repo) → degrade silently
    return await res.json() as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const CHECK_STATE_ORDER: Record<string, number> = { failure: 0, pending: 1, neutral: 2, success: 3, unknown: 4 };

function aggregateCheckRuns(runs: Array<{ status?: string; conclusion?: string | null }>): GitHubCheckStatus {
  const total = runs.length;
  const completed = runs.filter((r) => r.status === "completed").length;
  let worst: "success" | "pending" | "neutral" | "failure" | "unknown" = "success";
  for (const run of runs) {
    if (run.status !== "completed") {
      if (CHECK_STATE_ORDER.pending < CHECK_STATE_ORDER[worst]) worst = "pending";
      continue;
    }
    const conclusion = run.conclusion ?? "neutral";
    const state = conclusion === "success" ? "success" : conclusion === "neutral" || conclusion === "skipped" ? "neutral" : conclusion === "cancelled" || conclusion === "timed_out" || conclusion === "failure" || conclusion === "startup_failure" ? "failure" : "neutral";
    if (CHECK_STATE_ORDER[state] < CHECK_STATE_ORDER[worst]) worst = state;
  }
  return { state: worst, total, completed };
}

/**
 * Open PRs plus the check-run state of each PR's head commit. Best effort:
 * any API failure degrades to an empty pull list rather than throwing.
 */
export async function getRepoStatus(owner: string, repo: string): Promise<GitHubRepoStatus> {
  const pullsRaw = await ghFetch<Array<{
    number: number;
    title: string;
    state: string;
    head: { ref: string; sha: string };
    base: { ref: string };
    updated_at: string;
  }>>(`/repos/${owner}/${repo}/pulls?state=open&per_page=${PER_PAGE}`);

  const pulls: GitHubPull[] = [];
  for (const pr of pullsRaw ?? []) {
    // check-runs for the head commit; PR-only status fallback is skipped to
    // keep the request count low (1 extra request per open PR).
    const runs = await ghFetch<{ check_runs?: Array<{ status?: string; conclusion?: string | null }> }>(
      `/repos/${owner}/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`,
    );
    pulls.push({
      number: pr.number,
      title: pr.title,
      state: pr.state === "open" ? "open" : "closed",
      headRef: pr.head.ref,
      baseRef: pr.base.ref,
      headSha: pr.head.sha,
      updatedAt: pr.updated_at,
      checkStatus: runs?.check_runs ? aggregateCheckRuns(runs.check_runs) : null,
    });
  }

  return { owner, repo, url: `https://github.com/${owner}/${repo}`, pulls };
}
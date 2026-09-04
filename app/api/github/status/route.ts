import { NextResponse } from "next/server";
import { resolveProject } from "@/lib/worktree";
import { resolveGitHubRepo } from "@/lib/git-remote";
import { getRepoStatus } from "@/lib/github";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { getGitStatus } from "@/lib/git-changes";
import { recordBackendError } from "@/lib/backend-errors";
import { hostClient, rustBackendActive } from "@/lib/omp/host-client";

export const dynamic = "force-dynamic";

// Short-TTL cache so the sidebar can poll without hammering GitHub's quota.
const CACHE_TTL_MS = 5 * 60 * 1000;
declare global {
  // eslint-disable-next-line no-var
  var __ompGithubStatusCache: Map<string, { data: unknown; expiresAt: number }> | undefined;
}
function getCache(): Map<string, { data: unknown; expiresAt: number }> {
  if (!globalThis.__ompGithubStatusCache) globalThis.__ompGithubStatusCache = new Map();
  return globalThis.__ompGithubStatusCache;
}

/**
 * GET /api/github/status?cwd=<dir>
 * GitHub identity of the checkout plus open-PR / check-run status.
 * Best effort: non-git or non-GitHub projects return { repo: null } with 200.
 */
export async function GET(req: Request) {
  const cwd = new URL(req.url).searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "Missing cwd", code: "missing_cwd" }, { status: 400 });
  const forceRefresh = new URL(req.url).searchParams.get("refresh") === "1";

  const cacheKey = cwd;
  const cached = getCache().get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return NextResponse.json(cached.data);

  try {
    const project = await resolveProject(cwd);
    // Only checkouts under the file allowlist may be probed (a bare path would
    // otherwise leak repo identity + PR/CI state for arbitrary local dirs).
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(project.projectRoot, allowedRoots)) {
      return NextResponse.json({ repo: null, pulls: [] });
    }
    const ref = await resolveGitHubRepo(project.projectRoot);
    if (!ref) {
      const data = { repo: null, pulls: [] };
      getCache().set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      return NextResponse.json(data);
    }
    // Doc 16 route 10: local git status runs on the host in Rust mode (the
    // GitHub API half — getRepoStatus — stays Node: it is HTTP over the
    // proxy, not git). Failure is a structured error, never a Node re-run.
    const gitPromise = rustBackendActive()
      ? hostClient.git.status([...allowedRoots], project.projectRoot).catch((error) => {
          recordBackendError("git_status_failed", error instanceof Error ? error.message : String(error));
          throw error;
        })
      : getGitStatus(project.projectRoot);
    const [gitStatus, status] = await Promise.all([gitPromise, getRepoStatus(ref.owner, ref.repo)]);
    const data = { repo: status, pulls: status.pulls, git: { branch: gitStatus.branch, upstream: gitStatus.upstream, ahead: gitStatus.ahead ?? 0, behind: gitStatus.behind ?? 0, files: gitStatus.files } };
    getCache().set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub status failed";
    return NextResponse.json({ error: message, code: "github_status_failed" }, { status: 500 });
  }
}

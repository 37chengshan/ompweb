import { NextResponse } from "next/server";
import { resolveProject } from "@/lib/worktree";
import { resolveGitHubRepo } from "@/lib/git-remote";
import { getRepoStatus } from "@/lib/github";

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

  const cacheKey = cwd;
  const cached = getCache().get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return NextResponse.json(cached.data);

  try {
    const project = await resolveProject(cwd);
    const ref = await resolveGitHubRepo(project.projectRoot);
    if (!ref) {
      const data = { repo: null, pulls: [] };
      getCache().set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      return NextResponse.json(data);
    }
    const status = await getRepoStatus(ref.owner, ref.repo);
    const data = { repo: status, pulls: status.pulls };
    getCache().set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub status failed";
    return NextResponse.json({ error: message, code: "github_status_failed" }, { status: 500 });
  }
}
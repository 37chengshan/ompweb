import { execFile } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { promisify } from "util";
import { allowFileRoot } from "./file-access";
import { normalizeForComparison, samePath, toNativePath } from "./paths";
import { loadProjectRegistry } from "./project-registry";

const execFileAsync = promisify(execFile);

// ============================================================================
// Project resolution: cwd → { projectRoot, branch }
//
// A worktree's `git rev-parse --git-common-dir` points at the *main* repo's
// .git directory, so its parent is the project root shared by all worktrees.
// Non-git directories resolve to themselves. Results are cached on globalThis
// (hot-reload safe) with a short TTL; add/remove worktree invalidates eagerly.
// ============================================================================

export interface ProjectInfo {
  projectRoot: string;
  /** Current branch of the cwd, null for non-git dirs or detached HEAD */
  branch: string | null;
  /** True when cwd is a linked worktree (not the main checkout) */
  isWorktree: boolean;
  /** True when cwd is the top-level directory of a checkout (main or linked).
   *  False for repo subdirectories and non-git dirs — the worktree switcher
   *  is only meaningful at the top level. */
  isTopLevel: boolean;
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  isMain: boolean;
}

declare global {
  var __piProjectCache: Map<string, { info: ProjectInfo; expiresAt: number }> | undefined;
  var __piProjectPendingCache: Map<string, Promise<ProjectInfo>> | undefined;
}

const PROJECT_CACHE_TTL_MS = 300_000; // 5 min — git project roots are stable

function getProjectPendingCache(): Map<string, Promise<ProjectInfo>> {
  if (!globalThis.__piProjectPendingCache) globalThis.__piProjectPendingCache = new Map();
  return globalThis.__piProjectPendingCache;
}

function realPathOrSelf(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}

function getProjectCache(): Map<string, { info: ProjectInfo; expiresAt: number }> {
  if (!globalThis.__piProjectCache) globalThis.__piProjectCache = new Map();
  return globalThis.__piProjectCache;
}

export function invalidateProjectCache(): void {
  globalThis.__piProjectCache?.clear();
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    // Pin the message locale so error-text matching (e.g. the dirty-worktree
    // detection in the DELETE route) works regardless of system language.
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout.trim();
}

/**
 * Git stores each linked worktree's `.git` file location in
 * `.git/worktrees/<id>/gitdir`. Some Windows Git versions write backslashes
 * there, while later worktree operations internally compare against a
 * forward-slash suffix. Normalize this metadata before list/add/remove so a
 * stale separator cannot make a valid linked tree unremovable.
 */
export function repairWorktreeGitdirs(repoRoot: string): void {
  try {
    const worktreesDir = join(repoRoot, ".git", "worktrees");
    if (!existsSync(worktreesDir)) return;
    for (const entry of readdirSync(worktreesDir)) {
      const gitdirPath = join(worktreesDir, entry, "gitdir");
      if (!existsSync(gitdirPath)) continue;
      try {
        const raw = readFileSync(gitdirPath, "utf8");
        const normalized = raw.trim().replace(/\\/g, "/");
        if (normalized !== raw.trim()) writeFileSync(gitdirPath, `${normalized}\n`, "utf8");
      } catch {
        // A single inaccessible linked tree should not hide the rest.
      }
    }
  } catch {
    // Missing/corrupt git metadata is handled by the normal git call.
  }
}

/**
 * addWorktree() places worktrees in `<repoRoot>-worktrees/<dir>`. When such a
 * directory no longer exists (worktree removed), group its sessions back
 * under the main repo instead of letting them dangle as a phantom project.
 * The dir name is the sanitized branch name — close enough for display.
 */
function inferRemovedWorktree(cwd: string): ProjectInfo | null {
  const parent = dirname(cwd);
  if (parent.endsWith("-worktrees")) {
    const repoRoot = parent.slice(0, -"-worktrees".length);
    if (repoRoot && existsSync(join(repoRoot, ".git"))) {
      return { projectRoot: realPathOrSelf(repoRoot), branch: basename(cwd), isWorktree: true, isTopLevel: true };
    }
  }

  // Users can configure a custom worktree location. A removed directory has
  // no git metadata left to query, so match it against explicit project roots
  // and their surviving `.git/worktrees/*/gitdir` records instead.
  try {
    const candidate = normalizeForComparison(cwd);
    for (const project of loadProjectRegistry().projects) {
      if (!existsSync(join(project.path, ".git"))) continue;
      if (candidate.startsWith(normalizeForComparison(`${project.path}-worktrees`))) {
        return { projectRoot: realPathOrSelf(project.path), branch: basename(cwd), isWorktree: true, isTopLevel: true };
      }
      const metadataDir = join(project.path, ".git", "worktrees");
      if (!existsSync(metadataDir)) continue;
      for (const entry of readdirSync(metadataDir)) {
        const gitdirPath = join(metadataDir, entry, "gitdir");
        if (!existsSync(gitdirPath)) continue;
        try {
          const recordedGitFile = toNativePath(readFileSync(gitdirPath, "utf8").trim());
          if (samePath(dirname(recordedGitFile), cwd) || samePath(recordedGitFile, cwd)) {
            return { projectRoot: realPathOrSelf(project.path), branch: basename(cwd), isWorktree: true, isTopLevel: true };
          }
        } catch {
          // Continue checking independent metadata records.
        }
      }
    }
  } catch {
    // Registry failures must not prevent normal non-git directory handling.
  }
  return null;
}

export async function resolveProject(cwd: string): Promise<ProjectInfo> {
  const cache = getProjectCache();
  const cached = cache.get(cwd);
  if (cached && cached.expiresAt > Date.now()) return cached.info;

  // Coalesce concurrent callers: a session-list refresh may resolve dozens of
  // cwds in parallel — return the same in-flight promise rather than spawning
  // N git processes for the same path.
  const pending = getProjectPendingCache();
  const inflight = pending.get(cwd);
  if (inflight) return inflight;

  const promise = (async (): Promise<ProjectInfo> => {
    let info: ProjectInfo;
    try {
      const hasGit = existsSync(join(cwd, ".git"));
      if (!existsSync(cwd) || !hasGit) {
        const inferred = inferRemovedWorktree(cwd);
        if (inferred) {
          cache.set(cwd, { info: inferred, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
          return inferred;
        }
        if (!existsSync(cwd)) {
          info = { projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false };
          cache.set(cwd, { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
          return info;
        }
      }
      const out = await git(cwd, [
        "rev-parse", "--path-format=absolute",
        "--git-common-dir", "--git-dir", "--show-toplevel",
        "--abbrev-ref", "HEAD",
      ]);
      const [commonDirRaw, gitDirRaw, toplevelRaw, ref] = out.split("\n").map((l) => l.trim());
      const [commonDir, gitDir, toplevel] = [commonDirRaw, gitDirRaw, toplevelRaw].map(toNativePath);
      const realCwd = realPathOrSelf(cwd);
      const isTopLevel = samePath(toplevel, realCwd);
      const isWorktreeTopLevel = !samePath(gitDir, commonDir) && isTopLevel;
      const topLevelProjectRoot = isWorktreeTopLevel ? dirname(commonDir) : toplevel;
      info = {
        projectRoot: isTopLevel ? realPathOrSelf(topLevelProjectRoot) : realPathOrSelf(cwd),
        branch: ref && ref !== "HEAD" ? ref : null,
        isWorktree: isWorktreeTopLevel,
        isTopLevel,
      };
    } catch {
      // Managed projects use the on-disk path too. Keeping a symlink alias
      // here puts non-Git sessions in a different sidebar group from their
      // project (e.g. /tmp versus /private/tmp, or a Windows junction).
      info = { projectRoot: realPathOrSelf(cwd), branch: null, isWorktree: false, isTopLevel: false };
    }
    cache.set(cwd, { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
    return info;
  })();

  pending.set(cwd, promise);
  return promise.finally(() => {
    if (pending.get(cwd) === promise) pending.delete(cwd);
  });
}

// ============================================================================
// Worktree operations
//
// These take any directory inside the repo (a worktree, the main checkout, or
// a subdirectory) and resolve the main repo root themselves via the git
// common dir, so callers can pass session cwds directly.
// ============================================================================

/** Main repo root (parent of the shared .git dir), or throws for non-git dirs */
async function getRepoRoot(cwd: string): Promise<string> {
  const commonDir = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return realPathOrSelf(dirname(toNativePath(commonDir)));
}

export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  const repoRoot = await getRepoRoot(cwd);
  repairWorktreeGitdirs(repoRoot);
  const out = await git(cwd, ["worktree", "list", "--porcelain"]);
  const worktrees: WorktreeInfo[] = [];
  let current: (Partial<WorktreeInfo> & { prunable?: boolean }) | null = null;

  const flush = () => {
    if (current?.path) {
      // Git may emit forward-slash absolute paths on Windows; normalize before
      // comparing with API/UI paths produced by Node's path helpers.
      const worktreePath = resolve(current.path);
      // Prunable worktrees point at missing/broken gitdirs and cannot be
      // browsed or selected usefully. Also skip vanished paths even if git has
      // not marked them prunable yet.
      if (!current.prunable && existsSync(worktreePath)) {
        worktrees.push({
          path: worktreePath,
          branch: current.branch ?? null,
          isMain: samePath(worktreePath, repoRoot),
        });
      }
    }
    current = null;
  };

  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      flush();
      current = { path: toNativePath(line.slice("worktree ".length).trim()) };
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    } else if (line.startsWith("prunable") && current) {
      current.prunable = true;
    } else if (line.trim() === "") {
      flush();
    }
  }
  flush();
  worktrees.sort((a, b) => (a.isMain ? -1 : b.isMain ? 1 : a.path.localeCompare(b.path)));
  return worktrees;
}

function findWorktreeByPath(worktrees: readonly WorktreeInfo[], candidate: string): WorktreeInfo | undefined {
  return worktrees.find((worktree) => samePath(worktree.path, candidate));
}

export function findCurrentWorktreePath(worktrees: readonly WorktreeInfo[], cwd: string): string | null {
  return findWorktreeByPath(worktrees, realPathOrSelf(cwd))?.path ?? null;
}

function sanitizeBranchForDir(branch: string): string {
  return branch.replace(/[\/\\:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function addWorktree(cwd: string, branch: string): Promise<{ path: string; branch: string }> {
  const trimmed = branch.trim();
  if (!trimmed) throw new Error("Branch name is required");
  if (trimmed.startsWith("-") || /[\s\x00-\x1f\x7f~^:?*[\]\\]/.test(trimmed)) {
    throw new Error(`Invalid branch name: ${branch}`);
  }
  if (trimmed.includes("..") || trimmed.startsWith(".") || trimmed.endsWith(".") || trimmed.endsWith(".lock")) {
    throw new Error(`Invalid branch name: ${branch}`);
  }

  const dirName = sanitizeBranchForDir(trimmed);
  if (!dirName) throw new Error(`Invalid branch name: ${branch}`);

  const repoRoot = await getRepoRoot(cwd);
  const baseDir = `${resolve(repoRoot)}-worktrees`;
  const worktreePath = join(baseDir, dirName);
  if (existsSync(worktreePath)) {
    throw new Error(`Directory already exists: ${worktreePath}`);
  }
  mkdirSync(baseDir, { recursive: true });

  // Reuse the branch if it already exists, otherwise create it at HEAD.
  let branchExists = false;
  try {
    await git(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${trimmed}`]);
    branchExists = true;
  } catch {
    branchExists = false;
  }

  const posixWorktreePath = worktreePath.replace(/\\/g, "/");
  try {
    if (branchExists) {
      await git(repoRoot, ["worktree", "add", "--", posixWorktreePath, trimmed]);
    } else {
      await git(repoRoot, ["worktree", "add", "-b", trimmed, "--", posixWorktreePath]);
    }
  } catch (error) {
    throw new Error(extractGitError(error));
  }

  repairWorktreeGitdirs(repoRoot);
  allowFileRoot(worktreePath);
  invalidateProjectCache();
  return { path: worktreePath, branch: trimmed };
}

export async function removeWorktree(cwd: string, worktreePath: string, force = false): Promise<void> {
  const repoRoot = await getRepoRoot(cwd);
  repairWorktreeGitdirs(repoRoot);
  const worktrees = await listWorktrees(cwd);
  // Compare on the same canonical form listWorktrees produces (resolve +
  // case-fold on win32): the client body value may use a drive-letter case
  // variant or forward slashes, and an exact string compare would reject a
  // legitimate worktree with a misleading not_a_worktree error.
  const target = findWorktreeByPath(worktrees, worktreePath);
  if (!target) throw new Error(`Not a worktree of this repository: ${worktreePath}`);
  if (target.isMain) throw new Error("Cannot remove the main worktree");

  try {
    await git(cwd, ["worktree", "remove", ...(force ? ["--force"] : []), target.path.replace(/\\/g, "/")]);
  } catch (error) {
    throw new Error(extractGitError(error));
  }
  if (existsSync(target.path)) {
    try { rmSync(target.path, { recursive: true, force: true }); } catch { /* locked files remain for a later retry */ }
  }
  try { await git(repoRoot, ["worktree", "prune"]); } catch { /* Git cleanup is best-effort after removal */ }
  invalidateProjectCache();
}

function extractGitError(error: unknown): string {
  const stderr = (error as { stderr?: string }).stderr;
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}

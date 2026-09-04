import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { TEXT_PREVIEW_MAX_BYTES } from "./file-types";
import type {
  GitFileDiffResponse,
  GitFileStatus,
  GitStatusResponse,
} from "./git-types";
import {
  classifyGitStatus,
  parseGitPorcelainV1,
  type GitPorcelainEntry,
} from "./git-status";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const GIT_STATUS_MAX_BUFFER = 8 * 1024 * 1024;

async function git(cwd: string, args: string[], maxBuffer = GIT_STATUS_MAX_BUFFER): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout;
}

export async function commitGitChanges(cwd: string, message: string): Promise<{ hash: string; output: string }> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) throw new Error("Not a Git repository");
  const trimmedMessage = message.trim();
  if (!trimmedMessage) throw new Error("Commit message is required");
  const status = await getGitStatus(repositoryRoot);
  if (status.files.length === 0) throw new Error("No changes to commit");
  await git(repositoryRoot, ["add", "-A"]);
  const output = await git(repositoryRoot, ["commit", "-m", trimmedMessage]);
  const hash = (await git(repositoryRoot, ["rev-parse", "--short", "HEAD"])).trim();
  return { hash, output: output.trim() };
}

export async function pushGitChanges(cwd: string): Promise<{ branch: string; output: string }> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) throw new Error("Not a Git repository");
  const branch = (await git(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
  if (!branch || branch === "HEAD") throw new Error("Cannot push from detached HEAD");
  const upstream = await git(repositoryRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).then((value) => value.trim()).catch(() => "");
  const args = upstream ? ["push"] : ["push", "--set-upstream", "origin", branch];
  const output = await git(repositoryRoot, args, GIT_STATUS_MAX_BUFFER);
  return { branch, output: output.trim() };
}

export async function listGitBranches(cwd: string): Promise<{ name: string; current: boolean }[]> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) throw new Error("Not a Git repository");
  const output = await git(repositoryRoot, ["for-each-ref", "--format=%(HEAD)\t%(refname:short)", "refs/heads/"]);
  // git emits a leading tab for non-current branches ("\tmain"); split BEFORE
  // trimming — trimming first would swallow the tab and drop the name.
  return output.split(/\r?\n/).filter((line) => line.trim() !== "").map((line) => {
    const [head, name] = line.split("\t", 2);
    return { name, current: head === "*" };
  });
}

export async function checkoutGitBranch(cwd: string, branch: string): Promise<{ branch: string }> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) throw new Error("Not a Git repository");
  const target = branch.trim();
  if (!/^[A-Za-z0-9._\/-]+$/.test(target) || target.startsWith("-") || target.includes("..")) throw new Error("Invalid branch name");
  await git(repositoryRoot, ["checkout", target]);
  return { branch: (await git(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim() };
}

async function findRepositoryRoot(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim() || null;
  } catch {
    return null;
  }
}

function isWithinPath(parent: string, target: string): boolean {
  // realpath both sides: `git rev-parse --show-toplevel` returns canonical
  // paths (e.g. /private/var/...) while callers may pass symlink forms like
  // /var/... — an unresolved lexical compare would drop every file.
  const resolve = (p: string): string => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  const relative = path.relative(resolve(parent), resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

async function readStatusEntries(repositoryRoot: string): Promise<GitPorcelainEntry[]> {
  const output = await git(repositoryRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  return parseGitPorcelainV1(output);
}

export async function getGitStatus(cwd: string): Promise<GitStatusResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot) {
    return { isGitRepository: false, repositoryRoot: null, files: [], branch: null, upstream: null, ahead: 0, behind: 0 };
  }

  const entries = await readStatusEntries(repositoryRoot);
  const files = entries.flatMap((entry): GitFileStatus[] => {
    const filePath = path.resolve(repositoryRoot, entry.path);
    if (!isWithinPath(cwd, filePath)) return [];
    const classified = classifyGitStatus(entry);
    return [{
      filePath,
      ...classified,
      indexStatus: entry.indexStatus,
      worktreeStatus: entry.worktreeStatus,
    }];
  });

  const [branch, upstream, counts] = await Promise.all([
    git(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]).then((value) => value.trim()).catch(() => "HEAD"),
    git(repositoryRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).then((value) => value.trim()).catch(() => null),
    git(repositoryRoot, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]).then((value) => value.trim().split(/\s+/).map(Number)).catch(() => [0, 0]),
  ]);
  const behind = Number.isFinite(counts[0]) ? counts[0] : 0;
  const ahead = Number.isFinite(counts[1]) ? counts[1] : 0;
  return { isGitRepository: true, repositoryRoot, files, branch, upstream, ahead, behind };
}

function hasNullByte(content: Buffer): boolean {
  return content.includes(0);
}

function createAddedFilePatch(gitPath: string, content: string): string {
  const hasTrailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (hasTrailingNewline) lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  const noNewlineMarker = !hasTrailingNewline && lines.length > 0
    ? "\n\\ No newline at end of file"
    : "";
  return [
    `diff --git a/${gitPath} b/${gitPath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${gitPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    `${body}${noNewlineMarker}`,
  ].join("\n");
}

async function createTrackedFilePatch(
  repositoryRoot: string,
  relativePath: string,
  originalPath?: string,
): Promise<string | null> {
  const paths = originalPath && originalPath !== relativePath
    ? [originalPath, relativePath]
    : [relativePath];
  try {
    return await git(repositoryRoot, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--unified=3",
      "HEAD",
      "--",
      ...paths,
    ], TEXT_PREVIEW_MAX_BYTES * 4);
  } catch {
    return null;
  }
}

export async function getGitFileDiff(cwd: string, filePath: string): Promise<GitFileDiffResponse> {
  const repositoryRoot = await findRepositoryRoot(cwd);
  if (!repositoryRoot || !isWithinPath(repositoryRoot, filePath)) return { supported: false };

  const resolvedFilePath = path.resolve(filePath);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolvedFilePath);
  } catch {
    return { supported: false };
  }
  if (!stat.isFile() || stat.size > TEXT_PREVIEW_MAX_BYTES) return { supported: false };

  // realpath the file before deriving the git-relative path: `git rev-parse
  // --show-toplevel` returns canonical paths (/private/var/... on macOS) while
  // callers may pass the symlink form (/var/...) — path.relative against the
  // raw form would produce a traversal string and drop every candidate. Same
  // realpath discipline isWithinPath already applies to both sides.
  let realFilePath = resolvedFilePath;
  try {
    realFilePath = fs.realpathSync(resolvedFilePath);
  } catch {
    // lstat succeeded, so realpath failing means the path vanished mid-check.
    return { supported: false };
  }
  let realRepositoryRoot = repositoryRoot;
  try {
    realRepositoryRoot = fs.realpathSync(repositoryRoot);
  } catch {
    return { supported: false };
  }
  const relativePath = toGitPath(path.relative(realRepositoryRoot, realFilePath));
  const entries = await readStatusEntries(realRepositoryRoot);
  const entry = entries.find((candidate) => candidate.path === relativePath);
  if (!entry) return { supported: false };

  const { status } = classifyGitStatus(entry);
  if (status === "deleted") return { supported: false };

  const currentBuffer = fs.readFileSync(realFilePath);
  if (hasNullByte(currentBuffer)) return { supported: false };
  const newContent = currentBuffer.toString("utf8");

  let patch: string;
  if (status === "untracked") {
    patch = createAddedFilePatch(relativePath, newContent);
  } else {
    const trackedPatch = await createTrackedFilePatch(realRepositoryRoot, relativePath, entry.originalPath);
    if (trackedPatch === null) {
      if (status !== "added") return { supported: false };
      patch = createAddedFilePatch(relativePath, newContent);
    } else {
      patch = trackedPatch;
    }
  }

  if (!patch.includes("\n@@ ")) return { supported: false };
  return { supported: true, status, patch };
}

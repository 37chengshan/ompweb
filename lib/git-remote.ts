import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Parse the GitHub repository identity of a local git checkout by reading its
 * `origin` remote URL. Supports https, ssh (git@), and git:// forms. Returns
 * null for non-git directories or when origin is not a GitHub remote.
 */

export interface GitHubRepoRef {
  owner: string;
  repo: string;
  /** Original remote URL (for display / deep links). */
  url: string;
}

const GITHUB_URL_RE = [
  // https://github.com/owner/repo[.git]
  /^https?:\/\/github\.com\/([^\/\s]+)\/([^\/\s]+?)(?:\.git)?$/i,
  // git@github.com:owner/repo.git or ssh://git@github.com/owner/repo.git
  /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)([^\/\s]+)\/([^\/\s]+?)(?:\.git)?$/i,
  // git://github.com/owner/repo.git
  /^git:\/\/github\.com\/([^\/\s]+)\/([^\/\s]+?)(?:\.git)?$/i,
];

export function parseGitHubRemote(remoteUrl: string): GitHubRepoRef | null {
  const trimmed = remoteUrl.trim();
  for (const re of GITHUB_URL_RE) {
    const match = re.exec(trimmed);
    if (match) {
      return { owner: match[1], repo: match[2], url: trimmed };
    }
  }
  return null;
}

/**
 * Resolve the GitHub identity of a directory by asking git for the origin
 * remote URL. `cwd` may be any directory inside the checkout.
 */
export async function resolveGitHubRepo(cwd: string): Promise<GitHubRepoRef | null> {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
      cwd,
      timeout: 8000,
    });
    return parseGitHubRemote(stdout.trim());
  } catch {
    // Not a git repo, no origin remote, or git unavailable.
    return null;
  }
}
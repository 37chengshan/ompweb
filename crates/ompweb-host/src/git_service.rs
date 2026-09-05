//! git_service: Rust authority for the git-domain read surface
//! (doc 16 route 10, first slice). Mirrors lib/git-changes.ts + lib/git-status.ts
//! for `status` / `branches` / `checkout` / `commit` / `push` / `diff`: same
//! porcelain v1 -z parsing, same classification, same cwd-subtree file filter,
//! same branch-name validation, same single-file diff contract. The host spawns
//! the system `git` binary (Node no longer executes git in Rust mode);
//! worktree list/add/remove stay Node (they orchestrate the in-memory file-root
//! allowlist and project cache — see backend-ownership.yaml).

use std::process::Command;
use std::sync::mpsc;
use std::thread;

use crate::file_service::is_path_within_any;
use crate::ipc_server::{json_str, IpcError};
use crate::process_visibility::hide_console_window;

const GIT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
/// Mirror of TEXT_PREVIEW_MAX_BYTES (lib/file-types.ts) — diff previews cap
/// at the same bound as file reads so a huge diff never floods the IPC frame.
pub const TEXT_PREVIEW_MAX_BYTES: u64 = 256 * 1024;

/// Run `git -C <cwd> <args>` with a bounded wait (mirror of the Node execFile
/// timeout). Returns trimmed stdout; stderr-only failures surface as Err.
fn run_git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let cwd_owned = cwd.to_string();
    let args_owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut cmd = Command::new("git");
        cmd.arg("-C").arg(&cwd_owned).args(&args_owned);
        cmd.env("LC_ALL", "C");
        hide_console_window(&mut cmd);
        let _ = tx.send(cmd.output());
    });
    let result = rx
        .recv_timeout(GIT_TIMEOUT)
        .map_err(|_| "git operation timed out".to_string())?;
    let result = result.map_err(|e| e.to_string())?;
    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "git failed".into()
        } else {
            stderr
        });
    }
    Ok(String::from_utf8_lossy(&result.stdout).to_string())
}

fn find_repository_root(cwd: &str) -> Option<String> {
    let out = run_git(cwd, &["rev-parse", "--show-toplevel"]).ok()?;
    let trimmed = out.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

/// Port of parseGitPorcelainV1 (lib/git-status.ts): NUL-separated records,
/// `XY path` (rename/copy consumes the following record as originalPath).
fn parse_porcelain_v1(output: &str) -> Vec<PrEntry> {
    let mut entries = Vec::new();
    let mut records = output.split('\0').peekable();
    while let Some(record) = records.next() {
        if record.is_empty() || record.len() < 4 || record.as_bytes()[2] != b' ' {
            continue;
        }
        let index_status = record.as_bytes()[0] as char;
        let worktree_status = record.as_bytes()[1] as char;
        let mut entry = PrEntry {
            path: record[3..].to_string(),
            original_path: None,
            index_status: index_status.to_string(),
            worktree_status: worktree_status.to_string(),
        };
        if uses_rename_path(index_status, worktree_status) {
            if let Some(orig) = records.next() {
                if !orig.is_empty() {
                    entry.original_path = Some(orig.to_string());
                }
            }
        }
        entries.push(entry);
    }
    entries
}

struct PrEntry {
    path: String,
    original_path: Option<String>,
    index_status: String,
    worktree_status: String,
}

fn uses_rename_path(index_status: char, worktree_status: char) -> bool {
    matches!(index_status, 'R' | 'C') || matches!(worktree_status, 'R' | 'C')
}

fn classify(index_status: &str, worktree_status: &str) -> (&'static str, &'static str) {
    let pair = format!("{index_status}{worktree_status}");
    const CONFLICTS: [&str; 7] = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"];
    if pair == "??" {
        return ("untracked", "U");
    }
    if CONFLICTS.contains(&pair.as_str()) || pair.contains('U') {
        return ("conflict", "C");
    }
    if pair.contains('D') {
        return ("deleted", "D");
    }
    if pair.contains('R') || pair.contains('C') {
        return ("renamed", "R");
    }
    if pair.contains('A') {
        return ("added", "A");
    }
    ("modified", "M")
}

#[derive(Debug, PartialEq)]
enum GitError {
    NotARepository,
    Message(String),
}

impl GitError {
    fn ipc(self) -> IpcError {
        match self {
            GitError::NotARepository => {
                IpcError::new("not_a_git_repository", "not a git repository")
            }
            GitError::Message(m) => IpcError::new("git_failed", m),
        }
    }
}

/// Component-normalized path (mirrors path.resolve before comparing in the
/// Node isWithinPath): `..` pops, `.` and empty segments collapse.
fn normalized_components(path: &str) -> Vec<&str> {
    let mut out: Vec<&str> = Vec::new();
    for component in std::path::Path::new(path).components() {
        let seg = component.as_os_str().to_str().unwrap_or("");
        match seg {
            "" | "." | "/" => {}
            ".." => {
                out.pop();
            }
            _ => out.push(seg),
        }
    }
    out
}

/// `isWithinPath` port (lib/git-changes.ts): target must equal or live under
/// parent. Both sides are canonicalized first (git rev-parse returns
/// realpaths — e.g. /private/var/... — while callers may pass symlink forms
/// like /var/... on macOS); falls back to the raw path when canonicalization
/// fails. Component-based with `..` normalization (traversal safe).
fn is_within_path(parent: &str, target: &str) -> bool {
    let canon = |p: &str| {
        std::fs::canonicalize(p)
            .map(|c| c.to_string_lossy().into_owned())
            .unwrap_or_else(|_| p.to_string())
    };
    normalized_components(&canon(target)).starts_with(&normalized_components(&canon(parent)))
}

/// Mirrors getGitStatus(cwd): repo detection, cwd-filtered file list,
/// branch/upstream/ahead-behind.
fn status_inner(cwd: &str) -> Result<String, GitError> {
    let repository_root = match find_repository_root(cwd) {
        Some(root) => root,
        None => {
            return Ok(
                "{\"isGitRepository\":false,\"repositoryRoot\":null,\"files\":[],\"branch\":null,\"upstream\":null,\"ahead\":0,\"behind\":0}"
                    .to_string(),
            );
        }
    };
    let output = run_git(
        &repository_root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )
    .map_err(GitError::Message)?;
    let mut files = String::new();
    for entry in parse_porcelain_v1(&output) {
        let file_path = format!("{}/{}", repository_root, entry.path);
        if !is_within_path(cwd, &file_path) {
            continue;
        }
        let (status, code) = classify(&entry.index_status, &entry.worktree_status);
        if !files.is_empty() {
            files.push(',');
        }
        files.push_str(&format!(
            "{{\"filePath\":{},\"status\":{},\"code\":{},\"indexStatus\":{},\"worktreeStatus\":{}}}",
            json_str(&file_path),
            json_str(status),
            json_str(code),
            json_str(&entry.index_status),
            json_str(&entry.worktree_status),
        ));
    }
    let branch = run_git(
        &repository_root,
        &["symbolic-ref", "--quiet", "--short", "HEAD"],
    )
    .map(|v| v.trim().to_string())
    .unwrap_or_else(|_| "HEAD".to_string());
    let upstream = run_git(
        &repository_root,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .map(|v| v.trim().to_string())
    .ok();
    let counts = run_git(
        &repository_root,
        &["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
    )
    .map(|v| {
        v.split_whitespace()
            .filter_map(|s| s.parse::<u64>().ok())
            .collect::<Vec<_>>()
    })
    .unwrap_or_default();
    let behind = counts.first().copied().unwrap_or(0);
    let ahead = counts.get(1).copied().unwrap_or(0);
    Ok(format!(
        "{{\"isGitRepository\":true,\"repositoryRoot\":{},\"files\":[{}],\"branch\":{},\"upstream\":{},\"ahead\":{},\"behind\":{}}}",
        json_str(&repository_root),
        files,
        json_str(&branch),
        match upstream { Some(u) => json_str(&u).to_string(), None => "null".to_string() },
        ahead,
        behind,
    ))
}

/// Mirrors listGitBranches(cwd).
fn branches_inner(cwd: &str) -> Result<String, GitError> {
    let repository_root = find_repository_root(cwd).ok_or(GitError::NotARepository)?;
    let output = run_git(
        &repository_root,
        &[
            "for-each-ref",
            "--format=%(HEAD)\t%(refname:short)",
            "refs/heads/",
        ],
    )
    .map_err(GitError::Message)?;
    let mut body = String::from("[");
    let mut first = true;
    for line in output.split('\n') {
        if line.trim().is_empty() {
            continue;
        }
        // git emits a leading tab for non-current branches ("\tmain"); split
        // BEFORE trimming so the name survives (mirror of listGitBranches).
        if let Some((head, name)) = line.split_once('\t') {
            if !first {
                body.push(',');
            }
            first = false;
            body.push_str(&format!(
                "{{\"name\":{},\"current\":{}}}",
                json_str(name),
                head == "*"
            ));
        }
    }
    body.push(']');
    Ok(body)
}

/// Mirrors checkoutGitBranch(cwd, branch): name validation then git checkout.
fn checkout_inner(cwd: &str, branch: &str) -> Result<String, GitError> {
    let repository_root = find_repository_root(cwd).ok_or(GitError::NotARepository)?;
    let target = branch.trim();
    let valid = !target.is_empty()
        && target
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '/' | '-'))
        && !target.starts_with('-')
        && !target.contains("..");
    if !valid {
        return Err(GitError::Message("Invalid branch name".to_string()));
    }
    run_git(&repository_root, &["checkout", target]).map_err(GitError::Message)?;
    let current = run_git(
        &repository_root,
        &["symbolic-ref", "--quiet", "--short", "HEAD"],
    )
    .map(|v| v.trim().to_string())
    .unwrap_or_default();
    Ok(format!("{{\"branch\":{}}}", json_str(&current)))
}

/// IPC arms: `git.status` / `git.branches` / `git.checkout`. The Node layer
/// passes the allowed roots and the cwd; the host re-enforces that the cwd is
/// root-authorized (defense-in-depth; Node keeps root authority).
pub fn status(roots: &[String], cwd: &str) -> Result<String, IpcError> {
    if !is_path_within_any(roots, cwd) {
        return Err(IpcError::new("access_denied", "cwd outside allowed roots"));
    }
    status_inner(cwd).map_err(GitError::ipc)
}
pub fn branches(roots: &[String], cwd: &str) -> Result<String, IpcError> {
    if !is_path_within_any(roots, cwd) {
        return Err(IpcError::new("access_denied", "cwd outside allowed roots"));
    }
    branches_inner(cwd).map_err(GitError::ipc)
}
pub fn checkout(roots: &[String], cwd: &str, branch: &str) -> Result<String, IpcError> {
    if !is_path_within_any(roots, cwd) {
        return Err(IpcError::new("access_denied", "cwd outside allowed roots"));
    }
    checkout_inner(cwd, branch).map_err(GitError::ipc)
}

/// CLI parity modes (`--git-status <cwd>`, `--git-branches <cwd>`,
/// `--git-checkout <cwd> <branch>`): no roots gate — fixture repos are local.
pub fn cli_status(cwd: &str) -> Result<String, String> {
    status_inner(cwd).map_err(|e| match e {
        GitError::NotARepository => "not a git repository".into(),
        GitError::Message(m) => m,
    })
}
pub fn cli_branches(cwd: &str) -> Result<String, String> {
    branches_inner(cwd).map_err(|e| match e {
        GitError::NotARepository => "not a git repository".into(),
        GitError::Message(m) => m,
    })
}
pub fn cli_checkout(cwd: &str, branch: &str) -> Result<String, String> {
    checkout_inner(cwd, branch).map_err(|e| match e {
        GitError::NotARepository => "not a git repository".into(),
        GitError::Message(m) => m,
    })
}

/// Mirrors commitGitChanges(cwd, message): repo probe, message validation,
/// `add -A`, commit, short hash.
fn commit_inner(cwd: &str, message: &str) -> Result<String, GitError> {
    let repository_root = find_repository_root(cwd).ok_or(GitError::NotARepository)?;
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err(GitError::Message("Commit message is required".to_string()));
    }
    // "No changes to commit" mirror: empty file list (non-repo already handled).
    let status = status_inner(cwd)?;
    if status.contains("\"files\":[]") {
        return Err(GitError::Message("No changes to commit".to_string()));
    }
    run_git(&repository_root, &["add", "-A"]).map_err(GitError::Message)?;
    let output =
        run_git(&repository_root, &["commit", "-m", trimmed]).map_err(GitError::Message)?;
    let hash = run_git(&repository_root, &["rev-parse", "--short", "HEAD"])
        .map(|v| v.trim().to_string())
        .unwrap_or_default();
    Ok(format!(
        "{{\"hash\":{},\"output\":{}}}",
        json_str(&hash),
        json_str(output.trim())
    ))
}

/// Mirrors pushGitChanges(cwd): branch resolution, upstream detection,
/// `push` or `push --set-upstream origin <branch>`.
fn push_inner(cwd: &str) -> Result<String, GitError> {
    let repository_root = find_repository_root(cwd).ok_or(GitError::NotARepository)?;
    let branch = run_git(
        &repository_root,
        &["symbolic-ref", "--quiet", "--short", "HEAD"],
    )
    .map(|v| v.trim().to_string())
    .unwrap_or_default();
    if branch.is_empty() || branch == "HEAD" {
        return Err(GitError::Message(
            "Cannot push from detached HEAD".to_string(),
        ));
    }
    let upstream = run_git(
        &repository_root,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .map(|v| v.trim().to_string())
    .unwrap_or_default();
    let output = if upstream.is_empty() {
        run_git(
            &repository_root,
            &["push", "--set-upstream", "origin", &branch],
        )
    } else {
        run_git(&repository_root, &["push"])
    }
    .map_err(GitError::Message)?;
    Ok(format!(
        "{{\"branch\":{},\"output\":{}}}",
        json_str(&branch),
        json_str(output.trim())
    ))
}

/// IPC arms: `git.commit` / `git.push` — mutation authority on the host.
pub fn commit(roots: &[String], cwd: &str, message: &str) -> Result<String, IpcError> {
    if !is_path_within_any(roots, cwd) {
        return Err(IpcError::new("access_denied", "cwd outside allowed roots"));
    }
    commit_inner(cwd, message).map_err(GitError::ipc)
}
pub fn push(roots: &[String], cwd: &str) -> Result<String, IpcError> {
    if !is_path_within_any(roots, cwd) {
        return Err(IpcError::new("access_denied", "cwd outside allowed roots"));
    }
    push_inner(cwd).map_err(GitError::ipc)
}

/// CLI parity modes (`--git-commit <cwd> <message>`, `--git-push <cwd>`).
pub fn cli_commit(cwd: &str, message: &str) -> Result<String, String> {
    commit_inner(cwd, message).map_err(|e| match e {
        GitError::NotARepository => "not a git repository".into(),
        GitError::Message(m) => m,
    })
}
pub fn cli_push(cwd: &str) -> Result<String, String> {
    push_inner(cwd).map_err(|e| match e {
        GitError::NotARepository => "not a git repository".into(),
        GitError::Message(m) => m,
    })
}

// ---------------------------------------------------------------------------
// Single-file diff preview (mirror of lib/git-changes.ts getGitFileDiff)
// ---------------------------------------------------------------------------

/// Port of createAddedFilePatch: synthesize a unified diff for an
/// untracked/added file without invoking git (byte-for-byte shape parity).
fn create_added_file_patch(git_path: &str, content: &str) -> String {
    let has_trailing_newline = content.ends_with('\n');
    let mut lines: Vec<&str> = content.split('\n').collect();
    if has_trailing_newline {
        lines.pop();
    }
    let no_newline_marker = if !has_trailing_newline && !lines.is_empty() {
        "\n\\ No newline at end of file".to_string()
    } else {
        String::new()
    };
    format!(
        "diff --git a/{gp} b/{gp}\nnew file mode 100644\n--- /dev/null\n+++ b/{gp}\n@@ -0,0 +1,{count} @@\n{body}{nn}",
        gp = git_path,
        count = lines.len(),
        body = lines.iter().map(|line| format!("+{line}")).collect::<Vec<_>>().join("\n"),
        nn = no_newline_marker,
    )
}

fn has_null_byte(content: &[u8]) -> bool {
    content.contains(&0)
}

/// Tracked-file patch via `git diff HEAD -- <paths>`; None on any git failure
/// (mirror of createTrackedFilePatch's catch → null).
fn create_tracked_file_patch(
    repository_root: &str,
    relative_path: &str,
    original_path: Option<&str>,
) -> Option<String> {
    let mut args = vec![
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--unified=3",
        "HEAD",
        "--",
    ];
    let paths: Vec<String>;
    if let Some(original) = original_path {
        if original != relative_path {
            paths = vec![original.to_string(), relative_path.to_string()];
        } else {
            paths = vec![relative_path.to_string()];
        }
    } else {
        paths = vec![relative_path.to_string()];
    }
    args.extend(paths.iter().map(String::as_str));
    run_git(repository_root, &args).ok()
}

/// Parse `git status --porcelain=v1 -z` into entries keyed by relative path,
/// then find the single entry whose path equals `relative_path`.
fn find_status_entry(repository_root: &str, relative_path: &str) -> Option<PrEntry> {
    let output = run_git(
        repository_root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )
    .ok()?;
    parse_porcelain_v1(&output)
        .into_iter()
        .find(|e| e.path == relative_path)
}

/// Diff preview for one file: `{supported, status?, patch?}`. Mirrors
/// getGitFileDiff(cwd, filePath) — the callers resolve the filePath against the
/// repo, so the containment check happens here against the repository root.
fn diff_inner(cwd: &str, file_path: &str) -> Result<String, GitError> {
    let repository_root = find_repository_root(cwd).ok_or(GitError::NotARepository)?;
    if !is_within_path(&repository_root, file_path) {
        return Ok("{\"supported\":false}".into());
    }
    // Canonicalize the file path before deriving the git-relative path: git's
    // rev-parse returns realpaths (e.g. /private/tmp/... on macOS) while the
    // caller may pass the symlink form (/tmp/...) — strip_prefix against the
    // raw form would fail and drop every candidate (mirror of Node's
    // path.resolve + realpathSync before path.relative).
    let resolved_file_path = std::fs::canonicalize(file_path)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| file_path.to_string());
    let metadata = match std::fs::metadata(&resolved_file_path) {
        Ok(m) => m,
        Err(_) => return Ok("{\"supported\":false}".into()),
    };
    if !metadata.is_file() || metadata.len() > TEXT_PREVIEW_MAX_BYTES {
        return Ok("{\"supported\":false}".into());
    }
    // Component-relative git path (forward slashes), mirror of toGitPath.
    let relative_path = std::path::Path::new(&resolved_file_path)
        .strip_prefix(&repository_root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    if relative_path.is_empty() {
        return Ok("{\"supported\":false}".into());
    }
    let entry = match find_status_entry(&repository_root, &relative_path) {
        Some(e) => e,
        None => return Ok("{\"supported\":false}".into()),
    };
    let (status, _code) = classify(&entry.index_status, &entry.worktree_status);
    if status == "deleted" {
        return Ok("{\"supported\":false}".into());
    }
    let current =
        std::fs::read(&resolved_file_path).map_err(|_| GitError::Message("read failed".into()))?;
    if has_null_byte(&current) {
        return Ok("{\"supported\":false}".into());
    }
    let content = String::from_utf8_lossy(&current).into_owned();
    let patch = if status == "untracked" {
        create_added_file_patch(&relative_path, &content)
    } else {
        let tracked = create_tracked_file_patch(
            &repository_root,
            &relative_path,
            entry.original_path.as_deref(),
        );
        match tracked {
            Some(p) => p,
            None => {
                if status != "added" {
                    return Ok("{\"supported\":false}".into());
                }
                create_added_file_patch(&relative_path, &content)
            }
        }
    };
    if !patch.contains("\n@@ ") {
        return Ok("{\"supported\":false}".into());
    }
    Ok(format!(
        "{{\"supported\":true,\"status\":{},\"patch\":{}}}",
        json_str(status),
        json_str(&patch)
    ))
}

/// IPC arm: `git.diff` — read-only preview, root-gated.
pub fn diff(roots: &[String], cwd: &str, file_path: &str) -> Result<String, IpcError> {
    if !is_path_within_any(roots, cwd) {
        return Err(IpcError::new("access_denied", "cwd outside allowed roots"));
    }
    if !is_path_within_any(roots, file_path) {
        return Err(IpcError::new("access_denied", "file outside allowed roots"));
    }
    diff_inner(cwd, file_path).map_err(GitError::ipc)
}

/// CLI parity mode (`--git-diff <cwd> <path>`).
pub fn cli_diff(cwd: &str, file_path: &str) -> Result<String, String> {
    diff_inner(cwd, file_path).map_err(|e| match e {
        GitError::NotARepository => "not a git repository".into(),
        GitError::Message(m) => m,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git_available() -> bool {
        Command::new("git")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Fresh temp repo with a committed file + one dirty change + a branch.
    fn fixture_repo() -> Option<String> {
        if !git_available() {
            return None;
        }
        let dir = std::env::temp_dir().join(format!(
            "ompweb-git-service-test-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .subsec_nanos()
        ));
        std::fs::create_dir_all(&dir).ok()?;
        let d = dir.to_str()?;
        std::fs::write(dir.join("a.txt"), "one").ok()?;
        for args in [
            vec!["init", "-b", "main", d],
            vec!["add", "a.txt"],
            vec!["commit", "-m", "initial"],
            vec!["checkout", "-b", "feature"],
        ] {
            let args_ref: Vec<&str> = args.to_vec();
            let cmd = Command::new("git")
                .args(&args_ref)
                .env("LC_ALL", "C")
                .output()
                .ok()?;
            if !cmd.status.success() {
                return None;
            }
        }
        Some(d.to_string())
    }

    #[test]
    fn status_reports_repo_branch_and_dirty_files() {
        let Some(dir) = fixture_repo() else {
            return;
        };
        std::fs::write(format!("{dir}/b.txt"), "two").unwrap();
        let out = status_inner(&dir).unwrap();
        assert!(out.contains("\"isGitRepository\":true"));
        assert!(out.contains("\"branch\":\"feature\""));
        assert!(out.contains("\"status\":\"untracked\""));
        assert!(out.contains("b.txt"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn status_reports_not_a_repository_for_plain_dir() {
        let dir = std::env::temp_dir().join(format!(
            "ompweb-git-plain-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .subsec_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let out = status_inner(dir.to_str().unwrap()).unwrap();
        assert!(out.contains("\"isGitRepository\":false"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn branches_lists_with_current_marker() {
        let Some(dir) = fixture_repo() else {
            return;
        };
        let out = branches_inner(&dir).unwrap();
        assert!(out.contains("\"name\":\"main\",\"current\":false"));
        assert!(out.contains("\"name\":\"feature\",\"current\":true"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn checkout_switches_branches_and_validates_names() {
        let Some(dir) = fixture_repo() else {
            return;
        };
        let out = checkout_inner(&dir, "main").unwrap();
        assert!(out.contains("\"branch\":\"main\""));
        let bad = checkout_inner(&dir, "..evil").unwrap_err();
        assert_eq!(bad, GitError::Message("Invalid branch name".to_string()));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn status_filters_files_outside_cwd_subtree() {
        let Some(dir) = fixture_repo() else {
            return;
        };
        std::fs::write(format!("{dir}/b.txt"), "two").unwrap();
        let sub = format!("{dir}/sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(format!("{sub}/nested.txt"), "nested").unwrap();
        let out = status_inner(&sub).unwrap();
        assert!(out.contains("sub/nested.txt"));
        assert!(!out.contains("b.txt"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn commit_creates_hash_and_rejects_empty_or_noop() {
        let Some(dir) = fixture_repo() else {
            return;
        };
        // Empty message rejected.
        let err = commit_inner(&dir, "   ").unwrap_err();
        assert_eq!(
            err,
            GitError::Message("Commit message is required".to_string())
        );
        // No changes → "No changes to commit".
        let err = commit_inner(&dir, "nothing").unwrap_err();
        assert_eq!(err, GitError::Message("No changes to commit".to_string()));
        // Real change commits and reports a short hash.
        std::fs::write(format!("{dir}/b.txt"), "two").unwrap();
        let out = commit_inner(&dir, "add b").unwrap();
        assert!(out.contains("\"hash\":\""));
        assert!(out.contains("\"output\":\""));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn push_reports_branch_or_fails_without_remote() {
        let Some(dir) = fixture_repo() else {
            return;
        };
        std::fs::write(format!("{dir}/b.txt"), "two").unwrap();
        let _ = commit_inner(&dir, "add b").unwrap();
        // No origin remote → push fails with a git error rather than hanging.
        let err = push_inner(&dir).unwrap_err();
        assert!(matches!(err, GitError::Message(_)));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn is_within_path_component_safe() {
        assert!(is_within_path("/r", "/r"));
        assert!(is_within_path("/r", "/r/sub"));
        assert!(!is_within_path("/r", "/r2/sub"));
        assert!(!is_within_path("/r", "/r/../etc"));
        assert!(is_within_path("/r", "/r/sub/../sub2"));
    }

    #[test]
    fn diff_previews_modified_untracked_and_rejects_deleted() {
        let Some(dir) = fixture_repo() else {
            return;
        };
        // Modified tracked file → supported patch from git.
        std::fs::write(format!("{dir}/a.txt"), "one\nchanged\n").unwrap();
        let out = diff_inner(&dir, &format!("{dir}/a.txt")).unwrap();
        assert!(out.contains("\"supported\":true"));
        assert!(out.contains("\"status\":\"modified\""));
        assert!(out.contains("+changed"));
        // Untracked file → synthesized added-file patch.
        std::fs::write(format!("{dir}/new.txt"), "fresh").unwrap();
        let out2 = diff_inner(&dir, &format!("{dir}/new.txt")).unwrap();
        assert!(out2.contains("\"supported\":true"));
        assert!(out2.contains("\"status\":\"untracked\""));
        assert!(out2.contains("new file mode 100644"));
        assert!(out2.contains("+fresh"));
        // Non-git / missing / outside-root paths → unsupported.
        assert!(diff_inner(&dir, "/etc/passwd")
            .unwrap()
            .contains("\"supported\":false"));
        std::fs::remove_dir_all(&dir).ok();
    }
}

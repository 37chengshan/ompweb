//! file_service: Rust authority for the files-domain read surface
//! (doc 16 route 9, first slice). Mirrors the Node contract in
//! app/api/files/[...path]/route.ts for `list` / `read` (text JSON) / `meta`:
//! the same ignore lists, dirs-first ordering, 256 KiB text-preview cap,
//! language/mime/previewKind mappings, and root-set containment.
//!
//! Explicitly-exempted Node surfaces (not pending migration — hard platform
//! constraints, see backend-ownership.yaml files.migrate): binary streaming
//! (image/audio/video/document) and download — this crate has no binary
//! channel and enforces a 1 MiB frame cap; docx preview — the mammoth JS
//! library has no zero-dependency Rust equivalent; multipart upload — parsed
//! in the Next layer; SSE watch — a long-lived Node stream.

use std::io::ErrorKind;
use std::path::Path;

use crate::ipc_server::{json_str, IpcError};

pub const TEXT_PREVIEW_MAX_BYTES: u64 = 256 * 1024;

const IGNORED_NAMES: &[&str] = &[
    "node_modules",
    ".git",
    ".next",
    "dist",
    "build",
    "__pycache__",
    ".turbo",
    ".cache",
    "coverage",
    ".pytest_cache",
    ".mypy_cache",
    "target",
    "vendor",
    ".DS_Store",
];
const IGNORED_SUFFIXES: &[&str] = &[".pyc"];

fn ext_language(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "ts" | "tsx" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "py" => "python",
        "rb" => "ruby",
        "go" => "go",
        "rs" => "rust",
        "java" => "java",
        "kt" => "kotlin",
        "swift" => "swift",
        "c" | "h" => "c",
        "cpp" | "hpp" => "cpp",
        "cs" => "csharp",
        "html" | "htm" => "html",
        "css" | "scss" | "less" => "css",
        "json" | "jsonl" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "xml" => "xml",
        "md" | "mdx" => "markdown",
        "sh" | "bash" | "zsh" | "fish" => "bash",
        "sql" => "sql",
        "graphql" | "gql" => "graphql",
        "dockerfile" => "dockerfile",
        "tf" | "hcl" => "hcl",
        "env" | "gitignore" => "bash",
        "txt" => "text",
        "pdf" => "pdf",
        "docx" => "word",
        _ => return None,
    })
}

/// Port of the route's `getLanguage` (full-name specials first, then the
/// extension table; unknown extensions fall back to "text").
pub fn get_language(file_path: &str) -> String {
    let base = file_path
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if base == "dockerfile" || base.starts_with("dockerfile.") {
        return "dockerfile".into();
    }
    if base == ".env" || base.starts_with(".env.") {
        return "bash".into();
    }
    if base == "makefile" || base == "gnumakefile" {
        return "makefile".into();
    }
    let ext = base.rsplit('.').next().unwrap_or("");
    ext_language(ext).unwrap_or("text").to_string()
}

fn ext_mime(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        "weba" => "audio/webm",
        "webm" => "video/webm",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "ogv" => "video/ogg",
        "mkv" => "video/x-matroska",
        "pdf" => "application/pdf",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        _ => return None,
    })
}

/// `meta.mime`: image/audio/video/document table, else "text/plain".
fn get_mime(file_path: &str) -> String {
    let base = file_path
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let ext = base.rsplit('.').next().unwrap_or("");
    ext_mime(ext).unwrap_or("text/plain").to_string()
}

/// `meta.previewKind`: pdf/docx only (mirrors DocumentPreviewKind).
fn get_preview_kind(file_path: &str) -> Option<&'static str> {
    let base = file_path
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    match base.rsplit('.').next().unwrap_or("") {
        "pdf" => Some("pdf"),
        "docx" => Some("docx"),
        _ => None,
    }
}

/// Component-safe containment: `path` must live inside `root`. Prefix
/// equality is not enough (`<root>2/…` must not pass), and any `..` segment
/// in the remainder is rejected. Mirror of lib/file-access.ts lexical tier.
///
/// Windows: roots may arrive as `D:/…` while the target is `D:\…` (or vice
/// versa) and the filesystem is case-insensitive, so normalize separators and
/// case before the prefix comparison — otherwise every Windows request against
/// a drive-rooted path fails with "cwd outside allowed roots".
pub fn is_path_within(root: &str, path: &str) -> bool {
    #[cfg(windows)]
    fn normalize(p: &str) -> String {
        p.replace('\\', "/").to_ascii_lowercase()
    }
    #[cfg(not(windows))]
    fn normalize(p: &str) -> String {
        p.to_string()
    }
    let root_n = normalize(root);
    let path_n = normalize(path);
    let Some(rest) = path_n.strip_prefix(&root_n) else {
        return false;
    };
    if !rest.is_empty() && !rest.starts_with('/') {
        return false; // sibling directory sharing the prefix (<root>2/…)
    }
    if rest.split('/').any(|seg| seg == "..") {
        return false;
    }
    true
}

/// Containment against a root set (the route always authorizes against the
/// full allowed-roots list).
pub fn is_path_within_any(roots: &[String], path: &str) -> bool {
    roots.iter().any(|root| is_path_within(root, path))
}

/// Resolve both the requested existing path and each existing root before the
/// component comparison. The HTTP adapter already applies this check, but the
/// host is a security boundary too: a symlink *inside* an allowed directory
/// must never be able to redirect a host-side read/list/meta request outside
/// it.
pub fn is_existing_path_within_any(roots: &[String], path: &str) -> bool {
    let Ok(real_path) = std::fs::canonicalize(path) else {
        return false;
    };
    roots.iter().any(|root| {
        std::fs::canonicalize(root)
            .map(|real_root| real_path.starts_with(real_root))
            .unwrap_or(false)
    })
}

fn is_ignored(name: &str) -> bool {
    IGNORED_NAMES.contains(&name) || IGNORED_SUFFIXES.iter().any(|s| name.ends_with(s))
}

/// Whether a dirent is a directory. Symlinks are resolved through stat —
/// a link to a directory counts, an unresolvable/broken link is dropped
/// (mirror of resolveDirentIsDirectory in lib/file-dirent.ts).
fn resolve_is_dir(dirent: &std::fs::DirEntry) -> Option<bool> {
    if dirent.file_type().map(|t| t.is_dir()).unwrap_or(false) {
        return Some(true);
    }
    std::fs::metadata(dirent.path()).map(|m| m.is_dir()).ok()
}

/// Entries array for one directory (list body): the same output the route
/// produces — `[{name, isDir, size: 0, modified: ""}]`, dirs first, then
/// byte-ordered names (the route uses localeCompare; ASCII fixture names
/// order identically, non-ASCII is a documented known divergence).
pub fn list_entries_json(dir: &Path) -> Result<String, IpcError> {
    let read_dir = std::fs::read_dir(dir).map_err(|e| {
        let code = if e.kind() == ErrorKind::NotFound {
            "file_not_found"
        } else {
            "read_failed"
        };
        IpcError::new(code, e.to_string())
    })?;
    let mut entries: Vec<(String, bool)> = Vec::new();
    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_ignored(&name) {
            continue;
        }
        if let Some(is_dir) = resolve_is_dir(&entry) {
            entries.push((name, is_dir));
        }
    }
    entries.sort_by(|a, b| {
        if a.1 != b.1 {
            return if a.1 {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        a.0.cmp(&b.0)
    });
    let mut body = String::from("[");
    for (i, (name, is_dir)) in entries.iter().enumerate() {
        if i > 0 {
            body.push(',');
        }
        body.push_str(&format!(
            "{{\"name\":{},\"isDir\":{},\"size\":0,\"modified\":\"\"}}",
            json_str(name),
            is_dir
        ));
    }
    body.push(']');
    Ok(body)
}

fn read_ungated(path: &str) -> Result<String, IpcError> {
    let metadata = std::fs::metadata(path).map_err(|e| -> IpcError {
        let code = if e.kind() == ErrorKind::NotFound {
            "file_not_found"
        } else {
            "read_failed"
        };
        IpcError::new(code, e.to_string())
    })?;
    if !metadata.is_file() {
        return Err(IpcError::new("not_a_file", "not a regular file"));
    }
    if metadata.len() > TEXT_PREVIEW_MAX_BYTES {
        return Err(IpcError::new(
            "file_too_large_preview",
            "file too large for preview (>256KB)",
        ));
    }
    let raw = std::fs::read(path).map_err(|e| IpcError::new("read_failed", e.to_string()))?;
    let content = String::from_utf8_lossy(&raw).into_owned();
    Ok(format!(
        "{{\"content\":{},\"language\":{},\"size\":{}}}",
        json_str(&content),
        json_str(&get_language(path)),
        metadata.len()
    ))
}

fn check_containment(roots: &[String], path: &str) -> Result<(), IpcError> {
    if !is_path_within_any(roots, path) {
        return Err(IpcError::new("access_denied", "path outside allowed roots"));
    }
    match std::fs::metadata(path) {
        Ok(_) => {
            if !is_existing_path_within_any(roots, path) {
                return Err(IpcError::new("access_denied", "path outside allowed roots"));
            }
            Ok(())
        }
        Err(e) if e.kind() == ErrorKind::NotFound => {
            Err(IpcError::new("file_not_found", "file not found"))
        }
        Err(e) => Err(IpcError::new("read_failed", e.to_string())),
    }
}

fn read_guarded(roots: &[String], path: &str) -> Result<String, IpcError> {
    check_containment(roots, path)?;
    read_ungated(path)
}

fn list_guarded(roots: &[String], path: &str) -> Result<String, IpcError> {
    check_containment(roots, path)?;
    // The route stats first: a non-directory target is `not_a_directory`,
    // a missing one is `file_not_found`.
    let metadata = std::fs::metadata(path).map_err(|e| -> IpcError {
        let code = if e.kind() == ErrorKind::NotFound {
            "file_not_found"
        } else {
            "read_failed"
        };
        IpcError::new(code, e.to_string())
    })?;
    if !metadata.is_dir() {
        return Err(IpcError::new("not_a_directory", "not a directory"));
    }
    let entries = list_entries_json(Path::new(path))?;
    Ok(format!(
        "{{\"entries\":{},\"path\":{}}}",
        entries,
        json_str(path)
    ))
}

fn meta_ungated(path: &str) -> Result<String, IpcError> {
    let metadata = std::fs::metadata(path).map_err(|e| -> IpcError {
        let code = if e.kind() == ErrorKind::NotFound {
            "file_not_found"
        } else {
            "read_failed"
        };
        IpcError::new(code, e.to_string())
    })?;
    if !metadata.is_file() {
        return Err(IpcError::new("not_a_file", "not a regular file"));
    }
    Ok(format!(
        "{{\"size\":{},\"language\":{},\"mime\":{},\"previewKind\":{}}}",
        metadata.len(),
        json_str(&get_language(path)),
        json_str(&get_mime(path)),
        match get_preview_kind(path) {
            Some(kind) => json_str(kind).to_string(),
            None => "null".to_string(),
        }
    ))
}

fn meta_guarded(roots: &[String], path: &str) -> Result<String, IpcError> {
    check_containment(roots, path)?;
    meta_ungated(path)
}

/// IPC arms: `files.list` / `files.read` / `files.meta`. `roots` is the
/// Node-computed allowed root list (Node keeps root authority; the host
/// re-enforces containment as defense-in-depth).
pub fn list(roots: &[String], path: &str) -> Result<String, IpcError> {
    list_guarded(roots, path)
}
pub fn read(roots: &[String], path: &str) -> Result<String, IpcError> {
    read_guarded(roots, path)
}
pub fn meta(roots: &[String], path: &str) -> Result<String, IpcError> {
    meta_guarded(roots, path)
}

/// `--files-list <dir>` CLI parity mode: prints the bare entries array
/// (no roots gate — fixture parity runs against a trusted temp dir).
pub fn cli_list(dir: &str) -> Result<String, String> {
    list_entries_json(Path::new(dir)).map_err(|e| e.message)
}

/// `--files-read <path>` CLI parity mode: read with no roots gate.
pub fn cli_read(path: &str) -> Result<String, String> {
    read_ungated(path).map_err(|e| e.message)
}

/// `--files-meta <path>` CLI parity mode.
pub fn cli_meta(path: &str) -> Result<String, String> {
    meta_ungated(path).map_err(|e| e.message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_fixture_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ompweb-file-service-test-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .subsec_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn containment_rejects_siblings_and_dotdot() {
        let roots = vec!["/work/a".to_string(), "/work/b".to_string()];
        assert!(is_path_within("/work/a", "/work/a/x.txt"));
        assert!(is_path_within_any(&roots, "/work/b/deep/y.txt"));
        assert!(!is_path_within_any(&roots, "/work/a2/x.txt"));
        assert!(!is_path_within_any(&roots, "/work/a/../b/x.txt"));
        assert!(!is_path_within_any(&roots, "/etc/passwd"));
        assert!(!is_path_within("/work/a", ""));
    }

    #[test]
    fn list_orders_dirs_first_and_skips_ignored() {
        let dir = temp_fixture_dir();
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        std::fs::create_dir_all(dir.join("zeta-dir")).unwrap();
        std::fs::create_dir_all(dir.join("alpha-dir")).unwrap();
        std::fs::write(dir.join("b.txt"), "b").unwrap();
        std::fs::write(dir.join("a.log"), "a").unwrap();
        std::fs::write(dir.join("x.pyc"), "x").unwrap();
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        let json = list_entries_json(&dir).unwrap();
        // dirs first (alpha, zeta), then files (a.log, b.txt); ignored gone.
        assert_eq!(
            json,
            "[{\"name\":\"alpha-dir\",\"isDir\":true,\"size\":0,\"modified\":\"\"},{\"name\":\"zeta-dir\",\"isDir\":true,\"size\":0,\"modified\":\"\"},{\"name\":\"a.log\",\"isDir\":false,\"size\":0,\"modified\":\"\"},{\"name\":\"b.txt\",\"isDir\":false,\"size\":0,\"modified\":\"\"}]"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_returns_content_language_size_and_caps_at_256k() {
        let dir = temp_fixture_dir();
        let small = dir.join("main.ts");
        std::fs::write(&small, "export const x = 1;").unwrap();
        let out = read(
            &[dir.to_string_lossy().into_owned()],
            small.to_str().unwrap(),
        )
        .unwrap();
        assert_eq!(
            out,
            format!(
                "{{\"content\":{},\"language\":\"typescript\",\"size\":19}}",
                json_str("export const x = 1;")
            )
        );
        let big = dir.join("big.log");
        std::fs::write(&big, vec![b'x'; (TEXT_PREVIEW_MAX_BYTES + 1) as usize]).unwrap();
        let err = read(&[dir.to_string_lossy().into_owned()], big.to_str().unwrap()).unwrap_err();
        assert_eq!(err.code, "file_too_large_preview");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_rejects_out_of_root_paths() {
        let root = "/tmp/ompweb-files-root-test";
        std::fs::create_dir_all(root).ok();
        let err = read(&[root.to_string()], "/etc/passwd").unwrap_err();
        assert_eq!(err.code, "access_denied");
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn read_returns_file_not_found_for_missing_file_in_allowed_root() {
        let dir = temp_fixture_dir();
        let missing = dir.join("nope.txt");
        let err = read(
            &[dir.to_string_lossy().into_owned()],
            missing.to_str().unwrap(),
        )
        .unwrap_err();
        assert_eq!(err.code, "file_not_found");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn read_rejects_symlink_that_escapes_an_allowed_root() {
        use std::os::unix::fs::symlink;

        let root = temp_fixture_dir();
        let outside = temp_fixture_dir();
        let secret = outside.join("outside.txt");
        std::fs::write(&secret, "not reachable through root").unwrap();
        let escaped = root.join("escaped.txt");
        symlink(&secret, &escaped).unwrap();

        let err = read(
            &[root.to_string_lossy().into_owned()],
            escaped.to_str().unwrap(),
        )
        .unwrap_err();
        assert_eq!(err.code, "access_denied");
        std::fs::remove_dir_all(&root).ok();
        std::fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn language_and_mime_tables_match_node_contract() {
        assert_eq!(get_language("/p/Dockerfile"), "dockerfile");
        assert_eq!(get_language("/p/.env"), "bash");
        assert_eq!(get_language("/p/Makefile"), "makefile");
        assert_eq!(get_language("/p/x.tsx"), "typescript");
        assert_eq!(get_language("/p/README.md"), "markdown");
        assert_eq!(get_language("/p/unknown.zzz"), "text");
        assert_eq!(get_mime("/p/a.svg"), "image/svg+xml");
        assert_eq!(get_mime("/p/a.mp4"), "video/mp4");
        assert_eq!(get_mime("/p/a.pdf"), "application/pdf");
        assert_eq!(get_mime("/p/a.unknownext"), "text/plain");
        assert_eq!(get_preview_kind("/p/a.docx"), Some("docx"));
        assert_eq!(get_preview_kind("/p/a.pdf"), Some("pdf"));
        assert_eq!(get_preview_kind("/p/a.txt"), None);
    }
}

#[cfg(all(test, unix))]
mod canonical_root_tests {
    #[test]
    fn canonical_cwd_accepts_root_alias_but_rejects_escaping_symlink() {
        let dir = std::env::temp_dir().join(format!("ompweb-root-alias-{}", std::process::id()));
        let root = dir.join("real");
        let outside = dir.join("outside");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&root, dir.join("alias")).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("escape")).unwrap();
        let roots = vec![dir.join("alias").to_string_lossy().into_owned()];
        assert!(super::is_existing_path_within_any(&roots, root.to_str().unwrap()));
        assert!(!super::is_existing_path_within_any(&roots, root.join("escape").to_str().unwrap()));
        std::fs::remove_dir_all(dir).unwrap();
    }
}

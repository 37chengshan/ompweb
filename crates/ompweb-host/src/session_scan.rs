//! R7: Session Projection Shadow (doc 15 / v4 R7).
//!
//! Standalone Rust scan of a sessions root, mirroring what the Node
//! session-reader list path computes: per-file title (fixed 256-byte slot
//! with padding stripped), entry/message counts, mtime and size. The Node
//! shadow test compares this output against `listAllSessions` on the same
//! fixture root — semantic mismatch threshold = 0 for the fixture set.

use crate::mini_json::JsonValue;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub struct SessionProjection {
    pub path: String,
    pub id: String,
    pub cwd: String,
    pub parent_session: String,
    pub created: String,
    pub title: String,
    pub first_message: String,
    pub lines: usize,
    pub messages: usize,
    pub bytes: u64,
    pub mtime_ms: i64,
}

pub fn collect_session_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                files.extend(collect_session_files(&path));
            } else if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
                files.push(path);
            }
        }
    }
    files.sort();
    files
}

/// Read the fixed 256-byte title slot (line 1, left-padded). Mirrors the
/// Node readTitleSlot contract: title text before the padding, or "" when
/// the header is not the title line.
fn read_title_slot(raw: &str) -> String {
    let first_line = raw.lines().next().unwrap_or("");
    if !first_line.starts_with("{\"type\":\"title\"") {
        return String::new();
    }
    match JsonValue::parse(first_line) {
        Ok(v) => v
            .get(&["title"])
            .and_then(|t| t.as_str())
            .map(|t| t.trim_end_matches(|c: char| c == ' ' || c == '\u{00A0}').to_string())
            .unwrap_or_default(),
        Err(_) => String::new(),
    }
}

fn mtime_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// List-scan prefix window (bytes) — mirrors the Node scanner's
/// SESSION_LIST_PREFIX_BYTES. Session metadata (title slot, session header,
/// first message, prefix message count) all live at the head of the file;
/// reading only this window keeps the scan O(total-head-bytes) instead of
/// O(total-file-bytes) — a 1 GiB session directory must not stall the list.
const LIST_PREFIX_BYTES: u64 = 4096;

/// Scan one file into a projection (head-window read, Node-parity).
pub fn project_file(path: &Path) -> Result<SessionProjection, String> {
    let file = fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let size = file.metadata().map_err(|e| format!("stat {}: {e}", path.display()))?.len();
    let head = size.min(LIST_PREFIX_BYTES) as usize;
    let mut buf = vec![0u8; head];
    if head > 0 {
        use std::io::Read;
        let mut file = file;
        file.read_exact(&mut buf).map_err(|e| format!("read {}: {e}", path.display()))?;
    }
    let raw = String::from_utf8_lossy(&buf);
    let mut lines = 0usize;
    let mut messages = 0usize;
    let mut session_id = String::new();
    let mut cwd = String::new();
    let mut parent_session = String::new();
    let mut created = String::new();
    let mut first_message = String::new();
    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        lines += 1;
        if let Ok(value) = JsonValue::parse(line) {
            let kind = value.get(&["type"]).and_then(|t| t.as_str()).unwrap_or("");
            if kind == "message" {
                messages += 1;
                if first_message.is_empty() {
                    first_message = value
                        .get(&["message", "content"])
                        .and_then(|c| c.as_str())
                        .unwrap_or("")
                        .chars()
                        .take(240)
                        .collect();
                }
            } else if kind == "session" {
                session_id = value.get(&["id"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                cwd = value.get(&["cwd"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                parent_session = value.get(&["parentSession"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                created = value.get(&["timestamp"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
            }
        }
    }
    if session_id.is_empty() {
        // Fallback: derive the id from the file name (<ts>_<uuid>.jsonl).
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            session_id = stem.rsplit('_').next().unwrap_or(stem).to_string();
        }
    }
    Ok(SessionProjection {
        path: path.to_string_lossy().to_string(),
        id: session_id,
        cwd,
        parent_session,
        created,
        title: read_title_slot(&raw),
        first_message,
        lines,
        messages,
        bytes: size,
        mtime_ms: mtime_ms(path),
    })
}

/// Scan the whole root; returns projections sorted by path.
pub fn scan_root(root: &Path) -> Result<Vec<SessionProjection>, String> {
    let files = collect_session_files(root);
    let mut out = Vec::with_capacity(files.len());
    for file in files {
        out.push(project_file(&file)?);
    }
    Ok(out)
}

/// Minimal JSON array serialization for the CLI output (zero deps).
pub fn projections_to_json(items: &[SessionProjection]) -> String {
    let mut out = String::from("[");
    for (i, p) in items.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&format!(
            "{{\"path\":{},\"id\":{},\"cwd\":{},\"parentSession\":{},\"created\":{},\"title\":{},\"firstMessage\":{},\"lines\":{},\"messages\":{},\"bytes\":{},\"mtime_ms\":{}}}",
            json_string(&p.path),
            json_string(&p.id),
            json_string(&p.cwd),
            json_string(&p.parent_session),
            json_string(&p.created),
            json_string(&p.title),
            json_string(&p.first_message),
            p.lines,
            p.messages,
            p.bytes,
            p.mtime_ms,
        ));
    }
    out.push(']');
    out
}

fn json_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fixture_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ompweb-scan-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn projection_includes_r10_fields() {
        let dir = fixture_dir();
        let file = dir.join("20260115T120000_0000test00000000000000000000abcd.jsonl");
        fs::write(
            &file,
            "{\"type\":\"session\",\"version\":3,\"id\":\"0000test00000000000000000000abcd\",\"timestamp\":\"2026-01-15T12:00:00Z\",\"cwd\":\"/work/proj\",\"parentSession\":\"/work/proj/20260101T000000_0000parent0000000000000000000000.jsonl\"}\n\
             {\"type\":\"message\",\"id\":\"m1\",\"parentId\":null,\"message\":{\"role\":\"user\",\"content\":\"first hello\"}}\n",
        )
        .unwrap();
        let p = project_file(&file).unwrap();
        assert_eq!(p.id, "0000test00000000000000000000abcd");
        assert_eq!(p.cwd, "/work/proj");
        assert_eq!(p.created, "2026-01-15T12:00:00Z");
        assert_eq!(p.first_message, "first hello");
        assert_eq!(p.messages, 1);
        assert!(p.parent_session.contains("0000parent"));
        fs::remove_file(&file).ok();
    }
}

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
    collect_session_files_inner(root, true)
}

fn collect_session_files_inner(root: &Path, allow_loose_files: bool) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Per-session artifact directories are literally the session
                // file name minus `.jsonl` (`<ts>_<uuid>`). They hold subagent
                // transcripts and sidecars, NOT sessions — skip them so the
                // sidebar never lists `CodeQualityReview.jsonl` etc. Real
                // project dirs (cwd slugs) never match the session pattern.
                if let Some(name) = entry.file_name().to_str() {
                    if !is_session_file_name(&format!("{name}.jsonl")) {
                        files.extend(collect_session_files_inner(&path, false));
                    }
                }
            } else if let Some(name) = entry.file_name().to_str() {
                if name.ends_with(".jsonl") && (allow_loose_files || is_session_file_name(name) || is_session_header_file(&path)) {
                    files.push(path);
                }
            }
        }
    }
    files.sort();
    files
}

/// Accept legacy/imported session files with non-standard names only when
/// their bounded prefix proves they contain a session header.
fn is_session_header_file(path: &Path) -> bool {
    let Ok(raw) = fs::read_to_string(path) else { return false; };
    for line in raw.lines().take(32) {
        if line.trim().is_empty() { continue; }
        let Ok(value) = JsonValue::parse(line) else { return false; };
        return value.get(&["type"]).and_then(|v| v.as_str()) == Some("session")
            && value.get(&["id"]).and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
    }
    false
}

/// Mirror of the Node `isOmpSessionFileName`: true only for omp session files
/// (`<timestamp>_<uuid>.jsonl`, ISO-dash or compact timestamp forms). Subagent
/// transcripts and other artifacts never match, keeping R7 shadow parity with
/// the Node scanner.
pub fn is_session_file_name(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".jsonl") else { return false; };
    let Some(index) = stem.find('_') else { return false; };
    let (ts, body) = stem.split_at(index);
    let body = &body[1..];
    if body.is_empty() || !body.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return false;
    }
    is_compact_timestamp(ts) || is_iso_timestamp(ts)
}

fn is_all_digits(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_digit())
}

/// `20260103T030000` (15 chars: digits, `T` at index 8).
fn is_compact_timestamp(ts: &str) -> bool {
    if ts.len() != 15 {
        return false;
    }
    let bytes = ts.as_bytes();
    (0..15).all(|i| if i == 8 { bytes[i] == b'T' } else { bytes[i].is_ascii_digit() })
}

/// `2026-08-27T16-58-53Z` (20) or `2026-08-27T16-58-53-862Z` (24).
fn is_iso_timestamp(ts: &str) -> bool {
    let bytes = ts.as_bytes();
    if ts.len() == 20 {
        is_all_digits(&ts[0..4])
            && bytes[4] == b'-'
            && is_all_digits(&ts[5..7])
            && bytes[7] == b'-'
            && is_all_digits(&ts[8..10])
            && bytes[10] == b'T'
            && is_all_digits(&ts[11..13])
            && bytes[13] == b'-'
            && is_all_digits(&ts[14..16])
            && bytes[16] == b'-'
            && is_all_digits(&ts[17..19])
            && bytes[19] == b'Z'
    } else if ts.len() == 24 {
        is_all_digits(&ts[0..4])
            && bytes[4] == b'-'
            && is_all_digits(&ts[5..7])
            && bytes[7] == b'-'
            && is_all_digits(&ts[8..10])
            && bytes[10] == b'T'
            && is_all_digits(&ts[11..13])
            && bytes[13] == b'-'
            && is_all_digits(&ts[14..16])
            && bytes[16] == b'-'
            && is_all_digits(&ts[17..19])
            && bytes[19] == b'-'
            && is_all_digits(&ts[20..23])
            && bytes[23] == b'Z'
    } else {
        false
    }
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
// One-shot bounded extension for files whose prefix window contains no
// message (huge session_init system prompts). Mirrors the Node scanner.
const LIST_EXTEND_BYTES: u64 = 64 * 1024;

/// First user-visible text of a message content value: a plain string, or
/// an array of text blocks ([{"type":"text","text":"..."}]). Mirrors the
/// Node extractTextFromContent contract (240-char bound).
fn extract_message_text(value: &JsonValue) -> String {
    if let Some(text) = value.as_str() {
        return text.chars().take(240).collect();
    }
    if let JsonValue::Arr(items) = value {
        let mut out = String::new();
        for item in items {
            if let JsonValue::Obj(entries) = item {
                let is_text = entries.iter().any(|(k, v)| k == "type" && v.as_str() == Some("text"));
                if is_text {
                    if let Some(text) = entries.iter().find(|(k, _)| k == "text").and_then(|(_, v)| v.as_str()) {
                        if !out.is_empty() { out.push(' '); }
                        out.push_str(text);
                        if out.chars().count() >= 240 { break; }
                    }
                }
            }
        }
        out.chars().take(240).collect()
    } else {
        String::new()
    }
}

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
                    if let Some(content) = value.get(&["message", "content"]) {
                        first_message = extract_message_text(content);
                    }
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
    // Bounded extension: session_init/system prompts can push the first
    // message past the prefix window. Only files whose prefix had no message
    // pay this extra read.
    if first_message.is_empty() && size > LIST_PREFIX_BYTES {
        let extended_len = size.min(LIST_PREFIX_BYTES + LIST_EXTEND_BYTES) as usize;
        if let Ok(mut ext_file) = fs::File::open(path) {
            use std::io::Read as _;
            let mut ext_buf = vec![0u8; extended_len];
            if let Ok(read) = ext_file.read(&mut ext_buf) {
                'ext: for line in String::from_utf8_lossy(&ext_buf[..read]).lines() {
                    if line.trim().is_empty() {
                        continue;
                    }
                    if let Ok(value) = JsonValue::parse(line) {
                        let kind = value.get(&["type"]).and_then(|t| t.as_str()).unwrap_or("");
                        if kind == "message" {
                            let role = value.get(&["message", "role"]).and_then(|r| r.as_str()).unwrap_or("");
                            if role == "user" {
                                if let Some(content) = value.get(&["message", "content"]) {
                                    first_message = extract_message_text(content);
                                }
                                if !first_message.is_empty() {
                                    break 'ext;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    // Display title: when the title slot is empty, inject the opening
    // message so the sidebar never shows a bare "(no messages)" row.
    let title = read_title_slot(&raw);
    let display_title = if title.is_empty() { first_message.chars().take(120).collect() } else { title };
    Ok(SessionProjection {
        path: path.to_string_lossy().to_string(),
        id: session_id,
        cwd,
        parent_session,
        created,
        title: display_title,
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

    #[test]
    fn session_file_name_filter_matches_omp_and_rejects_artifacts() {
        assert!(is_session_file_name("2026-08-27T16-58-53-862Z_01a04429-0426-71ee-9345-c66edc32e851.jsonl"));
        assert!(is_session_file_name("20260103T030000_00000000002a-4a0d-4f5e-9c1b-000000051336.jsonl"));
        assert!(is_session_file_name("2026-08-27T16-58-53Z_01a04429.jsonl"));
        assert!(!is_session_file_name("CodeQualityReview.jsonl"));
        assert!(!is_session_file_name("sec-review-eval.jsonl"));
        assert!(!is_session_file_name("10.bash.log"));
        assert!(!is_session_file_name("2026-08-27.txt"));
    }

    #[test]
    fn first_message_from_text_blocks_and_title_fallback() {
        let dir = fixture_dir();
        let file = dir.join("20260115T120000_0000test00000000000000000000blk1.jsonl");
        fs::write(
            &file,
            "{\"type\":\"session\",\"version\":3,\"id\":\"0000test00000000000000000000blk1\",\"timestamp\":\"2026-01-15T12:00:00Z\",\"cwd\":\"/p\"}\n\
             {\"type\":\"message\",\"id\":\"m1\",\"parentId\":null,\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"hello blocks\"}]}}\n",
        )
        .unwrap();
        let p = project_file(&file).unwrap();
        assert_eq!(p.first_message, "hello blocks");
        assert_eq!(p.title, "hello blocks");
        fs::remove_file(&file).ok();
    }
}

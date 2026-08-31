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
    pub title: String,
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

/// Scan one file into a projection.
pub fn project_file(path: &Path) -> Result<SessionProjection, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let mut lines = 0usize;
    let mut messages = 0usize;
    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        lines += 1;
        // Parse-confirm: a truncated or malformed message line must not be
        // counted (prefix matching alone would over-count).
        if let Ok(value) = JsonValue::parse(line) {
            if value.get(&["type"]).and_then(|t| t.as_str()) == Some("message") {
                messages += 1;
            }
        }
    }
    let metadata = fs::metadata(path).map_err(|e| format!("stat {}: {e}", path.display()))?;
    Ok(SessionProjection {
        path: path.to_string_lossy().to_string(),
        title: read_title_slot(&raw),
        lines,
        messages,
        bytes: metadata.len(),
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
            "{{\"path\":{},\"title\":{},\"lines\":{},\"messages\":{},\"bytes\":{},\"mtime_ms\":{}}}",
            json_string(&p.path),
            json_string(&p.title),
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

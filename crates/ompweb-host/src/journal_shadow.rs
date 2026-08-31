//! R6: Event Journal Shadow (doc 15 / v4 R6).
//!
//! Standalone pass that replays real omp session JSONL files into the
//! SQLite journal WITHOUT touching the production path. The Node-normalized
//! event stream is approximated by parsing the session files themselves
//! (the authoritative event source): each JSONL entry becomes a journal
//! event on the session's stream, ordered by line number (seq), classified
//! by entry type. The journal then supports the exact resume/snapshot
//! semantics the protocol layer needs — validated by the shared conformance
//! script plus the shadow parity test on the Node side.

use crate::mini_json::JsonValue;
use ompweb_storage::sqlite_journal::{EventClass, SqliteJournal};
use std::fs;
use std::path::{Path, PathBuf};

pub struct ShadowStats {
    pub files_scanned: usize,
    pub lines_total: usize,
    pub events_appended: usize,
    pub lines_skipped: usize,
    pub streams: usize,
    pub db_bytes: u64,
}

/// Walk `sessions_root` recursively for `.jsonl` files (mirrors
/// lib/omp/session-files.ts). Returns sorted absolute paths.
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

fn classify(kind: &str) -> EventClass {
    match kind {
        "message" => EventClass::Reliable,
        "title_change" | "session" | "compaction" => EventClass::Coalesced,
        _ => EventClass::Ephemeral,
    }
}

/// Replay one JSONL file into the journal. Stream id is the file's relative
/// path (stable across re-runs for the same root). Returns events appended.
pub fn shadow_file(journal: &mut SqliteJournal, path: &Path, stream: &str, now_ms: i64) -> Result<(usize, usize), String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let mut appended = 0usize;
    let mut skipped = 0usize;
    for (line_no, line) in raw.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let value = match JsonValue::parse(line) {
            Ok(v) => v,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let kind = value.get(&["type"]).and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
        let event_id = value.get(&["id"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
        // Truncate payloads to a bounded window — the journal must not grow
        // without bound on enormous messages (v4 R6 exit gate).
        let payload = if line.len() > 65_536 { &line[..65_536] } else { line };
        let seq = journal
            .append(stream, &kind, classify(&kind), payload, now_ms)
            .map_err(|e| format!("append {}:{}: {e}", path.display(), line_no))?;
        let _ = (event_id, seq);
        appended += 1;
    }
    Ok((appended, skipped))
}

/// Run the shadow pass over a sessions root into a SQLite journal file.
pub fn run_shadow(root: &Path, db_path: &Path) -> Result<ShadowStats, String> {
    let mut journal = SqliteJournal::open(
        db_path.to_str().ok_or("db path not utf-8")?,
        "shadow-epoch-1",
    )
    .map_err(|e| format!("open journal: {e}"))?;
    journal.set_tail_max(4096);
    let files = collect_session_files(root);
    let mut total_lines = 0usize;
    let mut total_events = 0usize;
    let mut total_skipped = 0usize;
    let mut streams = 0usize;
    let now_ms = 1_700_000_000_000i64; // deterministic for shadow replay
    for file in &files {
        let rel = file.strip_prefix(root).unwrap_or(file);
        let stream = rel.to_string_lossy().to_string();
        let (appended, skipped) = shadow_file(&mut journal, file, &stream, now_ms)?;
        total_lines += appended + skipped;
        total_events += appended;
        total_skipped += skipped;
        streams += 1;
    }
    // WAL checkpoint on drop (SqliteJournal::Drop) closes cleanly.
    let db_bytes = fs::metadata(db_path).map(|m| m.len()).unwrap_or(0);
    Ok(ShadowStats {
        files_scanned: files.len(),
        lines_total: total_lines,
        events_appended: total_events,
        lines_skipped: total_skipped,
        streams,
        db_bytes,
    })
}

//! SQLite-backed Event Continuity journal (doc 02 minimal schema, doc 06
//! slice 2). Same semantics as the in-memory oracle in ompweb-protocol; the
//! shared conformance script (lib/continuity/conformance-script.txt) drives
//! both. Single-writer via one connection, short transactions, WAL enabled
//! for file-backed DBs with an explicit checkpoint on close.

use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;

pub const SCHEMA_VERSION: i64 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventClass {
    Reliable,
    Coalesced,
    Ephemeral,
}

impl EventClass {
    pub fn as_str(self) -> &'static str {
        match self {
            EventClass::Reliable => "reliable",
            EventClass::Coalesced => "coalesced",
            EventClass::Ephemeral => "ephemeral",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "reliable" => Some(EventClass::Reliable),
            "coalesced" => Some(EventClass::Coalesced),
            "ephemeral" => Some(EventClass::Ephemeral),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClientCursor {
    pub stream_id: String,
    pub seq: i64,
}

/// Resume decision — mirrors ompweb_protocol::ResumePlan (kept local so this
/// crate's schema contract does not leak the protocol crate's wire types).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ResumePlan {
    FullSnapshot,
    ProtocolError {
        stream: String,
        head_seq: i64,
    },
    SnapshotThenReplay {
        stream: String,
        snapshot_seq: i64,
        seqs: Vec<i64>,
    },
    Replay {
        stream: String,
        seqs: Vec<i64>,
    },
    NoChange {
        stream: String,
    },
}

struct TailEntry {
    seq: i64,
    kind: String,
    class: &'static str,
    payload: String,
}

pub struct SqliteJournal {
    conn: Connection,
    host_epoch: String,
    tail_buffer_max: usize,
    /// Streams currently resuming: bounded in-memory tail (doc 02 rule: live
    /// appends during resume buffer and never interleave with replay).
    resuming: HashMap<String, Vec<TailEntry>>,
}

impl SqliteJournal {
    pub fn open_in_memory(host_epoch: &str) -> rusqlite::Result<Self> {
        let conn = Connection::open_in_memory()?;
        Self::init(conn, host_epoch)
    }

    pub fn open(path: &str, host_epoch: &str) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        Self::init(conn, host_epoch)
    }

    fn init(conn: Connection, host_epoch: &str) -> rusqlite::Result<Self> {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS runtime_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS streams (
                stream_id TEXT PRIMARY KEY,
                next_seq INTEGER NOT NULL,
                compacted_through INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS events (
                stream_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                event_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                class TEXT NOT NULL,
                payload_version INTEGER NOT NULL DEFAULT 1,
                payload TEXT NOT NULL,
                occurred_at INTEGER NOT NULL,
                recorded_at INTEGER NOT NULL,
                PRIMARY KEY (stream_id, seq)
            );
            CREATE TABLE IF NOT EXISTS snapshots (
                stream_id TEXT PRIMARY KEY,
                seq INTEGER NOT NULL,
                state_version INTEGER NOT NULL,
                payload TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            "#,
        )?;
        conn.execute(
            "INSERT OR IGNORE INTO runtime_meta (key, value) VALUES ('host_epoch', ?1)",
            params![host_epoch],
        )?;
        conn.execute(
            "INSERT OR IGNORE INTO runtime_meta (key, value) VALUES ('schema_version', ?1)",
            params![SCHEMA_VERSION.to_string()],
        )?;
        // The stored host epoch is authoritative (client epoch mismatch →
        // FULL_SNAPSHOT at resume).
        let stored: String = conn.query_row(
            "SELECT value FROM runtime_meta WHERE key = 'host_epoch'",
            [],
            |row| row.get(0),
        )?;
        Ok(SqliteJournal {
            conn,
            host_epoch: stored,
            tail_buffer_max: 1024,
            resuming: HashMap::new(),
        })
    }

    pub fn host_epoch(&self) -> &str {
        &self.host_epoch
    }

    pub fn set_tail_max(&mut self, max: usize) {
        self.tail_buffer_max = max;
    }

    fn next_seq(&self, stream: &str, now_ms: i64) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT INTO streams (stream_id, next_seq, compacted_through, updated_at)
             VALUES (?1, 2, 0, ?2)
             ON CONFLICT(stream_id) DO UPDATE SET next_seq = next_seq + 1, updated_at = ?2",
            params![stream, now_ms],
        )?;
        let seq: i64 = self.conn.query_row(
            "SELECT next_seq - 1 FROM streams WHERE stream_id = ?1",
            params![stream],
            |row| row.get(0),
        )?;
        Ok(seq)
    }

    /// Append one event. Returns the assigned seq. Ephemeral events and
    /// appends during resume are NOT journaled (tail buffer rules, doc 02).
    pub fn append(
        &mut self,
        stream: &str,
        kind: &str,
        class: EventClass,
        payload: &str,
        now_ms: i64,
    ) -> rusqlite::Result<i64> {
        let buffering = self.resuming.contains_key(stream);
        if buffering || class == EventClass::Ephemeral {
            let entry = self.resuming.entry(stream.to_string()).or_default();
            if entry.len() >= self.tail_buffer_max {
                entry.remove(0);
            }
            let seq = {
                self.conn.execute(
                    "INSERT INTO streams (stream_id, next_seq, compacted_through, updated_at)
                     VALUES (?1, 2, 0, ?2)
                     ON CONFLICT(stream_id) DO UPDATE SET next_seq = next_seq + 1, updated_at = ?2",
                    params![stream, now_ms],
                )?;
                self.conn.query_row(
                    "SELECT next_seq - 1 FROM streams WHERE stream_id = ?1",
                    params![stream],
                    |row| row.get(0),
                )?
            };
            // Ephemeral rows are deliberately NOT persisted to the events
            // table — tail-buffer-only loss is the documented contract.
            if class != EventClass::Ephemeral {
                entry.push(TailEntry {
                    seq,
                    kind: kind.to_string(),
                    class: class.as_str(),
                    payload: payload.to_string(),
                });
            }
            return Ok(seq);
        }

        let seq = self.next_seq(stream, now_ms)?;
        if class == EventClass::Coalesced {
            // Coalesced families keep only the latest committed value (same
            // as the in-memory oracle): the previous row leaves the journal.
            self.conn.execute(
                "DELETE FROM events
                 WHERE stream_id = ?1 AND kind = ?2 AND class = 'coalesced'
                   AND seq > (SELECT compacted_through FROM streams WHERE stream_id = ?1)",
                params![stream, kind],
            )?;
        }
        self.conn.execute(
            "INSERT INTO events (stream_id, seq, event_id, kind, class, payload, occurred_at, recorded_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![stream, seq, format!("evt-{}", seq), kind, class.as_str(), payload, now_ms],
        )?;
        Ok(seq)
    }

    /// Compact at the current head: snapshot becomes the resume base.
    /// The head seq is OBSERVED, not consumed (matches the in-memory oracle).
    pub fn snapshot(
        &mut self,
        stream: &str,
        state_version: i64,
        now_ms: i64,
    ) -> rusqlite::Result<i64> {
        self.conn.execute(
            "INSERT OR IGNORE INTO streams (stream_id, next_seq, compacted_through, updated_at)
             VALUES (?1, 1, 0, ?2)",
            params![stream, now_ms],
        )?;
        let seq: i64 = self.conn.query_row(
            "SELECT next_seq - 1 FROM streams WHERE stream_id = ?1",
            params![stream],
            |row| row.get(0),
        )?;
        self.conn.execute(
            "INSERT INTO snapshots (stream_id, seq, state_version, payload, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(stream_id) DO UPDATE SET seq = ?2, state_version = ?3, payload = ?4, created_at = ?5",
            params![stream, seq, state_version, format!("v{}", state_version), now_ms],
        )?;
        self.conn.execute(
            "UPDATE streams SET compacted_through = ?2 WHERE stream_id = ?1",
            params![stream, seq],
        )?;
        self.conn.execute(
            "DELETE FROM events WHERE stream_id = ?1 AND seq <= ?2",
            params![stream, seq],
        )?;
        Ok(seq)
    }

    pub fn begin_resume(&mut self, stream: &str) {
        self.resuming.entry(stream.to_string()).or_default();
    }

    /// Commit buffered tail rows into the events table in seq order.
    pub fn drain_tail(&mut self, stream: &str) -> usize {
        let Some(entries) = self.resuming.remove(stream) else {
            return 0;
        };
        let drained = entries.len();
        for e in entries {
            let _ = self.conn.execute(
                "INSERT OR IGNORE INTO events (stream_id, seq, event_id, kind, class, payload, occurred_at, recorded_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0)",
                params![stream, e.seq, format!("evt-{}", e.seq), e.kind, e.class, e.payload],
            );
        }
        drained
    }

    /// Resume decision for a client cursor set — same semantics as the
    /// in-memory oracle (epoch mismatch, cursor-ahead guard, snapshot base).
    pub fn resume(
        &mut self,
        client_epoch: &str,
        cursors: &[ClientCursor],
    ) -> rusqlite::Result<Vec<ResumePlan>> {
        if client_epoch != self.host_epoch {
            return Ok(vec![ResumePlan::FullSnapshot]);
        }
        let mut plans = Vec::new();
        for c in cursors {
            let head: Option<i64> = self
                .conn
                .query_row(
                    "SELECT next_seq - 1 FROM streams WHERE stream_id = ?1",
                    params![c.stream_id],
                    |row| row.get(0),
                )
                .optional()?;
            let Some(head) = head else {
                plans.push(ResumePlan::NoChange {
                    stream: c.stream_id.clone(),
                });
                continue;
            };
            if c.seq > head {
                plans.push(ResumePlan::ProtocolError {
                    stream: c.stream_id.clone(),
                    head_seq: head,
                });
                continue;
            }
            let snapshot_seq: Option<i64> = self
                .conn
                .query_row(
                    "SELECT seq FROM snapshots WHERE stream_id = ?1 AND seq >= ?2",
                    params![c.stream_id, c.seq],
                    |row| row.get(0),
                )
                .optional()?;
            if let Some(snap_seq) = snapshot_seq {
                let mut stmt = self.conn.prepare(
                    "SELECT seq FROM events WHERE stream_id = ?1 AND seq > ?2 ORDER BY seq",
                )?;
                let seqs: Vec<i64> = stmt
                    .query_map(params![c.stream_id, snap_seq], |row| row.get(0))?
                    .filter_map(|r| r.ok())
                    .collect();
                plans.push(ResumePlan::SnapshotThenReplay {
                    stream: c.stream_id.clone(),
                    snapshot_seq: snap_seq,
                    seqs,
                });
                continue;
            }
            let mut stmt = self
                .conn
                .prepare("SELECT seq FROM events WHERE stream_id = ?1 AND seq > ?2 ORDER BY seq")?;
            let seqs: Vec<i64> = stmt
                .query_map(params![c.stream_id, c.seq], |row| row.get(0))?
                .filter_map(|r| r.ok())
                .collect();
            if seqs.is_empty() {
                plans.push(ResumePlan::NoChange {
                    stream: c.stream_id.clone(),
                });
            } else {
                plans.push(ResumePlan::Replay {
                    stream: c.stream_id.clone(),
                    seqs,
                });
            }
        }
        Ok(plans)
    }

    /// Journal view (seqs) — conformance helper.
    pub fn view_seqs(&mut self, stream: &str) -> rusqlite::Result<Vec<i64>> {
        let mut stmt = self
            .conn
            .prepare("SELECT seq FROM events WHERE stream_id = ?1 ORDER BY seq")?;
        let seqs: Vec<i64> = stmt
            .query_map(params![stream], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(seqs)
    }
}

impl Drop for SqliteJournal {
    fn drop(&mut self) {
        // Explicit WAL checkpoint so a copied main file is complete (doc 02
        // backup rule).
        let _ = self.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)", []);
    }
}

//! ompweb 5.0 Event Continuity oracle — Rust port of lib/continuity (doc 02 /
//! ADR-003). The TypeScript oracle in lib/continuity is the semantic
//! reference; this crate must behave identically on the shared conformance
//! script (lib/continuity/conformance-script.txt, see tests/conformance.rs).
//!
//! This is the conformance oracle for the future persistent host storage, not
//! production code yet (doc 06 migration slice 1–2).

/// v1 cursor: per-stream monotonic seq inside a host identity generation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EventCursor {
    pub host_epoch: String,
    pub stream_id: String,
    pub seq: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventClass {
    Reliable,
    Coalesced,
    Ephemeral,
}

impl EventClass {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "reliable" => Some(EventClass::Reliable),
            "coalesced" => Some(EventClass::Coalesced),
            "ephemeral" => Some(EventClass::Ephemeral),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Event {
    pub cursor: EventCursor,
    pub event_id: u64,
    pub kind: String,
    pub class: EventClass,
    pub payload_token: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClientCursor {
    pub stream_id: String,
    pub seq: i64,
}

/// Resume decision (doc 02 resume flow).
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

struct StreamState {
    next_seq: i64,
    events: Vec<Event>,
    snapshot_seq: Option<i64>,
    compacted_through: i64,
    tail: Vec<Event>,
    resuming: bool,
}

impl StreamState {
    fn new() -> Self {
        StreamState {
            next_seq: 1,
            events: Vec::new(),
            snapshot_seq: None,
            compacted_through: 0,
            tail: Vec::new(),
            resuming: false,
        }
    }
}

pub struct Journal {
    host_epoch: String,
    tail_buffer_max: usize,
    event_id_counter: u64,
    streams: std::collections::HashMap<String, StreamState>,
}

/// Placeholder used when a coalesced event replaces its family slot in place
/// (the previous value is taken out and dropped).
fn dummy_event() -> Event {
    Event {
        cursor: EventCursor {
            host_epoch: String::new(),
            stream_id: String::new(),
            seq: 0,
        },
        event_id: 0,
        kind: String::new(),
        class: EventClass::Ephemeral,
        payload_token: String::new(),
    }
}

pub struct JournalEvent<'a> {
    pub stream: &'a str,
    pub kind: &'a str,
    pub class: EventClass,
    pub payload_token: &'a str,
}

impl Journal {
    pub fn new(host_epoch: &str) -> Self {
        Journal {
            host_epoch: host_epoch.to_string(),
            tail_buffer_max: 1024,
            event_id_counter: 0,
            streams: std::collections::HashMap::new(),
        }
    }

    pub fn set_tail_max(&mut self, max: usize) {
        self.tail_buffer_max = max;
    }

    pub fn host_epoch(&self) -> &str {
        &self.host_epoch
    }

    fn stream(&mut self, id: &str) -> &mut StreamState {
        self.streams
            .entry(id.to_string())
            .or_insert_with(StreamState::new)
    }

    pub fn head_seq(&mut self, stream: &str) -> i64 {
        self.stream(stream).next_seq - 1
    }

    pub fn append(&mut self, ev: JournalEvent) {
        let stream_id = ev.stream.to_string();
        let tail_max = self.tail_buffer_max;
        let host_epoch = self.host_epoch.clone();
        self.event_id_counter += 1;
        let event_id = self.event_id_counter;
        let s = self.stream(&stream_id);
        let seq = s.next_seq;
        s.next_seq += 1;
        let mut event = Event {
            cursor: EventCursor {
                host_epoch,
                stream_id,
                seq,
            },
            event_id,
            kind: ev.kind.to_string(),
            class: ev.class,
            payload_token: ev.payload_token.to_string(),
        };
        let buffering = s.resuming;
        if event.class == EventClass::Ephemeral {
            if s.tail.len() >= tail_max {
                s.tail.remove(0);
            }
            s.tail.push(event);
            return;
        }
        if event.class == EventClass::Coalesced && !buffering {
            if let Some(idx) = s.events.iter().position(|e| {
                e.kind == event.kind
                    && e.class == EventClass::Coalesced
                    && e.cursor.seq > s.compacted_through
            }) {
                s.events[idx] = std::mem::replace(&mut event, dummy_event());
                return;
            }
        }
        if buffering {
            if s.tail.len() >= tail_max {
                s.tail.remove(0);
            }
            s.tail.push(event);
        } else {
            s.events.push(event);
        }
    }

    /// Compact at the current head: snapshot becomes the resume base.
    pub fn snapshot(&mut self, stream: &str, _state_version: i64) {
        let s = self.stream(stream);
        let seq = s.next_seq - 1;
        s.snapshot_seq = Some(seq);
        s.compacted_through = seq;
        s.events.retain(|e| e.cursor.seq > seq);
    }

    pub fn begin_resume(&mut self, stream: &str) {
        self.stream(stream).resuming = true;
    }

    /// Commit buffered non-ephemeral events; returns drained count.
    pub fn drain_tail(&mut self, stream: &str) -> usize {
        let s = self.stream(stream);
        s.resuming = false;
        let drained = s.tail.len();
        let mut tail = std::mem::take(&mut s.tail);
        tail.retain(|e| e.class != EventClass::Ephemeral);
        s.events.append(&mut tail);
        s.events.sort_by_key(|e| e.cursor.seq);
        drained
    }

    /// Resume decision for a client cursor set (doc 02 resume flow).
    pub fn resume(&mut self, client_epoch: &str, cursors: &[ClientCursor]) -> Vec<ResumePlan> {
        if client_epoch != self.host_epoch {
            return vec![ResumePlan::FullSnapshot];
        }
        let mut plans = Vec::new();
        for c in cursors {
            let s = self.stream(&c.stream_id);
            let head = s.next_seq - 1;
            if c.seq > head {
                plans.push(ResumePlan::ProtocolError {
                    stream: c.stream_id.clone(),
                    head_seq: head,
                });
                continue;
            }
            let snapshot_seq = if c.seq <= s.snapshot_seq.unwrap_or(i64::MIN) {
                s.snapshot_seq
            } else {
                None
            };
            match snapshot_seq {
                Some(snap_seq) => {
                    let seqs: Vec<i64> = s
                        .events
                        .iter()
                        .filter(|e| e.cursor.seq > snap_seq)
                        .map(|e| e.cursor.seq)
                        .collect();
                    plans.push(ResumePlan::SnapshotThenReplay {
                        stream: c.stream_id.clone(),
                        snapshot_seq: snap_seq,
                        seqs,
                    });
                }
                None => {
                    let seqs: Vec<i64> = s
                        .events
                        .iter()
                        .filter(|e| e.cursor.seq > c.seq)
                        .map(|e| e.cursor.seq)
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
            }
        }
        plans
    }

    /// Journal view (seqs) — conformance helper.
    pub fn view_seqs(&mut self, stream: &str) -> Vec<i64> {
        self.stream(stream)
            .events
            .iter()
            .map(|e| e.cursor.seq)
            .collect()
    }

    /// Head seq per stream (all streams) — RemoteRuntime sync_complete heads.
    pub fn view_seqs_multi(&mut self) -> Vec<(String, i64)> {
        let mut out = Vec::new();
        for (stream, state) in &mut self.streams {
            out.push((stream.clone(), state.next_seq - 1));
        }
        out
    }

    /// Events with seq greater than `from_seq`, oldest first — the replay
    /// source for the RemoteRuntime resume path (protocol v1 snapshot/event
    /// frames).
    pub fn events_after(&mut self, stream: &str, from_seq: i64) -> Vec<Event> {
        self.stream(stream)
            .events
            .iter()
            .filter(|e| e.cursor.seq > from_seq)
            .cloned()
            .collect()
    }

    /// All events of a stream, oldest first (full-snapshot replay).
    pub fn events_all(&mut self, stream: &str) -> Vec<Event> {
        self.stream(stream).events.clone()
    }
}

// ---------------------------------------------------------------------------
// Mutation receipt ledger (doc 02 idempotency boundary).
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MutationStatus {
    Accepted,
    Committed,
    Failed,
    Unknown,
}

#[derive(Clone, Debug)]
pub struct MutationRecord {
    pub request_hash: String,
    pub status: MutationStatus,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AcceptOutcome {
    Accepted,
    Duplicate,
    Conflict,
    RetentionExpired,
}

struct LedgerEntry {
    record: MutationRecord,
    recorded_at: i64,
}

pub struct MutationLedger {
    entries: std::collections::HashMap<String, LedgerEntry>,
    expired: std::collections::HashSet<String>,
    retention_ms: i64,
    tick: std::cell::Cell<i64>,
}

impl MutationLedger {
    pub fn new(retention_ms: i64) -> Self {
        MutationLedger {
            entries: std::collections::HashMap::new(),
            expired: std::collections::HashSet::new(),
            retention_ms,
            tick: std::cell::Cell::new(0),
        }
    }

    /// Set the idempotency retention window (ms). The TS equivalent defaults
    /// to 24h (lib/continuity/mutations.ts).
    pub fn set_retention(&mut self, retention_ms: i64) {
        self.retention_ms = retention_ms;
    }

    fn key(device: &str, msg_id: &str) -> String {
        format!("{}\u{0}{}", device, msg_id)
    }

    /// Deterministic test clock: each call advances 100ms.
    fn now(&self) -> i64 {
        let next = self.tick.get() + 100;
        self.tick.set(next);
        next
    }

    pub fn accept(&mut self, device: &str, msg_id: &str, hash: &str) -> AcceptOutcome {
        let key = MutationLedger::key(device, msg_id);
        if self.expired.contains(&key) {
            return AcceptOutcome::RetentionExpired;
        }
        let now = self.now();
        if let Some(entry) = self.entries.get(&key) {
            if now - entry.recorded_at > self.retention_ms {
                self.entries.remove(&key);
                self.expired.insert(key);
                return AcceptOutcome::RetentionExpired;
            }
            if entry.record.request_hash != hash {
                return AcceptOutcome::Conflict;
            }
            return AcceptOutcome::Duplicate;
        }
        self.entries.insert(
            key,
            LedgerEntry {
                record: MutationRecord {
                    request_hash: hash.to_string(),
                    status: MutationStatus::Accepted,
                },
                recorded_at: now,
            },
        );
        AcceptOutcome::Accepted
    }

    /// Retried acceptance of an UNKNOWN record with the same payload.
    pub fn reaccept_unknown(&mut self, device: &str, msg_id: &str, hash: &str) -> AcceptOutcome {
        let key = MutationLedger::key(device, msg_id);
        let Some(entry) = self.entries.get_mut(&key) else {
            return AcceptOutcome::RetentionExpired;
        };
        if entry.record.request_hash != hash {
            return AcceptOutcome::Conflict;
        }
        if entry.record.status != MutationStatus::Unknown {
            return AcceptOutcome::Duplicate;
        }
        entry.record.status = MutationStatus::Accepted;
        AcceptOutcome::Accepted
    }

    pub fn settle(&mut self, device: &str, msg_id: &str, status: MutationStatus) {
        let key = MutationLedger::key(device, msg_id);
        if let Some(entry) = self.entries.get_mut(&key) {
            entry.record.status = status;
        }
    }

    /// Read the recorded outcome for a duplicate retry (returns None when the
    /// receipt has aged out — callers then re-issue "unknown").
    pub fn record(&self, device: &str, msg_id: &str) -> Option<MutationRecord> {
        let key = MutationLedger::key(device, msg_id);
        self.entries.get(&key).map(|entry| entry.record.clone())
    }

    pub fn expire(&mut self, now: i64) -> usize {
        let mut removed = 0;
        let keys: Vec<String> = self
            .entries
            .iter()
            .filter(|(_, entry)| now - entry.recorded_at > self.retention_ms)
            .map(|(k, _)| k.clone())
            .collect();
        for k in keys {
            self.entries.remove(&k);
            self.expired.insert(k);
            removed += 1;
        }
        removed
    }
}

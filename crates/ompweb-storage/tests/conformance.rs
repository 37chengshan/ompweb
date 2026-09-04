//! Shared conformance script driven by the SQLite-backed journal (doc 06
//! slice 2): the same script that passes on the TypeScript oracle and the
//! in-memory Rust oracle must pass on persisted storage.

use ompweb_protocol::{AcceptOutcome, MutationLedger, MutationStatus};
use ompweb_storage::{ClientCursor, EventClass, ResumePlan, SqliteJournal};

fn run_script(text: &str) -> Result<(), String> {
    let mut journal = SqliteJournal::open_in_memory("epoch-1").map_err(|e| e.to_string())?;
    let mut ledger = MutationLedger::new(1000);
    let mut scenario = String::from("?");
    let mut pending_plans: Option<Vec<ResumePlan>> = None;
    let mut now_ms: i64 = 0;

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let tokens: Vec<&str> = line.split_whitespace().collect();
        let op = tokens[0];
        let args = &tokens[1..];
        let step = |e: rusqlite::Error| format!("{scenario} / {line}: {e}");
        match op {
            "scenario" => {
                scenario = args[0].to_string();
                journal = SqliteJournal::open_in_memory("epoch-1").map_err(|e| e.to_string())?;
                ledger = MutationLedger::new(1000);
                pending_plans = None;
            }
            "append" => {
                let class = EventClass::parse(args[2])
                    .unwrap_or_else(|| panic!("{scenario}: bad class {}", args[2]));
                now_ms += 10;
                journal
                    .append(args[0], args[1], class, args[3], now_ms)
                    .map_err(step)?;
            }
            "snapshot" => {
                now_ms += 10;
                journal
                    .snapshot(args[0], args[1].parse().unwrap(), now_ms)
                    .map_err(step)?;
            }
            "tail_max" => journal.set_tail_max(args[0].parse().unwrap()),
            "begin_resume" => journal.begin_resume(args[0]),
            "drain_tail" => {
                journal.drain_tail(args[0]);
            }
            "resume" => {
                let cursors: Vec<ClientCursor> = args[1]
                    .split(',')
                    .map(|pair| {
                        let i = pair.rfind(':').expect("cursor needs stream:seq");
                        ClientCursor {
                            stream_id: pair[..i].to_string(),
                            seq: pair[i + 1..].parse().unwrap(),
                        }
                    })
                    .collect();
                pending_plans = Some(journal.resume(args[0], &cursors).map_err(step)?);
            }
            "expect_plan" => {
                let kind = args[0];
                let stream = args[1];
                let seq_list = args.get(2).copied().unwrap_or("-");
                let plans = pending_plans
                    .as_ref()
                    .ok_or_else(|| format!("{scenario}: no resume ran before expect_plan"))?;
                let plan = plans
                    .iter()
                    .find(|p| plan_matches(p, kind, stream))
                    .ok_or_else(|| {
                        format!("{scenario}: expected {kind} for {stream}, got {plans:?}")
                    })?;
                if seq_list != "-" {
                    let expected: Vec<i64> =
                        seq_list.split(',').map(|s| s.parse().unwrap()).collect();
                    assert_eq!(plan_seqs(plan), expected, "{scenario}: {kind} replay seqs");
                }
            }
            "view" => {
                let actual = journal.view_seqs(args[0]).map_err(step)?;
                let expected: Vec<i64> = args[1].split(',').map(|s| s.parse().unwrap()).collect();
                assert_eq!(actual, expected, "{scenario}: view for {}", args[0]);
            }
            "accept" => {
                let outcome = ledger.accept(args[0], args[1], args[2]);
                assert_eq!(
                    outcome,
                    parse_outcome(args[3]),
                    "{scenario}: accept {}",
                    args[1]
                );
            }
            "reaccept" => {
                let outcome = ledger.reaccept_unknown(args[0], args[1], args[2]);
                assert_eq!(
                    outcome,
                    parse_outcome(args[3]),
                    "{scenario}: reaccept {}",
                    args[1]
                );
            }
            "settle" => {
                let status = match args[2] {
                    "committed" => MutationStatus::Committed,
                    "failed" => MutationStatus::Failed,
                    "unknown" => MutationStatus::Unknown,
                    other => panic!("{scenario}: bad settle status {other}"),
                };
                ledger.settle(args[0], args[1], status);
            }
            "expire" => {
                ledger.expire(args[0].parse().unwrap());
            }
            other => return Err(format!("{scenario}: unknown op {other}")),
        }
    }
    Ok(())
}

fn plan_matches(plan: &ResumePlan, kind: &str, stream: &str) -> bool {
    let (actual_kind, actual_stream) = match plan {
        ResumePlan::FullSnapshot => ("FULL_SNAPSHOT", None),
        ResumePlan::ProtocolError { stream, .. } => ("PROTOCOL_ERROR", Some(stream)),
        ResumePlan::SnapshotThenReplay { stream, .. } => ("SNAPSHOT_THEN_REPLAY", Some(stream)),
        ResumePlan::Replay { stream, .. } => ("REPLAY", Some(stream)),
        ResumePlan::NoChange { stream } => ("NO_CHANGE", Some(stream)),
    };
    actual_kind == kind && actual_stream.map(|s| s == stream).unwrap_or(stream == "-")
}

fn plan_seqs(plan: &ResumePlan) -> Vec<i64> {
    match plan {
        ResumePlan::Replay { seqs, .. } | ResumePlan::SnapshotThenReplay { seqs, .. } => {
            seqs.clone()
        }
        _ => Vec::new(),
    }
}

fn parse_outcome(s: &str) -> AcceptOutcome {
    match s {
        "accepted" => AcceptOutcome::Accepted,
        "duplicate" => AcceptOutcome::Duplicate,
        "conflict" => AcceptOutcome::Conflict,
        "retention_expired" => AcceptOutcome::RetentionExpired,
        other => panic!("bad outcome {other}"),
    }
}

#[test]
fn shared_conformance_script_passes_on_sqlite_storage() {
    let script = include_str!("../../../lib/continuity/conformance-script.txt");
    run_script(script).expect("conformance script must pass on SQLite-backed storage");
}

#[test]
fn file_backed_storage_survives_reopen() {
    let dir = tempfile_dir();
    let db = format!("{}/journal.db", dir);
    {
        let mut journal = SqliteJournal::open(&db, "epoch-1").unwrap();
        journal
            .append("session:s1", "agent_start", EventClass::Reliable, "p1", 1)
            .unwrap();
        journal
            .append("session:s1", "presence", EventClass::Ephemeral, "p2", 2)
            .unwrap();
    }
    let mut journal = SqliteJournal::open(&db, "epoch-1").unwrap();
    // Reopen keeps the authoritative epoch and committed rows; the ephemeral
    // row is gone exactly as documented.
    assert_eq!(journal.host_epoch(), "epoch-1");
    let plans = journal
        .resume(
            "epoch-1",
            &[ClientCursor {
                stream_id: "session:s1".into(),
                seq: 0,
            }],
        )
        .unwrap();
    match &plans[0] {
        ResumePlan::Replay { seqs, .. } => assert_eq!(seqs, &[1]),
        other => panic!("expected replay, got {other:?}"),
    }
    let _ = std::fs::remove_file(&db);
}

fn tempfile_dir() -> String {
    let base = std::env::temp_dir();
    let dir = base.join(format!("ompweb-storage-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir.to_string_lossy().to_string()
}

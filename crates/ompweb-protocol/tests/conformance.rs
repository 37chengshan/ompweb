//! Shared conformance script runner (doc 06 slice 1): the SAME script drives
//! the TypeScript oracle (lib/continuity.test.mjs) and this Rust port. Any
//! divergence between the two implementations fails here.

use ompweb_protocol::{
    AcceptOutcome, ClientCursor, EventClass, Journal, MutationLedger, MutationStatus, ResumePlan,
};

fn run_script(text: &str) -> Result<(), String> {
    let mut journal = Journal::new("epoch-1");
    let mut ledger = MutationLedger::new(1000);
    let mut scenario = String::from("?");
    let mut pending_plans: Option<Vec<ResumePlan>> = None;

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let tokens: Vec<&str> = line.split_whitespace().collect();
        let op = tokens[0];
        let args = &tokens[1..];
        match op {
            "scenario" => {
                scenario = args[0].to_string();
                journal = Journal::new("epoch-1");
                ledger = MutationLedger::new(1000);
                pending_plans = None;
            }
            "append" => {
                let class = EventClass::parse(args[2])
                    .unwrap_or_else(|| panic!("{scenario}: bad class {}", args[2]));
                journal.append(ompweb_protocol::JournalEvent {
                    stream: args[0],
                    kind: args[1],
                    class,
                    payload_token: args[3],
                });
            }
            "snapshot" => {
                journal.snapshot(args[0], args[1].parse::<i64>().unwrap());
            }
            "tail_max" => {
                journal.set_tail_max(args[0].parse::<usize>().unwrap());
            }
            "begin_resume" => {
                journal.begin_resume(args[0]);
            }
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
                pending_plans = Some(journal.resume(args[0], &cursors));
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
                        format!("{scenario}: expected plan {kind} for {stream}, got {plans:?}")
                    })?;
                if seq_list != "-" {
                    let expected: Vec<i64> =
                        seq_list.split(',').map(|s| s.parse().unwrap()).collect();
                    let actual = plan_seqs(plan);
                    assert_eq!(
                        actual, expected,
                        "{scenario}: {kind} replay seqs for {stream}"
                    );
                }
            }
            "view" => {
                let actual = journal.view_seqs(args[0]);
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
            other => return Err(format!("{scenario}: unknown conformance op {other}")),
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
fn shared_conformance_script_passes_on_the_rust_oracle() {
    let script = include_str!("../../../lib/continuity/conformance-script.txt");
    run_script(script).expect("conformance script must pass on the Rust oracle");
}

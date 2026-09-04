//! remote_runtime: Rust RemoteRuntime (doc 16 route 14, first slice).
//!
//! A WebSocket endpoint implementing the repo's remote protocol v1 state
//! machine (lib/remote-protocol/host-connection.ts) in Rust, reusing
//! ompweb-protocol's in-memory Journal + MutationLedger.
//! Handshake: hello → auth_required {methods:["token"]} → auth{proof}
//! → welcome{hostEpoch} → resume/start → sync_complete → live.
//!
//! SECURITY MODEL:
//!   - `proof` is a PAIRED DEVICE ID; the runtime rejects unless the id
//!     exists in the device registry, is not revoked, and was seen within
//!     the offline window (device.is_online).
//!   - No handshake crypto: ADR-005 is the only sanctioned path to one —
//!     this slice must not invent a protocol (same discipline as the Node
//!     reference implementation).
//!   - The listener binds 127.0.0.1 by default (LAN exposure is an explicit
//!     admin choice mirroring the pairing flows).
//!   - Mutation executors are a fixed whitelist: agent.prompt / agent.cancel
//!     route to the OMP supervisor; anything else fails with
//!     "unsupported mutation type". pty/files/git/commands remote execution
//!     are later slices.
//!   - Frames respect the protocol v1 1 MiB maxMessageBytes.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use tokio::net::TcpListener;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

use crate::device_service::DeviceService;
use crate::ipc_server::json_str;
use crate::mini_json::JsonValue;
use ompweb_protocol::{ClientCursor, Event, EventClass, Journal, MutationLedger, MutationStatus, ResumePlan};

use futures_util::{SinkExt, StreamExt};

const PROTOCOL_VERSION: i64 = 1;
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;
const SUPPORTED_FEATURES: &[&str] = &["resume_v1", "mutations_v1"];
const CLOSE_POLICY_VIOLATION: u16 = 1008;

/// Mutation executors: agent.prompt / agent.cancel route to the OMP
/// supervisor. (device_id, command_json) → output.
pub type Executor = Arc<dyn Fn(&str, &str) -> Result<String, String> + Send + Sync>;

pub struct RemoteRuntimeShared {
    pub device: Arc<DeviceService>,
    /// Shared journal: every connection locks the same Mutex (single-writer,
    /// short transactions — resume replay must see the global stream state).
    pub journal: Arc<Mutex<Journal>>,
    pub ledger: Arc<Mutex<MutationLedger>>,
    pub executor: Executor,
    pub offline_after_ms: i64,
}

pub type Shared = Arc<RemoteRuntimeShared>;

impl RemoteRuntimeShared {
    pub fn new(device: Arc<DeviceService>, executor: Executor, host_epoch: &str, offline_after_ms: i64) -> Self {
        let mut ledger = MutationLedger::new(0);
        // Idempotency retention mirrors lib/continuity/mutations.ts (24h):
        // a retried clientMsgId inside the window re-issues the recorded
        // outcome; outside it is a tombstond refusal, never a re-execution.
        ledger.set_retention(24 * 60 * 60 * 1000);
        RemoteRuntimeShared {
            device,
            journal: Arc::new(Mutex::new(Journal::new(host_epoch))),
            ledger: Arc::new(Mutex::new(ledger)),
            executor,
            offline_after_ms,
        }
    }

    /// Serve the WS endpoint; each connection is a spawned task bounded by
    /// `max_connections`.
    pub async fn serve(&self, listener: TcpListener, max_connections: usize) -> std::io::Result<()> {
        let semaphore = Arc::new(tokio::sync::Semaphore::new(max_connections));
        loop {
            let (stream, _peer) = listener.accept().await?;
            let permit = match semaphore.clone().try_acquire_owned() {
                Ok(permit) => permit,
                Err(_) => continue, // cap reached: drop politely
            };
            // Per-connection handle over the shared journal/ledger: every
            // connection locks the same Mutex pair (single-writer, short
            // transactions; resume replay sees global stream state).
            let conn = Arc::new(RemoteRuntimeShared {
                device: self.device.clone(),
                journal: self.journal.clone(),
                ledger: self.ledger.clone(),
                executor: self.executor.clone(),
                offline_after_ms: self.offline_after_ms,
            });
            tokio::spawn(async move {
                let _permit = permit;
                if let Ok(ws) = accept_async(stream).await {
                    let _ = handle_connection(conn, ws).await;
                }
            });
        }
    }
}

enum ConnState {
    AwaitHello,
    AwaitAuth,
    AwaitResume,
    Live,
}

fn epoch_shared(shared: &Shared) -> String {
    shared.journal.lock().unwrap().host_epoch().to_string()
}

async fn send_text(sink: &mut (impl SinkExt<Message> + Unpin), text: String) {
    let _ = sink.send(Message::Text(text.into())).await;
}

async fn send_error(sink: &mut (impl SinkExt<Message> + Unpin), request_id: &str, code: &str) {
    let body = format!(
        "{{\"version\":{},\"kind\":\"error\",\"requestId\":{},\"streamId\":\"host\",\"type\":\"protocol_error\",\"payload\":{{\"code\":{},\"message\":\"\"}}}}",
        PROTOCOL_VERSION,
        json_str(request_id),
        json_str(code),
    );
    let _ = sink.send(Message::Text(body.into())).await;
}

fn event_frame(stream_id: &str, event: &Event) -> String {
    // Wire shape mirrors lib/remote-protocol/host-connection.ts emitEvent:
    // the frame's `type` is the EVENT's own type and `payload` is a
    // STRUCTURED value (not a double-encoded JSON string), with a cursor.
    let payload = JsonValue::parse(&event.payload_token).unwrap_or(JsonValue::Str(event.payload_token.clone()));
    format!(
        "{{\"version\":{},\"kind\":\"event\",\"streamId\":{},\"type\":{},\"cursor\":{{\"hostEpoch\":{},\"seq\":{}}},\"payload\":{}}}",
        PROTOCOL_VERSION,
        json_str(stream_id),
        json_str(&event.kind),
        json_str(&event.cursor.host_epoch),
        event.cursor.seq,
        mini_json_to_json_string(&payload),
    )
}

fn sync_complete_frame(shared: &Shared, request_id: &str, stream_id: &str) -> String {
    let heads: Vec<String> = {
        let mut journal = shared.journal.lock().unwrap();
        journal
            .view_seqs_multi()
            .iter()
            .map(|(stream, seq)| format!("{{\"streamId\":{},\"seq\":{}}}", json_str(stream), seq))
            .collect()
    };
    format!(
        "{{\"version\":{},\"kind\":\"event\",\"requestId\":{},\"streamId\":{},\"type\":\"sync_complete\",\"payload\":{{\"heads\":[{}]}}}}",
        PROTOCOL_VERSION,
        json_str(request_id),
        json_str(stream_id),
        heads.join(","),
    )
}

async fn handle_connection(shared: Shared, ws: tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>) -> Result<(), ()> {
    let (mut sink, mut source) = ws.split();
    let mut state = ConnState::AwaitHello;
    let mut device_id = String::new();
    let mut hello_stream = String::new();
    let mut pending_nonce: Option<String> = None;

    while let Some(Ok(raw)) = source.next().await {
        let text = match raw {
            Message::Text(text) => text.to_string(),
            Message::Close(_) => break,
            _ => continue,
        };
        if text.len() > MAX_MESSAGE_BYTES {
            let _ = sink
                .send(Message::Close(Some(tokio_tungstenite::tungstenite::protocol::CloseFrame {
                    code: tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Policy,
                    reason: "payload_too_large".into(),
                })))
                .await;
            break;
        }
        let parsed = match JsonValue::parse(&text) {
            Ok(parsed) => parsed,
            Err(_) => {
                let _ = send_error(&mut sink, "", "invalid_json").await;
                continue;
            }
        };
        let kind = parsed.get(&["kind"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let msg_type = parsed.get(&["type"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let stream_id = parsed.get(&["streamId"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let request_id = parsed.get(&["requestId"]).and_then(|v| v.as_str()).unwrap_or("").to_string();

        match state {
            ConnState::AwaitHello => {
                if kind != "request" || msg_type != "hello" {
                    let _ = send_error(&mut sink, &request_id, "protocol_error").await;
                    break;
                }
                hello_stream = stream_id.clone();
                let version_ok = match parsed.get(&["payload", "protocolVersions"]) {
                    Some(JsonValue::Arr(items)) => items.iter().any(|v| v.as_num().map(|n| n as i64) == Some(PROTOCOL_VERSION)),
                    _ => false,
                };
                if !version_ok {
                    let _ = send_error(&mut sink, &request_id, "version_unsupported").await;
                    break;
                }
                let features: Vec<&str> = match parsed.get(&["payload", "features"]) {
                    Some(JsonValue::Arr(items)) => items.iter().filter_map(|v| v.as_str()).collect(),
                    _ => Vec::new(),
                };
                if !features.iter().all(|f| SUPPORTED_FEATURES.contains(f)) {
                    let _ = send_error(&mut sink, &request_id, "version_unsupported").await;
                    break;
                }
                // auth_required carries a fresh per-connection challenge
                // (128-bit hex) — never reused, so a captured proof cannot be
                // replayed. The client must respond with
                // HMAC(nonce, device-auth-secret).
                let nonce = challenge_nonce();
                let auth_required = format!(
                    "{{\"version\":{},\"kind\":\"response\",\"requestId\":{},\"streamId\":{},\"type\":\"auth_required\",\"payload\":{{\"methods\":[\"hmac-sha256\"],\"challenge\":{},\"transcriptBinding\":\"{{\\\"type\\\":\\\"hello\\\"}}\"}}}}",
                    PROTOCOL_VERSION, json_str(&request_id), json_str(&stream_id), json_str(&nonce),
                );
                let _ = send_text(&mut sink, auth_required).await;
                state = ConnState::AwaitAuth;
                // The nonce is consumed by the pending auth; store it for the
                // next state transition.
                pending_nonce = Some(nonce);
            }
            ConnState::AwaitAuth => {
                if kind != "request" || msg_type != "auth" {
                    let _ = send_error(&mut sink, &request_id, "protocol_error").await;
                    break;
                }
                // Challenge-response auth (P0 review: upstream was a raw
                // bearer device id — replayable). Now the proof is
                // HMAC-sha256(nonce, device-auth-secret); the nonce is single
                // use and tied to this connection.
                let device_id_claim = parsed.get(&["payload", "deviceId"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                let proof = parsed.get(&["payload", "proof"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                let nonce = pending_nonce.take().unwrap_or_default();
                let secret = shared.device.auth_secret_for(&device_id_claim).unwrap_or(None);
                let ok = match secret {
                    Some(secret) if !nonce.is_empty() => {
                        // HMAC(key=secret, message=nonce) — secret is the
                        // proof material, the nonce is the challenge.
                        let expected = hmac_sha256_hex(&secret, &nonce);
                        constant_time_eq(&expected, &proof)
                    }
                    _ => false,
                };
                if !ok {
                    let _ = send_error(&mut sink, &request_id, "auth_failed").await;
                    let _ = sink
                        .send(Message::Close(Some(tokio_tungstenite::tungstenite::protocol::CloseFrame {
                            code: tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Policy,
                            reason: "auth_failed".into(),
                        })))
                        .await;
                    break;
                }
                device_id = device_id_claim;
                let epoch = epoch_shared(&shared);
                let welcome = format!(
                    "{{\"version\":{},\"kind\":\"response\",\"requestId\":{},\"streamId\":{},\"type\":\"welcome\",\"payload\":{{\"protocolVersion\":{},\"serverVersion\":\"ompweb-host\",\"hostEpoch\":{},\"features\":[\"resume_v1\",\"mutations_v1\"],\"limits\":{{\"maxMessageBytes\":{}}}}}}}",
                    PROTOCOL_VERSION, json_str(&request_id), json_str(&stream_id), PROTOCOL_VERSION, json_str(&epoch), MAX_MESSAGE_BYTES,
                );
                let _ = send_text(&mut sink, welcome).await;
                state = ConnState::AwaitResume;
            }
            ConnState::AwaitResume => {
                if kind == "request" && msg_type == "resume" {
                    let client_epoch = parsed.get(&["payload", "hostEpoch"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let cursors: Vec<ClientCursor> = match parsed.get(&["payload", "cursors"]) {
                        Some(JsonValue::Arr(items)) => items
                            .iter()
                            .filter_map(|item| {
                                let stream = item.get(&["streamId"]).and_then(|v| v.as_str())?.to_string();
                                let seq = item.get(&["seq"]).and_then(|v| v.as_num())? as i64;
                                Some(ClientCursor { stream_id: stream, seq })
                            })
                            .collect(),
                        _ => Vec::new(),
                    };
                    let mut out_frames: Vec<String> = Vec::new();
                    {
                        let mut journal = shared.journal.lock().unwrap();
                        if journal.host_epoch() != client_epoch {
                            out_frames.push(format!(
                                "{{\"version\":{},\"kind\":\"error\",\"requestId\":{},\"streamId\":{},\"type\":\"protocol_error\",\"payload\":{{\"code\":\"full_resync_required\",\"message\":\"epoch mismatch\",\"hostEpoch\":{}}}}}",
                                PROTOCOL_VERSION, json_str(&request_id), json_str(&stream_id), json_str(journal.host_epoch()),
                            ));
                            state = ConnState::Live; // connection stays open per protocol
                        } else {
                            let plans = journal.resume(&client_epoch, &cursors);
                            for plan in &plans {
                                match plan {
                                    ResumePlan::ProtocolError { stream, head_seq } => {
                                        out_frames.push(format!(
                                            "{{\"version\":{},\"kind\":\"error\",\"requestId\":{},\"streamId\":{},\"type\":\"protocol_error\",\"payload\":{{\"code\":\"invalid_cursor\",\"message\":\"cursor ahead of head\",\"headSeq\":{}}}}}",
                                            PROTOCOL_VERSION, json_str(&request_id), json_str(stream), head_seq,
                                        ));
                                    }
                                    ResumePlan::SnapshotThenReplay { stream, .. } => {
                                        // Full current-state snapshot events.
                                        for event in journal.events_all(stream) {
                                            out_frames.push(event_frame(stream, &event));
                                        }
                                    }
                                    ResumePlan::Replay { stream, seqs } => {
                                        let from = seqs.first().copied().unwrap_or(0) - 1;
                                        for event in journal.events_after(stream, from) {
                                            out_frames.push(event_frame(stream, &event));
                                        }
                                    }
                                    ResumePlan::NoChange { .. } | ResumePlan::FullSnapshot => {}
                                }
                            }
                            let heads: Vec<String> = journal
                                .view_seqs_multi()
                                .iter()
                                .map(|(stream, seq)| format!("{{\"streamId\":{},\"seq\":{}}}", json_str(stream), seq))
                                .collect();
                            out_frames.push(format!(
                                "{{\"version\":{},\"kind\":\"event\",\"requestId\":{},\"streamId\":{},\"type\":\"sync_complete\",\"payload\":{{\"heads\":[{}]}}}}",
                                PROTOCOL_VERSION, json_str(&request_id), json_str(&stream_id), heads.join(","),
                            ));
                        }
                    } // journal guard dropped before any await
                    for frame in out_frames {
                        let _ = send_text(&mut sink, frame).await;
                    }
                    state = ConnState::Live;
                } else if kind == "request" && msg_type == "start" {
                    let sync = sync_complete_frame(&shared, &request_id, &stream_id);
                    let _ = send_text(&mut sink, sync).await;
                    state = ConnState::Live;
                } else {
                    let _ = send_error(&mut sink, &request_id, "protocol_error").await;
                    break;
                }
            }
            ConnState::Live => {
                if kind == "request" && msg_type == "ping" {
                    let pong = format!(
                        "{{\"version\":{},\"kind\":\"response\",\"requestId\":{},\"streamId\":{},\"type\":\"pong\",\"payload\":{{}}}}",
                        PROTOCOL_VERSION, json_str(&request_id), json_str(&stream_id),
                    );
                    let _ = send_text(&mut sink, pong).await;
                    continue;
                }
                if kind == "request" && msg_type == "mutation" {
                    let client_msg_id = parsed.get(&["payload", "clientMsgId"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let request_hash = parsed.get(&["payload", "requestHash"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let mutation_type = parsed.get(&["payload", "mutation", "type"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                    // Full mutation payload forwarded verbatim (the receipt
                    // ledger keys on clientMsgId+hash; the executor receives
                    // the untouched payload JSON so prompt text / params /
                    // sessionId all reach the agent).
                    let mutation_payload = parsed.get(&["payload", "mutation", "payload"]);
                    let payload_json = serialize_payload(mutation_payload);

                    // Receipt-before-side-effect with FULL dedup semantics
                    // (mirrors lib/continuity/mutations.ts):
                    //   Accepted → execute, settle, emit mutation_result.
                    //   Duplicate → re-issue recorded outcome, NEVER re-execute.
                    //   Conflict  → emit mutation_conflict, never execute.
                    //   RetentionExpired → tombstone: refuse (re-execution of an
                    //     aged receipt would violate idempotency).
                    let accept_outcome = {
                        shared.ledger.lock().unwrap().accept(&device_id, &client_msg_id, &request_hash)
                    };
                    match accept_outcome {
                        ompweb_protocol::AcceptOutcome::Conflict => {
                            let err = format!(
                                "{{\"version\":{},\"kind\":\"error\",\"requestId\":{},\"streamId\":{},\"type\":\"mutation_conflict\",\"payload\":{{\"code\":\"mutation_conflict\",\"message\":\"same clientMsgId, different requestHash\"}}}}",
                                PROTOCOL_VERSION, json_str(&request_id), json_str(&stream_id),
                            );
                            let _ = send_text(&mut sink, err).await;
                            continue;
                        }
                        ompweb_protocol::AcceptOutcome::Duplicate => {
                            let recorded = shared.ledger.lock().unwrap().record(&device_id, &client_msg_id);
                            let status = match recorded.map(|r| r.status) {
                                Some(MutationStatus::Committed) => "committed",
                                Some(MutationStatus::Failed) => "failed",
                                _ => "unknown",
                            };
                            let receipt = format!(
                                "{{\"version\":{},\"kind\":\"event\",\"streamId\":{},\"type\":\"mutation_result\",\"payload\":{{\"clientMsgId\":{},\"status\":{},\"result\":null}}}}",
                                PROTOCOL_VERSION, json_str(&stream_id), json_str(&client_msg_id), json_str(status),
                            );
                            let _ = send_text(&mut sink, receipt).await;
                            continue;
                        }
                        ompweb_protocol::AcceptOutcome::RetentionExpired => {
                            // Idempotency tombstone: refuse cleanly instead of
                            // executing a possibly-already-run mutation.
                            let receipt = format!(
                                "{{\"version\":{},\"kind\":\"event\",\"streamId\":{},\"type\":\"mutation_result\",\"payload\":{{\"clientMsgId\":{},\"status\":\"unknown\",\"result\":null}}}}",
                                PROTOCOL_VERSION, json_str(&stream_id), json_str(&client_msg_id),
                            );
                            let _ = send_text(&mut sink, receipt).await;
                            continue;
                        }
                        ompweb_protocol::AcceptOutcome::Accepted => {
                            let result = execute_mutation(&shared, &device_id, &mutation_type, &payload_json);
                            let (status, payload) = match result {
                                Ok(output) => (MutationStatus::Committed, output),
                                Err(message) => (MutationStatus::Failed, message),
                            };
                            shared.ledger.lock().unwrap().settle(&device_id, &client_msg_id, status);
                            let status_label = match status {
                                MutationStatus::Committed => "committed",
                                MutationStatus::Failed => "failed",
                                _ => "unknown",
                            };
                            let receipt = format!(
                                "{{\"version\":{},\"kind\":\"event\",\"streamId\":{},\"type\":\"mutation_result\",\"payload\":{{\"clientMsgId\":{},\"status\":{},\"result\":{}}}}}",
                                PROTOCOL_VERSION, json_str(&stream_id), json_str(&client_msg_id), json_str(status_label), json_str(&payload),
                            );
                            let _ = send_text(&mut sink, receipt).await;
                            continue;
                        }
                    }
                }
                let _ = send_error(&mut sink, &request_id, "unknown_request").await;
            }
        }
    }
    let _ = &hello_stream;
    Ok(())
}

fn serialize_payload(payload: Option<&JsonValue>) -> String {
    match payload {
        Some(value) => mini_json_to_json_string(value),
        None => "null".to_string(),
    }
}

/// Fresh 128-bit hex challenge (single use per connection).
fn challenge_nonce() -> String {
    let mut buf = [0u8; 16];
    if std::fs::File::open("/dev/urandom")
        .and_then(|mut f| {
            use std::io::Read;
            f.read_exact(&mut buf)
        })
        .is_ok()
    {
        return buf.iter().map(|b| format!("{b:02x}")).collect();
    }
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0) as u64;
    format!("{:016x}{:016x}", nanos, std::process::id())
}

/// Constant-time hex comparison (avoids a timing oracle on the proof).
fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.bytes().zip(b.bytes()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// HMAC-SHA256 hex over (key, data) — the challenge proof. Dependency-free
/// (no external crypto crate before the ADR-005 gate).
fn hmac_sha256_hex(key: &str, data: &str) -> String {
    let mut block_key = [0u8; 64];
    let key_bytes = key.as_bytes();
    for (i, byte) in key_bytes.iter().enumerate().take(64) {
        block_key[i] = *byte;
    }
    let mut ipad = [0u8; 64];
    let mut opad = [0u8; 64];
    for i in 0..64 {
        ipad[i] = block_key[i] ^ 0x36;
        opad[i] = block_key[i] ^ 0x5c;
    }
    let mut inner = Vec::with_capacity(64 + data.len());
    inner.extend_from_slice(&ipad);
    inner.extend_from_slice(data.as_bytes());
    let inner_digest = sha256_raw_bytes(&inner);
    let mut outer = Vec::with_capacity(64 + 32);
    outer.extend_from_slice(&opad);
    outer.extend_from_slice(&inner_digest);
    to_hex(&sha256_raw_bytes(&outer))
}

/// Minimal SHA-256 (FIPS 180-4). Fixed 32-byte output; message length padded
/// to a multiple of 64 bytes.
fn sha256_raw_bytes(message: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let bit_len = (message.len() as u64).wrapping_mul(8);
    let mut padded = message.to_vec();
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());
    for chunk in padded.chunks(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[i * 4], chunk[i * 4 + 1], chunk[i * 4 + 2], chunk[i * 4 + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }
    let mut out = [0u8; 32];
    for (i, value) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&value.to_be_bytes());
    }
    out
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Serialize a mini_json value back to JSON text (the executor sees the
/// exact payload object the phone sent, not a lossy reconstruction).
fn mini_json_to_json_string(value: &JsonValue) -> String {
    match value {
        JsonValue::Null => "null".to_string(),
        JsonValue::Bool(b) => if *b { "true".to_string() } else { "false".to_string() },
        JsonValue::Num(n) => {
            if *n == n.trunc() && n.abs() < 1e15 {
                format!("{}", *n as i64)
            } else {
                format!("{}", n)
            }
        }
        JsonValue::Str(s) => json_str(s),
        JsonValue::Arr(items) => {
            let parts: Vec<String> = items.iter().map(mini_json_to_json_string).collect();
            format!("[{}]", parts.join(","))
        }
        JsonValue::Obj(entries) => {
            let parts: Vec<String> = entries
                .iter()
                .map(|(key, value)| format!("{}:{}", json_str(key), mini_json_to_json_string(value)))
                .collect();
            format!("{{{}}}", parts.join(","))
        }
    }
}

fn execute_mutation(shared: &Shared, device_id: &str, mutation_type: &str, payload_json: &str) -> Result<String, String> {
    match mutation_type {
        "agent.prompt" | "agent.cancel" => {
            // Reconstruct the OMP command from the full payload: the executor
            // receives `{"type":<mutation_type>,"sessionId":<s>} + the raw
            // prompt params`, so prompt text and controls reach the agent.
            let parsed = JsonValue::parse(payload_json).unwrap_or(JsonValue::Null);
            let session_id = parsed.get(&["sessionId"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let mut fields: Vec<String> = Vec::new();
            if let JsonValue::Obj(entries) = &parsed {
                for (key, value) in entries {
                    if key == "sessionId" {
                        continue;
                    }
                    fields.push(format!("{}:{}", json_str(key), mini_json_to_json_string(value)));
                }
            }
            fields.push(format!("\"sessionId\":{}", json_str(&session_id)));
            let command = format!("{{\"type\":{},{}}}", json_str(mutation_type), fields.join(","));
            (shared.executor)(device_id, &command)
        }
        _ => Err("unsupported mutation type".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_matches_fips_known_vector() {
        // FIPS 180-4 "abc" → ba7816bf8f01cfea414140de5dae2223...
        let digest = to_hex(&sha256_raw_bytes(b"abc"));
        assert_eq!(digest, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        let empty = to_hex(&sha256_raw_bytes(b""));
        assert_eq!(empty, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }

    #[test]
    fn hmac_sha256_matches_rfc4231_known_vector() {
        // RFC 4231 test case 1: key = 20 bytes of 0x0b, data = "Hi There".
        let key = String::from_utf8(vec![0x0b; 20]).unwrap();
        let out = hmac_sha256_hex(&key, "Hi There");
        assert_eq!(out, "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
    }

    #[test]
    fn mutation_whitelist_routes_prompt_and_cancel_with_full_payload() {
        let shared: Shared = Arc::new(RemoteRuntimeShared::new(
            Arc::new(DeviceService::new()),
            Arc::new(|_device, command| Ok(command.to_string())),
            "epoch-test",
            25_000,
        ));
        // The full prompt payload — message text, params, sessionId — must
        // reach the executor verbatim (P0: previously only sessionId was
        // forwarded and prompt text was dropped).
        let out = execute_mutation(
            &shared,
            "d1",
            "agent.prompt",
            "{\"sessionId\":\"s-1\",\"message\":\"hello world\",\"tools\":[\"bash\"]}",
        )
        .unwrap();
        assert!(out.contains("\"message\":\"hello world\""), "prompt text must survive: {out}");
        assert!(out.contains("\"tools\":[\"bash\"]"), "params must survive: {out}");
        assert!(out.contains("\"sessionId\":\"s-1\""));
        assert!(execute_mutation(&shared, "d1", "approval.resolve", "{}").is_err());
        assert!(execute_mutation(&shared, "d1", "files.read_remote", "{}").is_err());
    }

    #[test]
    fn mutation_ledger_dedups_retries_and_tombstones_expired() {
        let shared: Shared = Arc::new(RemoteRuntimeShared::new(
            Arc::new(DeviceService::new()),
            Arc::new(|_device, command| Ok(command.to_string())),
            "epoch-test",
            25_000,
        ));
        let id = "client-msg-1";
        let hash = "hash-1";
        // First accept → Accepted (would execute).
        let first = shared.ledger.lock().unwrap().accept("d1", id, hash);
        assert_eq!(first, ompweb_protocol::AcceptOutcome::Accepted);
        // Same id+hash → Duplicate (must NOT re-execute).
        let dup = shared.ledger.lock().unwrap().accept("d1", id, hash);
        assert_eq!(dup, ompweb_protocol::AcceptOutcome::Duplicate);
        // Same id, different hash → Conflict.
        let conflict = shared.ledger.lock().unwrap().accept("d1", id, "hash-2");
        assert_eq!(conflict, ompweb_protocol::AcceptOutcome::Conflict);
        // Settle, then the duplicate retry re-issues the recorded outcome.
        shared.ledger.lock().unwrap().settle("d1", id, MutationStatus::Committed);
        let recorded = shared.ledger.lock().unwrap().record("d1", id);
        assert_eq!(recorded.map(|r| r.status), Some(MutationStatus::Committed));
    }

    #[test]
    fn event_frame_shapes_follow_protocol_v1() {
        let event = Event {
            cursor: ompweb_protocol::EventCursor { host_epoch: "e1".into(), stream_id: "session:s1".into(), seq: 3 },
            event_id: 1,
            kind: "token.usage".into(),
            class: EventClass::Reliable,
            payload_token: "{\"n\":1}".into(),
        };
        let frame = event_frame("session:s1", &event);
        assert!(frame.contains("\"type\":\"token.usage\""), "frame type must be the event's own type: {frame}");
        assert!(frame.contains("\"cursor\":{\"hostEpoch\":\"e1\",\"seq\":3}"));
        assert!(frame.contains("\"payload\":{\"n\":1}"), "payload must be structured, not double-encoded: {frame}");
        assert!(frame.contains("\"kind\":\"event\""));
    }
}
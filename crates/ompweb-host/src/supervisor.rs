//! R8: Rust OMP Supervisor (doc 15 / v4 P12/R8).
//!
//! Owns the OMP child process lifecycle for RPC sessions — spawn, stdin
//! writes with protocol-v2 chunking, stdout NDJSON line reads with the
//! 1 MiB frame cap, crash recovery (restart with backoff), and per-session
//! event streaming. This is the first production Authority cutover target:
//! when feature flag backend.agent=rust is on, NO Node code spawns OMP.
//!
//! Wire compatibility with lib/omp/rpc-frame.ts:
//!   - physical layer: JSONL lines, max 1 MiB
//!   - logical frames > 1 MiB are split into rpc_chunk records (chunkId /
//!     index / count / byteLength / base64 data), reassembled on read,
//!     64 MiB reassembly cap.

use crate::mini_json::JsonValue;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

pub const MAX_RPC_FRAME_BYTES: usize = 1024 * 1024;
pub const MAX_RPC_REASSEMBLED_BYTES: usize = 64 * 1024 * 1024;
const RPC_CHUNK_PAYLOAD_BYTES: usize = 256 * 1024;
const MAX_RESTARTS: u32 = 3;

#[derive(Clone)]
pub enum SessionEvent {
    /// A complete logical RPC frame (JSON text) from the child.
    Frame(String),
    /// Child exited (after restarts exhausted or graceful).
    Exited {
        code: Option<i32>,
        signal: Option<i32>,
    },
}

struct Session {
    child: Child,
    stdin: ChildStdin,
    subscribers: Vec<Sender<SessionEvent>>,
    restarts: u32,
    killed: bool,
    /// Extra CLI args the child was spawned with (--resume/--tools/...).
    /// Replayed verbatim on crash restart so a recovered session resumes the
    /// same conversation (doc 16 route 4: args 完整传递 + restart 保真).
    args: Vec<String>,
    /// Bounded replay ring: frames emitted before a subscriber attaches are
    /// replayed so late attach (fast omp startup) still sees ready/init
    /// frames. Keeps the ring tight (64 x up-to-1MiB is bounded by the frame
    /// cap; normal frames are far smaller).
    ring: std::collections::VecDeque<String>,
}

pub struct Supervisor {
    sessions: Mutex<HashMap<String, Session>>,
    omp_bin: String,
    omp_env: Vec<(String, String)>,
}

impl Supervisor {
    pub fn new(omp_bin: String, env: Vec<(String, String)>) -> Arc<Supervisor> {
        Arc::new(Supervisor {
            sessions: Mutex::new(HashMap::new()),
            omp_bin,
            omp_env: env,
        })
    }

    pub fn list(&self) -> Vec<(String, u32, u32)> {
        let guard = self.sessions.lock().unwrap();
        guard
            .iter()
            .map(|(id, s)| (id.clone(), s.child.id(), s.restarts))
            .collect()
    }

    /// Spawn `omp --mode rpc-ui` for one session. Returns (pid, restarts).
    /// `extra_args` mirror the Node spawn order (--resume/--tools/--advisor/
    /// ... appended after `--cwd`); replayed verbatim on crash restart.
    pub fn spawn(
        self: &Arc<Self>,
        session_id: &str,
        cwd: &str,
        extra_args: &[String],
    ) -> Result<(u32, u32), String> {
        let mut guard = self.sessions.lock().unwrap();
        if let Some(existing) = guard.get(session_id) {
            // Alive already — idempotent spawn.
            return Ok((existing.child.id(), existing.restarts));
        }
        let mut child = self
            .spawn_child(cwd, extra_args)
            .map_err(|e| format!("spawn omp: {e}"))?;
        let pid = child.id();
        let stdin = child.stdin.take().ok_or("child stdin unavailable")?;
        let (reader_tx, rx) = channel();
        let session = Session {
            child,
            stdin,
            subscribers: vec![reader_tx],
            restarts: 0,
            killed: false,
            args: extra_args.to_vec(),
            ring: std::collections::VecDeque::new(),
        };
        guard.insert(session_id.to_string(), session);
        drop(guard);
        self.start_reader(session_id.to_string(), cwd.to_string(), rx, 0);
        Ok((pid, 0))
    }

    /// Subscribe to a session's event stream. Returns a receiver that gets
    /// Frame/Exited events until the session ends.
    pub fn subscribe(&self, session_id: &str) -> Result<Receiver<SessionEvent>, String> {
        let mut guard = self.sessions.lock().unwrap();
        let session = guard.get_mut(session_id).ok_or("no such session")?;
        let (tx, rx) = channel();
        session.subscribers.push(tx);
        Ok(rx)
    }

    fn spawn_child(&self, cwd: &str, extra_args: &[String]) -> Result<Child, String> {
        let mut cmd = Command::new(&self.omp_bin);
        // Node path (lib/omp/rpc-process.ts) passes --cwd explicitly; the
        // working directory alone is not enough for omp's rpc-ui mode.
        // extra_args mirror Node's spawn order (appended after --cwd):
        // --resume <file>, --tools, --advisor, ...
        cmd.args(["--mode", "rpc-ui", "--cwd", cwd])
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        for arg in extra_args {
            cmd.arg(arg);
        }
        for (key, value) in &self.omp_env {
            cmd.env(key, value);
        }
        cmd.spawn().map_err(|e| e.to_string())
    }

    /// Send one logical RPC frame (JSON object text) to the child's stdin,
    /// chunking per protocol v2 when above the 1 MiB line cap.
    pub fn send(&self, session_id: &str, frame_json: &str) -> Result<(), String> {
        let mut guard = self.sessions.lock().unwrap();
        let session = guard.get_mut(session_id).ok_or("no such session")?;
        let lines = encode_rpc_frames(frame_json).map_err(|e| e.to_string())?;
        let stdin = &mut session.stdin;
        for line in &lines {
            stdin
                .write_all(line.as_bytes())
                .map_err(|e| format!("stdin: {e}"))?;
        }
        stdin.flush().map_err(|e| format!("flush: {e}"))?;
        Ok(())
    }

    /// Kill a session's child. A user-initiated kill must NOT trigger
    /// crash recovery (v4 P12: restarts are for unexpected exits).
    pub fn kill(&self, session_id: &str) -> Result<(), String> {
        let mut guard = self.sessions.lock().unwrap();
        if let Some(session) = guard.get_mut(session_id) {
            session.killed = true;
            session.child.kill().map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    #[allow(dead_code)] // lifecycle API for host shutdown
    pub fn remove(&self, session_id: &str) {
        self.sessions.lock().unwrap().remove(session_id);
    }

    fn start_reader(
        self: &Arc<Self>,
        session_id: String,
        cwd: String,
        rx: Receiver<SessionEvent>,
        restarts: u32,
    ) {
        let this = Arc::clone(self);
        std::thread::spawn(move || {
            this.reader_main(session_id, cwd, rx, restarts);
        });
    }

    fn reader_main(
        self: &Arc<Self>,
        session_id: String,
        cwd: String,
        rx: Receiver<SessionEvent>,
        restarts: u32,
    ) {
        // Take the child's stdout under lock; the Session (with stdin and
        // subscribers) stays in the map so agent.send/attach keep working
        // while the reader streams.
        let stdout = {
            let mut guard = self.sessions.lock().unwrap();
            match guard.get_mut(&session_id) {
                Some(session) => match session.child.stdout.take() {
                    Some(out) => out,
                    None => return,
                },
                None => return,
            }
        };
        let mut reader = BufReader::new(stdout);
        let mut decoder = FrameReassembler::new();
        let mut line: Vec<u8> = Vec::new();
        loop {
            line.clear();
            match read_line_capped(&mut reader, &mut line, MAX_RPC_FRAME_BYTES) {
                Ok(0) => break,
                Ok(_) => {
                    // Byte-accurate line; lossy UTF-8 (pipe segments can split
                    // multi-byte characters — a String-based reader would die
                    // on the boundary and stall the stream).
                    let text = String::from_utf8_lossy(&line);
                    match decoder.push_line(&text) {
                        Ok(Some(frame)) => {
                            self.broadcast(&session_id, SessionEvent::Frame(frame));
                        }
                        Ok(None) => {}
                        Err(_) => {
                            // Malformed frame: drop the line (documented loss),
                            // keep reading — a flood must not kill the supervisor.
                        }
                    }
                }
                Err(_) => break,
            }
        }
        let (code, signal) = {
            let mut guard = self.sessions.lock().unwrap();
            match guard.get_mut(&session_id) {
                Some(session) => session
                    .child
                    .wait()
                    .map(|status| (status.code(), signal_of(&status)))
                    .unwrap_or((None, None)),
                None => (None, None),
            }
        };
        // Crash recovery: restart only on UNEXPECTED exits (user kills are
        // flagged and must not resurrect the session).
        let user_killed = {
            let guard = self.sessions.lock().unwrap();
            guard.get(&session_id).map(|s| s.killed).unwrap_or(false)
        };
        let should_restart = !user_killed && code != Some(0) && restarts < MAX_RESTARTS;
        if should_restart {
            // Replay the session's spawn args on restart so a recovered child
            // resumes the same conversation (--resume etc. — route 4 parity).
            let restart_args = {
                let guard = self.sessions.lock().unwrap();
                guard
                    .get(&session_id)
                    .map(|s| s.args.clone())
                    .unwrap_or_default()
            };
            if let Ok(new_child) = self.spawn_child(&cwd, &restart_args) {
                let new_pid = new_child.id();
                {
                    let mut guard = self.sessions.lock().unwrap();
                    if let Some(session) = guard.get_mut(&session_id) {
                        session.child = new_child;
                        session.restarts = restarts + 1;
                    }
                }
                self.broadcast(&session_id, SessionEvent::Frame(format!(
                    "{{\"type\":\"session_restarted\",\"sessionId\":{},\"pid\":{},\"restarts\":{}}}",
                    crate::ipc_server::json_str(&session_id),
                    new_pid,
                    restarts + 1
                )));
                self.start_reader(session_id.clone(), cwd, rx, restarts + 1);
                return;
            }
        }
        self.broadcast(&session_id, SessionEvent::Exited { code, signal });
        // Remove the dead session (subscribers see Exited and detach).
        self.sessions.lock().unwrap().remove(&session_id);
    }

    fn broadcast(&self, session_id: &str, event: SessionEvent) {
        let mut guard = self.sessions.lock().unwrap();
        if let Some(session) = guard.get_mut(session_id) {
            session
                .subscribers
                .retain(|sub| sub.send(event.clone()).is_ok());
            if let SessionEvent::Frame(frame) = &event {
                if session.ring.len() >= 64 {
                    session.ring.pop_front();
                }
                session.ring.push_back(frame.clone());
            }
        }
    }

    /// Frames recorded before this subscriber attached (bounded replay).
    pub fn recent_frames(&self, session_id: &str) -> Vec<String> {
        let guard = self.sessions.lock().unwrap();
        match guard.get(session_id) {
            Some(session) => session.ring.iter().cloned().collect(),
            None => Vec::new(),
        }
    }
}

fn signal_of(status: &std::process::ExitStatus) -> Option<i32> {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        status.signal()
    }
    #[cfg(not(unix))]
    {
        let _ = status;
        None
    }
}

/// Read one line capped at `cap` bytes into a byte buffer; Ok(0) at EOF.
/// Byte-based (no UTF-8 validation per segment): pipe reads can split a
/// multi-byte character, and a String-based accumulator would fail on the
/// boundary and stall the whole stream.
fn read_line_capped(
    reader: &mut BufReader<std::process::ChildStdout>,
    line: &mut Vec<u8>,
    cap: usize,
) -> std::io::Result<usize> {
    let mut total = 0usize;
    loop {
        let buf = reader.fill_buf()?;
        if buf.is_empty() {
            return Ok(total);
        }
        match buf.iter().position(|b| *b == b'\n') {
            Some(idx) => {
                let take = idx + 1;
                if total + take > cap {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "rpc line exceeds 1MiB",
                    ));
                }
                line.extend_from_slice(&buf[..take]);
                reader.consume(take);
                total += take;
                return Ok(total);
            }
            None => {
                if total + buf.len() > cap {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "rpc line exceeds 1MiB",
                    ));
                }
                line.extend_from_slice(buf);
                let len = buf.len();
                reader.consume(len);
                total += len;
            }
        }
    }
}

/// Protocol-v2 frame reassembler (mirrors RpcFrameDecoder).
struct FrameReassembler {
    pending_chunk_id: Option<String>,
    pending_count: usize,
    pending_byte_length: usize,
    pending_next_index: usize,
    pending_parts: Vec<Vec<u8>>,
    pending_received: usize,
}

impl FrameReassembler {
    fn new() -> Self {
        FrameReassembler {
            pending_chunk_id: None,
            pending_count: 0,
            pending_byte_length: 0,
            pending_next_index: 0,
            pending_parts: Vec::new(),
            pending_received: 0,
        }
    }

    fn push_line(&mut self, line: &str) -> Result<Option<String>, String> {
        let value = JsonValue::parse(line.trim()).map_err(|e| e.to_string())?;
        let kind = value
            .get(&["type"])
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if kind != "rpc_chunk" {
            if self.pending_chunk_id.is_some() {
                return Err("chunk sequence interrupted".into());
            }
            return Ok(Some(line.trim().to_string()));
        }
        let chunk_id = value
            .get(&["chunkId"])
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let index = value
            .get(&["index"])
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(usize::MAX);
        let count = value
            .get(&["count"])
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(usize::MAX);
        let byte_length = value
            .get(&["byteLength"])
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(usize::MAX);
        let data = value.get(&["data"]).and_then(|v| v.as_str()).unwrap_or("");
        if chunk_id.is_empty()
            || chunk_id.len() > 128
            || count < 2
            || index >= count
            || byte_length > MAX_RPC_REASSEMBLED_BYTES
        {
            return Err("invalid chunk metadata".into());
        }
        let bytes = decode_base64(data)?;
        if self.pending_chunk_id.is_none() {
            if index != 0 {
                return Err("chunk sequence must start at index 0".into());
            }
            self.pending_chunk_id = Some(chunk_id.clone());
            self.pending_count = count;
            self.pending_byte_length = byte_length;
            self.pending_next_index = 0;
            self.pending_parts.clear();
            self.pending_received = 0;
        }
        if self.pending_chunk_id.as_deref() != Some(chunk_id.as_str())
            || self.pending_count != count
            || self.pending_byte_length != byte_length
            || self.pending_next_index != index
        {
            return Err("chunk sequence mismatch".into());
        }
        self.pending_parts.push(bytes.clone());
        self.pending_received += bytes.len();
        self.pending_next_index += 1;
        if self.pending_received > self.pending_byte_length {
            return Err("chunk exceeds declared length".into());
        }
        if self.pending_next_index < self.pending_count {
            return Ok(None);
        }
        if self.pending_received != self.pending_byte_length {
            return Err("chunk length mismatch".into());
        }
        self.pending_chunk_id = None;
        let mut json = String::new();
        for part in &self.pending_parts {
            json.push_str(&String::from_utf8_lossy(part));
        }
        // Parse to validate, then return the reassembled JSON text.
        JsonValue::parse(&json).map_err(|e| e.to_string())?;
        Ok(Some(json))
    }
}

/// Encode one logical frame into physical lines (v1 single line, v2 chunked).
pub fn encode_rpc_frames(frame_json: &str) -> Result<Vec<String>, String> {
    let single = format!("{frame_json}\n");
    if single.len() <= MAX_RPC_FRAME_BYTES {
        return Ok(vec![single]);
    }
    let bytes = frame_json.as_bytes();
    if bytes.len() > MAX_RPC_REASSEMBLED_BYTES {
        return Err("frame exceeds reassembly limit".into());
    }
    let count = bytes.len().div_ceil(RPC_CHUNK_PAYLOAD_BYTES);
    let chunk_id = format!("rust-{}", std::process::id());
    let mut lines = Vec::with_capacity(count);
    for index in 0..count {
        let start = index * RPC_CHUNK_PAYLOAD_BYTES;
        let end = (start + RPC_CHUNK_PAYLOAD_BYTES).min(bytes.len());
        let data = encode_base64(&bytes[start..end]);
        lines.push(format!(
            "{{\"type\":\"rpc_chunk\",\"chunkId\":{},\"index\":{},\"count\":{},\"byteLength\":{},\"data\":{}}}\n",
            crate::ipc_server::json_str(&chunk_id),
            index,
            count,
            bytes.len(),
            crate::ipc_server::json_str(&data)
        ));
    }
    Ok(lines)
}

fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(input.len() * 3 / 4 + 3);
    let mut acc: u32 = 0;
    let mut bits = 0u32;
    for ch in input.bytes() {
        let value = match ch {
            b'A'..=b'Z' => ch - b'A',
            b'a'..=b'z' => ch - b'a' + 26,
            b'0'..=b'9' => ch - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            _ => return Err("invalid base64".into()),
        };
        acc = (acc << 6) | value as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Ok(out)
}

fn encode_base64(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[(triple >> 18) as usize & 63] as char);
        out.push(TABLE[(triple >> 12) as usize & 63] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(triple >> 6) as usize & 63] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[triple as usize & 63] as char);
        } else {
            out.push('=');
        }
    }
    out
}

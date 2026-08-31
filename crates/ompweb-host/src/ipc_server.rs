//! C03: Local IPC server (doc 15 / v4 PR-C03).
//!
//! Zero-dependency TCP server bound to 127.0.0.1. Line-delimited JSON
//! (NDJSON) protocol with request/response plus per-request streaming
//! frames; same-user auth via a host-generated token file (0600) that the
//! embedded/headless client reads. Max frame 1 MiB; oversized frames are
//! rejected with a stable error, not silently truncated.
//!
//! Wire shapes:
//!   → {"id":"1","method":"hello","params":{"token":"..."}}
//!   ← {"id":"1","ok":true,"result":{"protocol":1,"pid":123}}
//!   ← {"id":"2","event":{"type":"frame","payload":{...}}}   (streaming)
//!   ← {"id":"2","ok":true,"result":null}                    (stream end)

use crate::mini_json::JsonValue;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub const IPC_PROTOCOL_VERSION: u32 = 1;
pub const MAX_FRAME_BYTES: usize = 1024 * 1024;
/// Hard cap on concurrent client connections (per-thread handling): a local
/// flood must exhaust the cap, not the process (v4 P28 crash boundary).
pub const MAX_CONNECTIONS: usize = 16;

pub type Handler = dyn Fn(&str, &JsonValue, &mut dyn FnMut(&str)) -> Result<Option<String>, IpcError> + Send + Sync;

#[derive(Debug)]
pub struct IpcError {
    pub code: &'static str,
    pub message: String,
}

impl IpcError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        IpcError { code, message: message.into() }
    }
}

pub struct IpcServer {
    listener: TcpListener,
    token: String,
    port: u16,
    running: Arc<AtomicBool>,
    connections: Arc<std::sync::atomic::AtomicUsize>,
}

impl IpcServer {
    /// Bind on 127.0.0.1:0 (ephemeral). `token` authenticates the hello.
    pub fn start(token: String) -> Result<IpcServer, String> {
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("bind: {e}"))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        Ok(IpcServer {
            listener,
            token,
            port,
            running: Arc::new(AtomicBool::new(true)),
            connections: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    /// Accept loop in the calling thread; each connection gets a thread.
    pub fn serve(&self, handler: Arc<Handler>) {
        while self.running.load(Ordering::Relaxed) {
            match self.listener.accept() {
                Ok((stream, _addr)) => {
                    // Connection cap: reject (drop) excess clients instead of
                    // spawning unbounded threads.
                    if self.connections.load(Ordering::Relaxed) >= MAX_CONNECTIONS {
                        continue;
                    }
                    self.connections.fetch_add(1, Ordering::Relaxed);
                    let token = self.token.clone();
                    let running = self.running.clone();
                    let handler = handler.clone();
                    let connections = self.connections.clone();
                    std::thread::spawn(move || {
                        let _ = handle_connection(stream, &token, handler.as_ref(), running);
                        connections.fetch_sub(1, Ordering::Relaxed);
                    });
                }
                Err(_) => {
                    if !self.running.load(Ordering::Relaxed) {
                        break;
                    }
                }
            }
        }
    }

    #[allow(dead_code)] // lifecycle control for the embedded/headless host
    pub fn stop(&self) {
        self.running.store(false, Ordering::Relaxed);
    }
}

fn send_line(stream: &mut TcpStream, line: &str) -> std::io::Result<()> {
    stream.write_all(line.as_bytes())?;
    stream.write_all(b"\n")?;
    stream.flush()
}

fn handle_connection(
    mut stream: TcpStream,
    expected_token: &str,
    handler: &Handler,
    running: Arc<AtomicBool>,
) -> Result<(), String> {
    let mut authed = false;
    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    let mut line = String::new();
    let mut frames: Vec<u8> = Vec::new(); // oversized-frame guard buffer

    loop {
        line.clear();
        frames.clear();
        let n = reader.read_line(&mut line).map_err(|e| format!("read: {e}"))?;
        if n == 0 {
            return Ok(()); // EOF
        }
        if line.len() > MAX_FRAME_BYTES {
            let _ = respond(&mut stream, "null", false, &format!("{{\"code\":\"frame_too_large\",\"message\":\"frame exceeds 1MiB\"}}"));
            return Ok(());
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let value = match JsonValue::parse(trimmed) {
            Ok(v) => v,
            Err(err) => {
                let _ = respond(&mut stream, "null", false, &format!("{{\"code\":\"invalid_json\",\"message\":{}}}", json_str(&err)));
                continue;
            }
        };
        let id = value.get(&["id"]).and_then(|v| v.as_str()).unwrap_or("null").to_string();
        let method = value.get(&["method"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let params = value.get(&["params"]).cloned().unwrap_or(JsonValue::Null);

        if !authed {
            if method != "hello" {
                let _ = respond(&mut stream, &id, false, "{\"code\":\"not_authed\",\"message\":\"hello first\"}");
                continue;
            }
            let token = params.get(&["token"]).and_then(|v| v.as_str()).unwrap_or("");
            if token != expected_token {
                let _ = respond(&mut stream, &id, false, "{\"code\":\"auth_failed\",\"message\":\"bad token\"}");
                return Ok(());
            }
            authed = true;
            let _ = respond(&mut stream, &id, true, &format!("{{\"protocol\":{},\"pid\":{}}}", IPC_PROTOCOL_VERSION, std::process::id()));
            continue;
        }

        // Streaming channel: the handler emits frames via the emit callback.
        // Emits are written to the socket IMMEDIATELY (attach-style handlers
        // block until the session ends — collecting would delay every frame
        // until the handler returns).
        let mut emit = |frame: &str| {
            let _ = send_line(&mut stream, &format!("{{\"id\":{},\"event\":{}}}", json_str(&id), frame));
        };
        let result = handler(&method, &params, &mut emit);
        match result {
            Ok(Some(body)) => {
                let _ = respond(&mut stream, &id, true, &body);
            }
            Ok(None) => {
                let _ = respond(&mut stream, &id, true, "null");
            }
            Err(err) => {
                let _ = respond(&mut stream, &id, false, &format!("{{\"code\":{},\"message\":{}}}", json_str(err.code), json_str(&err.message)));
            }
        }
        let _ = running.load(Ordering::Relaxed);
    }
}

fn respond(stream: &mut TcpStream, id: &str, ok: bool, body: &str) -> std::io::Result<()> {
    if ok {
        send_line(stream, &format!("{{\"id\":{},\"ok\":true,\"result\":{}}}", json_str(id), body))
    } else {
        send_line(stream, &format!("{{\"id\":{},\"ok\":false,\"error\":{}}}", json_str(id), body))
    }
}

pub(crate) fn json_str(value: &str) -> String {
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
    use std::io::Write;
    use std::net::TcpStream;

    fn client_exchange(port: u16, token: &str, requests: &[&str]) -> Vec<String> {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
        let mut reader = BufReader::new(stream.try_clone().expect("clone"));
        let mut responses = Vec::new();
        for req in requests {
            stream.write_all(req.as_bytes()).unwrap();
            stream.write_all(b"\n").unwrap();
            stream.flush().unwrap();
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            responses.push(line.trim().to_string());
        }
        responses
    }

    fn make_server() -> (IpcServer, String) {
        let token = "test-token".to_string();
        let server = IpcServer::start(token.clone()).expect("start");
        let handler: Arc<Handler> = Arc::new(|method, params, emit| match method {
            "echo" => {
                let text = params.get(&["text"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                Ok(Some(format!("{{\"echo\":{}}}", json_str(&text))))
            }
            "stream" => {
                emit(&format!("{{\"type\":\"frame\",\"n\":1}}"));
                emit(&format!("{{\"type\":\"frame\",\"n\":2}}"));
                Ok(None)
            }
            _ => Err(IpcError::new("unknown_method", format!("no method {method}"))),
        });
        (server, token)
    }

    #[test]
    fn auth_and_echo_roundtrip() {
        let (server, token) = make_server();
        let port = server.port();
        let handler: Arc<Handler> = Arc::new(|method, params, _emit| match method {
            "echo" => {
                let text = params.get(&["text"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                Ok(Some(format!("{{\"echo\":{}}}", json_str(&text))))
            }
            _ => Err(IpcError::new("unknown_method", "no")),
        });
        std::thread::spawn(move || server.serve(handler));
        let responses = client_exchange(
            port,
            &token,
            &[
                "{\"id\":\"1\",\"method\":\"hello\",\"params\":{\"token\":\"test-token\"}}",
                "{\"id\":\"2\",\"method\":\"echo\",\"params\":{\"text\":\"hi\"}}",
            ],
        );
        assert!(responses[0].contains("\"ok\":true"), "hello: {}", responses[0]);
        assert!(responses[1].contains("\"echo\":\"hi\""), "echo: {}", responses[1]);
    }

    #[test]
    fn bad_token_rejected() {
        let (server, token) = make_server();
        let port = server.port();
        let handler: Arc<Handler> = Arc::new(|_m, _p, _e| Ok(Some("null".into())));
        std::thread::spawn(move || server.serve(handler));
        let responses = client_exchange(
            port,
            &token,
            &["{\"id\":\"1\",\"method\":\"hello\",\"params\":{\"token\":\"wrong\"}}"],
        );
        assert!(responses[0].contains("auth_failed"), "{}", responses[0]);
    }

    #[test]
    fn streaming_frames_then_result() {
        let (server, token) = make_server();
        let port = server.port();
        let handler: Arc<Handler> = Arc::new(|method, params, emit| match method {
            "stream" => {
                emit("{\"type\":\"frame\",\"n\":1}");
                emit("{\"type\":\"frame\",\"n\":2}");
                Ok(None)
            }
            _ => Ok(Some("null".into())),
        });
        std::thread::spawn(move || server.serve(handler));
        let responses = client_exchange(
            port,
            &token,
            &[
                "{\"id\":\"1\",\"method\":\"hello\",\"params\":{\"token\":\"test-token\"}}",
                "{\"id\":\"2\",\"method\":\"stream\",\"params\":{}}",
                "{\"id\":\"3\",\"method\":\"stream\",\"params\":{}}",
                "{\"id\":\"4\",\"method\":\"stream\",\"params\":{}}",
            ],
        );
        assert!(responses[1].contains("\"event\""), "frame1: {}", responses[1]);
        assert!(responses[2].contains("\"event\""), "frame2: {}", responses[2]);
        assert!(responses[3].contains("\"ok\":true"), "end: {}", responses[3]);
    }

    #[test]
    fn unknown_method_stable_error() {
        let (server, token) = make_server();
        let port = server.port();
        let handler: Arc<Handler> = Arc::new(|_m, _p, _e| Err(IpcError::new("unknown_method", "nope")));
        std::thread::spawn(move || server.serve(handler));
        let responses = client_exchange(
            port,
            &token,
            &[
                "{\"id\":\"1\",\"method\":\"hello\",\"params\":{\"token\":\"test-token\"}}",
                "{\"id\":\"2\",\"method\":\"bogus\",\"params\":{}}",
            ],
        );
        assert!(responses[1].contains("unknown_method"), "{}", responses[1]);
    }
}

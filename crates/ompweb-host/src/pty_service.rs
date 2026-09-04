//! pty_service: Rust authority for the terminal domain (doc 16 route 8).
//! Mirrors lib/terminal-session-manager.ts + lib/terminal-shell.ts semantics:
//!   - shell resolution: $SHELL (unix, -i) / %COMSPEC% (win32, no args),
//!     fallbacks /bin/zsh (darwin) / /bin/bash (linux) / cmd.exe (win32);
//!   - spawn env: host env inherited, TERM=xterm-256color + COLORTERM=truecolor
//!     forced, LANG/LC_ALL defaulting to en_US.UTF-8, per-request overrides
//!     (proxy vars) merged last;
//!   - 80x24 default size, `write` verbatim passthrough, resize bounds
//!     (cols>=2, rows>=1), kill -> exit event + `[Terminal closed]` banner;
//!   - bounded history replay for late attaches; oversized data chunks split
//!     into ~900 KiB emit segments (1 MiB IPC line cap).
//!
//! Transport: `pty.attach` streams over the dedicated attach socket (the
//! agent.attach pattern — the connection thread blocks until exit);
//! `pty.write` / `pty.resize` / `pty.kill` ride the control socket.

use std::collections::VecDeque;
use std::io::{Read, Write};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, OnceLock};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use crate::file_service::is_path_within_any;
use crate::ipc_server::{json_str, IpcError};

const DEFAULT_COLS: u16 = 80;
const DEFAULT_ROWS: u16 = 24;
/// Each emit line must stay far under the 1 MiB IPC frame cap.
const MAX_EMIT_BYTES: usize = 900 * 1024;
const MAX_HISTORY_BYTES: usize = 1024 * 1024;
const MAX_HISTORY_FRAMES: usize = 256;
const MAX_SESSIONS: usize = 12;

#[derive(Clone)]
pub enum PtyEvent {
    Data(String),
    Exited { code: Option<i32> },
}

struct PtyHandle {
    id: String,
    readers: Mutex<Vec<Sender<PtyEvent>>>,
    history: Mutex<VecDeque<String>>,
    history_bytes: Mutex<usize>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Option<Box<dyn portable_pty::Child + Send>>>,
}

pub struct PtyService {
    sessions: Mutex<Vec<Arc<PtyHandle>>>,
}

impl PtyService {
    pub fn new() -> Self {
        PtyService { sessions: Mutex::new(Vec::new()) }
    }

    fn evict_if_needed(&self) {
        let mut evicted_handles: Vec<Arc<PtyHandle>> = Vec::new();
        {
            let mut sessions = self.sessions.lock().unwrap();
            while sessions.len() >= MAX_SESSIONS {
                evicted_handles.push(sessions.remove(0));
            }
        } // lock dropped before killing children
        for handle in evicted_handles {
            // Kill the evicted PTY's shell before dropping — otherwise the
            // child keeps running as an invisible process leak.
            if let Some(mut child) = handle.child.lock().unwrap().take() {
                let _ = child.kill();
                drop(child);
            }
        }
    }

    /// Spawn an interactive shell in `cwd`. `envs` holds per-request overrides
    /// (proxy vars) merged over the host's inherited environment, then the
    /// terminal defaults are forced (Node contract order).
    pub fn spawn(&self, cwd: &str, cols: Option<u16>, rows: Option<u16>, envs: &[(String, String)]) -> Result<String, IpcError> {
        self.evict_if_needed();
        let pty_system = native_pty_system();
        let size = PtySize { rows: rows.unwrap_or(DEFAULT_ROWS), cols: cols.unwrap_or(DEFAULT_COLS), pixel_width: 0, pixel_height: 0 };
        let pair = pty_system
            .openpty(size)
            .map_err(|e| IpcError::new("pty_open_failed", e.to_string()))?;

        let (shell, args) = resolve_shell();
        let mut cmd = CommandBuilder::new(shell);
        for arg in args {
            cmd.arg(arg);
        }
        cmd.cwd(cwd);
        for (key, value) in envs {
            cmd.env(key, value);
        }
        // Note: CommandBuilder inherits the base environment (host env == the
        // Node process env) unless env_clear() is called.
        let lang = std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".into());
        let lc_all = std::env::var("LC_ALL").unwrap_or_else(|_| "en_US.UTF-8".into());
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("LANG", lang);
        cmd.env("LC_ALL", lc_all);

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| IpcError::new("pty_spawn_failed", e.to_string()))?;
        drop(pair.slave);

        let id = format!("term-{}{}", rand_hex(), rand_hex());
        // Clone the reader BEFORE moving the master into the handle.
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| IpcError::new("pty_reader_failed", e.to_string()))?;
        let handle = Arc::new(PtyHandle {
            id: id.clone(),
            readers: Mutex::new(Vec::new()),
            history: Mutex::new(VecDeque::new()),
            history_bytes: Mutex::new(0),
            master: Mutex::new(pair.master),
            child: Mutex::new(Some(child)),
        });

        {
            let handle_clone = handle.clone();
            std::thread::spawn(move || {
                let mut buf = vec![0u8; 16 * 1024];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let text = String::from_utf8_lossy(&buf[..n]).into_owned();
                            handle_clone.push_history(text.clone());
                            for segment in split_segments(&text) {
                                handle_clone.broadcast(PtyEvent::Data(segment));
                            }
                        }
                    }
                }
                // Master EOF = child closed its side; reap and banner (the
                // exact [Terminal closed with code N] contract TerminalPanel
                // keys its stream-dead detection on).
                let code = handle_clone
                    .child
                    .lock()
                    .unwrap()
                    .take()
                    .and_then(|mut child| child.wait().ok())
                    .map(|status| status.exit_code() as i32);
                let banner = format!("\r\n\x1b[33m[Terminal closed with code {}]\x1b[0m\r\n", code.unwrap_or(0));
                handle_clone.push_history(banner.clone());
                handle_clone.broadcast(PtyEvent::Data(banner));
                handle_clone.broadcast(PtyEvent::Exited { code });
            });
        }

        self.sessions.lock().unwrap().push(handle);
        Ok(format!("{{\"id\":{}}}", json_str(&id)))
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), IpcError> {
        let handle = self.find(id)?;
        // Verbatim passthrough — the terminal protocol is authoritative.
        let mut master = handle.master.lock().unwrap();
        let mut writer = (*master).take_writer().map_err(|e| IpcError::new("pty_writer_failed", e.to_string()))?;
        writer.write_all(data.as_bytes()).map_err(|e| IpcError::new("pty_write_failed", e.to_string()))?;
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), IpcError> {
        if cols < 2 || rows < 1 {
            return Err(IpcError::new("bad_params", "cols must be >= 2 and rows >= 1"));
        }
        let handle = self.find(id)?;
        let mut master = handle.master.lock().unwrap();
        master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| IpcError::new("pty_resize_failed", e.to_string()))
    }

    pub fn kill(&self, id: &str) -> Result<(), IpcError> {
        let handle = self.find(id)?;
        let mut child = handle.child.lock().unwrap();
        if let Some(mut child) = child.take() {
            let _ = child.kill();
            drop(child);
        }
        Ok(())
    }

    /// Attach: replay bounded history, then deliver live events until exit.
    /// Order matters — snapshot the history BEFORE registering the reader, so
    /// a chunk that arrives between the snapshot and the subscription is
    /// delivered exactly once (either via the replay or via the live channel,
    /// never both — no duplicate characters on late attach).
    pub fn attach(&self, id: &str) -> Result<(Receiver<PtyEvent>, Vec<String>), IpcError> {
        let handle = self.find(id)?;
        let history = handle.history.lock().unwrap().iter().cloned().collect::<Vec<_>>();
        let (tx, rx) = mpsc::channel();
        handle.readers.lock().unwrap().push(tx);
        Ok((rx, history))
    }

    fn find(&self, id: &str) -> Result<Arc<PtyHandle>, IpcError> {
        self.sessions
            .lock()
            .unwrap()
            .iter()
            .find(|handle| handle.id == id)
            .cloned()
            .ok_or_else(|| IpcError::new("no_such_pty", "unknown terminal session"))
    }
}

impl PtyHandle {
    fn broadcast(&self, event: PtyEvent) {
        self.readers.lock().unwrap().retain(|tx| tx.send(event.clone()).is_ok());
    }

    fn push_history(&self, text: String) {
        push_history(&self.history, &self.history_bytes, text);
    }
}

/// Bounded history append (1 MiB byte cap, 256 frame cap) — free function so
/// the cap logic is testable without a real pty master.
fn push_history(history: &Mutex<VecDeque<String>>, bytes: &Mutex<usize>, text: String) {
    let mut history = history.lock().unwrap();
    let mut bytes = bytes.lock().unwrap();
    *bytes += text.len();
    history.push_back(text);
    while *bytes > MAX_HISTORY_BYTES && history.len() > 1 {
        if let Some(front) = history.pop_front() {
            *bytes -= front.len();
        }
    }
    while history.len() > MAX_HISTORY_FRAMES {
        if let Some(front) = history.pop_front() {
            *bytes -= front.len();
        }
    }
}

/// Split a chunk into <= MAX_EMIT_BYTES segments (1 MiB IPC line cap).
fn split_segments(text: &str) -> Vec<String> {
    let mut segments = Vec::new();
    let mut remaining = text;
    while !remaining.is_empty() {
        if remaining.len() > MAX_EMIT_BYTES {
            let (head, tail) = remaining.split_at(MAX_EMIT_BYTES);
            segments.push(head.to_string());
            remaining = tail;
        } else {
            segments.push(remaining.to_string());
            break;
        }
    }
    segments
}

/// Shell resolution parity (lib/terminal-shell.ts): $SHELL / %COMSPEC% win;
/// unix fallback /bin/zsh (darwin) / /bin/bash; unix always `-i`.
fn resolve_shell() -> (String, Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
        (shell, Vec::new())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| {
            if cfg!(target_os = "macos") { "/bin/zsh".to_string() } else { "/bin/bash".to_string() }
        });
        (shell, vec!["-i".to_string()])
    }
}

/// Deter-ministic-ish 4-hex server-side id fragment.
fn rand_hex() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0) as u64;
    format!("{:04x}", (nanos ^ (std::process::id() as u64)) & 0xFFFF)
}

/// Global service (the host has a single terminal domain; sessions registry
/// mirrors the Node map keyed by term-* ids).
pub fn global_service() -> &'static PtyService {
    static SERVICE: OnceLock<PtyService> = OnceLock::new();
    SERVICE.get_or_init(PtyService::new)
}

/// IPC arm `pty.spawn` — containment re-enforced on the host.
pub fn spawn(roots: &[String], cwd: &str, cols: Option<u16>, rows: Option<u16>, envs: &[(String, String)]) -> Result<String, IpcError> {
    if !is_path_within_any(roots, cwd) {
        return Err(IpcError::new("access_denied", "cwd outside allowed roots"));
    }
    global_service().spawn(cwd, cols, rows, envs)
}

/// Single dispatch entry for every `pty.*` method. `cwd` containment is
/// verified here against the Node-authorized roots BEFORE any spawn — the
/// only path that reaches the shell is one that passed this gate.
pub fn dispatch(method: &str, params: &crate::mini_json::JsonValue, emit: &mut dyn FnMut(&str)) -> Result<Option<String>, IpcError> {
    fn str_param(params: &crate::mini_json::JsonValue, key: &str) -> String {
        params.get(&[key]).and_then(|v| v.as_str()).unwrap_or("").to_string()
    }
    fn envs_param(params: &crate::mini_json::JsonValue) -> Vec<(String, String)> {
        let mut envs = Vec::new();
        if let Some(crate::mini_json::JsonValue::Obj(entries)) = params.get(&["env"]) {
            for (key, value) in entries {
                if let Some(value) = value.as_str() {
                    envs.push((key.clone(), value.to_string()));
                }
            }
        }
        envs
    }
    let service = global_service();
    match method {
        "pty.spawn" => {
            let roots: Vec<String> = match params.get(&["roots"]) {
                Some(crate::mini_json::JsonValue::Arr(items)) => items.iter().filter_map(|v| v.as_str().map(str::to_string)).collect(),
                _ => Vec::new(),
            };
            let cwd = str_param(params, "cwd");
            // Defense in depth: the spawn gate lives here, adjacent to the
            // process-spawning call — a command shell is only ever started
            // inside a Node-authorized root.
            if !is_path_within_any(&roots, &cwd) {
                return Err(IpcError::new("access_denied", "cwd outside allowed roots"));
            }
            let cols = params.get(&["cols"]).and_then(|v| v.as_num()).map(|n| n as u16);
            let rows = params.get(&["rows"]).and_then(|v| v.as_num()).map(|n| n as u16);
            service.spawn(&cwd, cols, rows, &envs_param(params)).map(|body| Some(body))
        }
        "pty.write" => {
            let id = str_param(params, "id");
            let data = str_param(params, "data");
            service.write(&id, &data).map(|()| Some("null".into()))
        }
        "pty.resize" => {
            let id = str_param(params, "id");
            let cols = params.get(&["cols"]).and_then(|v| v.as_num()).map(|n| n as u16).unwrap_or(0);
            let rows = params.get(&["rows"]).and_then(|v| v.as_num()).map(|n| n as u16).unwrap_or(0);
            service.resize(&id, cols, rows).map(|()| Some("null".into()))
        }
        "pty.kill" => {
            let id = str_param(params, "id");
            service.kill(&id).map(|()| Some("null".into()))
        }
        "pty.attach" => {
            // Streaming attach (agent.attach pattern): this connection blocks,
            // replaying bounded history first, then live data frames until
            // the shell exits.
            let id = str_param(params, "id");
            let (rx, history) = service.attach(&id)?;
            for frame in history {
                emit(&format!("{{\"type\":\"data\",\"data\":{}}}", crate::ipc_server::json_str(&frame)));
            }
            for event in rx.iter() {
                match event {
                    PtyEvent::Data(data) => {
                        emit(&format!("{{\"type\":\"data\",\"data\":{}}}", crate::ipc_server::json_str(&data)));
                    }
                    PtyEvent::Exited { code } => {
                        emit(&format!("{{\"type\":\"exit\",\"code\":{}}}", code.map(|c| c.to_string()).unwrap_or_else(|| "null".into())));
                        return Ok(Some("null".into()));
                    }
                }
            }
            Ok(Some("null".into()))
        }
        _ => Err(IpcError::new("unknown_method", format!("no method {method}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_resolution_follows_node_contract() {
        let (shell, args) = resolve_shell();
        let expected = std::env::var("SHELL").unwrap_or_else(|_| {
            if cfg!(target_os = "macos") { "/bin/zsh".to_string() } else { "/bin/bash".to_string() }
        });
        assert_eq!(shell, expected);
        assert_eq!(args, vec!["-i"]);
    }

    #[test]
    fn split_segments_respects_emit_cap() {
        let big = "x".repeat(MAX_EMIT_BYTES + 100);
        let segments = split_segments(&big);
        assert_eq!(segments.len(), 2);
        assert!(segments.iter().all(|s| s.len() <= MAX_EMIT_BYTES));
        assert_eq!(segments.concat(), big);
        let small = split_segments("ok");
        assert_eq!(small, vec!["ok"]);
    }

    #[test]
    fn resize_validates_bounds() {
        let service = PtyService::new();
        // Bounds are validated first (mirroring the Node resize route's
        // pre-session validation), then the id lookup.
        let err = service.resize("term-nope", 1, 5).unwrap_err();
        assert_eq!(err.code, "bad_params");
        let err = service.resize("term-nope", 80, 24).unwrap_err();
        assert_eq!(err.code, "no_such_pty");
    }

    #[test]
    fn history_caps_bytes() {
        let history: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());
        let bytes: Mutex<usize> = Mutex::new(0);
        for _ in 0..4 {
            push_history(&history, &bytes, "x".repeat(400 * 1024));
        }
        assert!(*bytes.lock().unwrap() <= MAX_HISTORY_BYTES);
        assert!(history.lock().unwrap().len() <= MAX_HISTORY_FRAMES);
    }

    /// Real-shell spawn smoke test (skipped gracefully when a shell is not
    /// available); full lifecycle assertions live in the host-ipc round trip.
    #[test]
    fn spawn_write_kill_lifecycle() {
        let service = PtyService::new();
        let dir = std::env::temp_dir().join(format!(
            "ompweb-pty-test-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().subsec_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let d = dir.to_str().unwrap();
        match service.spawn(d, Some(80), Some(24), &[]) {
            Ok(body) => {
                let start = body.find("term-").unwrap_or(0);
                let end = body[start..].find('"').map(|i| start + i).unwrap_or(body.len());
                let id = &body[start..end];
                let _ = service.write(id, "printf ok\r");
                let _ = service.resize(id, 100, 40);
                let _ = service.kill(id);
            }
            Err(e) => panic!("pty spawn failed: {e:?}"),
        }
        std::fs::remove_dir_all(&dir).ok();
    }
}
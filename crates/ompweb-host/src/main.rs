//! ompweb-host (doc 06 slice 1): a standalone user-scoped host binary that
//! currently reports version/health only. OMP Supervisor, journal storage,
//! PTY/File/Git services and the local endpoint land in later migration
//! slices — this binary exists so packaging, lifecycle and rollout can be
//! exercised before any of that is wired to the UI.

use std::io::Write;
use std::path::Path;

mod ipc_server;
mod journal_shadow;
mod mini_json;
mod session_scan;
mod supervisor;

const HOST_VERSION: &str = concat!("ompweb-host ", env!("CARGO_PKG_VERSION"));

fn resolve_omp_bin() -> String {
    if let Ok(bin) = std::env::var("OMP_WEB_OMP_BIN") {
        if std::path::Path::new(&bin).exists() {
            return bin;
        }
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        format!("{home}/.bun/bin/omp"),
        format!("{home}/.local/bin/omp"),
        "/opt/homebrew/bin/omp".to_string(),
        "/usr/local/bin/omp".to_string(),
        "/usr/bin/omp".to_string(),
    ];
    for candidate in candidates {
        if std::path::Path::new(&candidate).exists() {
            return candidate;
        }
    }
    "omp".to_string()
}

fn rewrite_title_slot(path: &str, title: &str) -> Result<(), String> {
    let raw = std::fs::read(path).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&raw);
    let mut lines: Vec<&str> = text.split('\n').collect();
    if lines.is_empty() || !lines[0].starts_with("{\"type\":\"title\"") {
        return Err("not a title-slot session file".into());
    }
    let mut slot = format!("{{\"type\":\"title\",\"v\":1,\"title\":{},\"updatedAt\":\"\",\"pad\":\"", crate::ipc_server::json_str(title));
    while slot.len() < 254 {
        slot.push(' ');
    }
    slot.push_str("\"}");
    // Keep the newline terminator: the slot is 256 bytes with the \n inside.
    while slot.len() < 255 {
        slot.push(' ');
    }
    slot.push('\n');
    lines[0] = &slot;
    let mut out = lines.join("\n");
    out.push('\n');
    std::fs::write(path, out.as_bytes()).map_err(|e| e.to_string())
}

fn health_json() -> String {
    // Minimal, dependency-free JSON; schema mirrors doc 12 diagnostics shape.
    format!(
        "{{\"status\":\"ok\",\"binary\":\"ompweb-host\",\"version\":\"{}\",\"capabilities\":[\"health\",\"version\"]}}",
        env!("CARGO_PKG_VERSION")
    )
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).map(|s| s.as_str()).unwrap_or("--health");
    match mode {
        "--version" | "version" => {
            let _ = writeln!(std::io::stdout(), "{HOST_VERSION}");
        }
        "--health" | "health" => {
            let _ = writeln!(std::io::stdout(), "{}", health_json());
        }
        "--journal-shadow" | "journal-shadow" => {
            // usage: ompweb-host --journal-shadow <sessions-root> <db-path>
            let root = args.get(2).map(String::as_str).unwrap_or(".");
            let db = args.get(3).map(String::as_str).unwrap_or("shadow.db");
            match journal_shadow::run_shadow(Path::new(root), Path::new(db)) {
                Ok(stats) => {
                    let _ = writeln!(
                        std::io::stdout(),
                        "{{\"status\":\"ok\",\"files\":{},\"streams\":{},\"events\":{},\"lines\":{},\"skipped\":{},\"db_bytes\":{}}}",
                        stats.files_scanned,
                        stats.streams,
                        stats.events_appended,
                        stats.lines_total,
                        stats.lines_skipped,
                        stats.db_bytes,
                    );
                }
                Err(err) => {
                    eprintln!("journal-shadow failed: {err}");
                    std::process::exit(3);
                }
            }
        }
        "--ipc" | "ipc" => {
            // usage: ompweb-host --ipc
            // Starts the local IPC server (C03) and prints one line:
            // {"status":"ok","port":N,"token":"...","pid":N}
            // The parent (Next/desktop) reads this line, connects to the
            // port and authenticates with the token.
            let token = format!("{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0))
                + &format!("-{}", std::process::id());
            let server = match ipc_server::IpcServer::start(token.clone()) {
                Ok(srv) => srv,
                Err(err) => {
                    eprintln!("ipc start failed: {err}");
                    std::process::exit(4);
                }
            };
            let supervisor = supervisor::Supervisor::new(resolve_omp_bin(), vec![]);
            // R9: ompweb-owned runtime journal (~/.omp/agent/ompweb/runtime.db,
            // v4 P35). The Event Authority path: OMP frames → normalize →
            // journal.append → EventBus (attach subscribers).
            let journal_path = std::env::var("OMPWEB_RUNTIME_DB").unwrap_or_else(|_| {
                let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
                format!("{home}/.omp/agent/ompweb/runtime.db")
            });
            if let Some(parent) = std::path::Path::new(&journal_path).parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let journal = std::sync::Mutex::new(
                ompweb_storage::sqlite_journal::SqliteJournal::open(&journal_path, "runtime-epoch-1")
                    .map_err(|e| e.to_string())
                    .expect("runtime journal open"),
            );
            let handler: std::sync::Arc<ipc_server::Handler> = std::sync::Arc::new(move |method, params, emit| {
                match method {
                    "ping" => Ok(Some("{\"pong\":true}".into())),
                    "session.scan" => {
                        // R10 read path: mirror of session_scan::scan_root over
                        // an explicit sessions root (shadow-equivalent).
                        let root = params.get(&["root"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                        match session_scan::scan_root(std::path::Path::new(&root)) {
                            Ok(items) => Ok(Some(session_scan::projections_to_json(&items))),
                            Err(err) => Err(ipc_server::IpcError::new("scan_failed", err)),
                        }
                    }
                    "session.rename" => {
                        // R10 mutation: title slot rewrite via file rename of the
                        // session title line (in-place 256-byte slot write).
                        let root = params.get(&["root"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let path = params.get(&["path"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let title = params.get(&["title"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                        if !path.starts_with(&root) {
                            return Err(ipc_server::IpcError::new("path_out_of_scope", "path outside sessions root"));
                        }
                        match rewrite_title_slot(&path, &title) {
                            Ok(()) => Ok(Some("null".into())),
                            Err(err) => Err(ipc_server::IpcError::new("rename_failed", err)),
                        }
                    }
                    "session.delete" => {
                        // R10 mutation: remove a session file (archive semantics
                        // stay in Node; this is the raw authority path).
                        let root = params.get(&["root"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let path = params.get(&["path"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                        if !path.starts_with(&root) {
                            return Err(ipc_server::IpcError::new("path_out_of_scope", "path outside sessions root"));
                        }
                        match std::fs::remove_file(&path) {
                            Ok(()) => Ok(Some("null".into())),
                            Err(err) => Err(ipc_server::IpcError::new("delete_failed", err.to_string())),
                        }
                    }
                    "journal.append" => {
                        let stream = params.get(&["stream"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let kind = params.get(&["kind"]).and_then(|v| v.as_str()).unwrap_or("message").to_string();
                        let payload = params.get(&["payload"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let class = match params.get(&["class"]).and_then(|v| v.as_str()).unwrap_or("reliable") {
                            "coalesced" => ompweb_storage::sqlite_journal::EventClass::Coalesced,
                            "ephemeral" => ompweb_storage::sqlite_journal::EventClass::Ephemeral,
                            _ => ompweb_storage::sqlite_journal::EventClass::Reliable,
                        };
                        let now_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
                        match journal.lock().unwrap().append(&stream, &kind, class, &payload, now_ms) {
                            Ok(seq) => Ok(Some(format!("{{\"seq\":{}}}", seq))),
                            Err(err) => Err(ipc_server::IpcError::new("journal_error", err.to_string())),
                        }
                    }
                    "journal.view" => {
                        let stream = params.get(&["stream"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                        match journal.lock().unwrap().view_seqs(&stream) {
                            Ok(seqs) => {
                                let mut body = String::from("[");
                                for (i, seq) in seqs.iter().enumerate() {
                                    if i > 0 { body.push(','); }
                                    body.push_str(&seq.to_string());
                                }
                                body.push(']');
                                Ok(Some(body))
                            }
                            Err(err) => Err(ipc_server::IpcError::new("journal_error", err.to_string())),
                        }
                    }
                    "host.health" => Ok(Some(format!("{{\"pid\":{},\"binary\":\"ompweb-host\",\"version\":{}}}", std::process::id(), ipc_server::json_str(HOST_VERSION)))),
                    "agent.spawn" => {
                        let cwd = params.get(&["cwd"]).and_then(|v| v.as_str()).unwrap_or(".").to_string();
                        let session_id = params.get(&["sessionId"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                        if session_id.is_empty() {
                            return Err(ipc_server::IpcError::new("bad_params", "sessionId required"));
                        }
                        match supervisor.spawn(&session_id, &cwd) {
                            Ok((pid, restarts)) => Ok(Some(format!("{{\"pid\":{},\"restarts\":{}}}", pid, restarts))),
                            Err(err) => Err(ipc_server::IpcError::new("spawn_failed", err)),
                        }
                    }
                    "agent.send" => {
                        let session_id = params.get(&["sessionId"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let command = params.get(&["command"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                        if command.is_empty() {
                            return Err(ipc_server::IpcError::new("bad_params", "command required"));
                        }
                        match supervisor.send(&session_id, &command) {
                            Ok(()) => Ok(Some("null".into())),
                            Err(err) => Err(ipc_server::IpcError::new("send_failed", err)),
                        }
                    }
                    "agent.list" => {
                        let sessions = supervisor.list();
                        let mut body = String::from("[");
                        for (i, (id, pid, restarts)) in sessions.iter().enumerate() {
                            if i > 0 { body.push(','); }
                            body.push_str(&format!("{{\"sessionId\":{},\"pid\":{},\"restarts\":{}}}", ipc_server::json_str(id), pid, restarts));
                        }
                        body.push(']');
                        Ok(Some(body))
                    }
                    "agent.kill" => {
                        let session_id = params.get(&["sessionId"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                        match supervisor.kill(&session_id) {
                            Ok(()) => Ok(Some("null".into())),
                            Err(err) => Err(ipc_server::IpcError::new("kill_failed", err)),
                        }
                    }
                    "agent.attach" => {
                        let session_id = params.get(&["sessionId"]).and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let rx = match supervisor.subscribe(&session_id) {
                            Ok(rx) => rx,
                            Err(err) => return Err(ipc_server::IpcError::new("no_such_session", err)),
                        };
                        // Replay frames emitted before this subscriber attached
                        // (fast omp startup may have already produced ready/init
                        // frames — an attach that misses them would hang).
                        for frame in supervisor.recent_frames(&session_id) {
                            emit(&format!("{{\"type\":\"frame\",\"frame\":{}}}", frame));
                        }
                        // Streaming: block this request, emitting child frames.
                        for event in rx.iter() {
                            match event {
                                supervisor::SessionEvent::Frame(frame) => {
                                    emit(&format!("{{\"type\":\"frame\",\"frame\":{}}}", frame));
                                }
                                supervisor::SessionEvent::Exited { code, signal } => {
                                    emit(&format!("{{\"type\":\"exit\",\"code\":{},\"signal\":{}}}",
                                        code.map(|c| c.to_string()).unwrap_or_else(|| "null".into()),
                                        signal.map(|c| c.to_string()).unwrap_or_else(|| "null".into())));
                                    return Ok(Some("null".into()));
                                }
                            }
                        }
                        Ok(Some("null".into()))
                    }
                    _ => Err(ipc_server::IpcError::new("unknown_method", format!("no method {method}"))),
                }
            });
            let _ = writeln!(
                std::io::stdout(),
                "{{\"status\":\"ok\",\"port\":{},\"token\":{},\"pid\":{}}}",
                server.port(),
                ipc_server::json_str(&token),
                std::process::id()
            );
            std::io::stdout().flush().ok();
            server.serve(handler);
        }
        "--scan-sessions" | "scan-sessions" => {
            // usage: ompweb-host --scan-sessions <sessions-root>
            let root = args.get(2).map(String::as_str).unwrap_or(".");
            match session_scan::scan_root(Path::new(root)) {
                Ok(items) => {
                    let _ = writeln!(std::io::stdout(), "{}", session_scan::projections_to_json(&items));
                }
                Err(err) => {
                    eprintln!("scan-sessions failed: {err}");
                    std::process::exit(3);
                }
            }
        }
        other => {
            eprintln!("unknown flag: {other}\nusage: ompweb-host [--version | --health | --journal-shadow <root> <db> | --scan-sessions <root>]");
            std::process::exit(2);
        }
    }
}


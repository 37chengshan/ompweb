//! ompweb-host (doc 06 slice 1): a standalone user-scoped host binary that
//! currently reports version/health only. OMP Supervisor, journal storage,
//! PTY/File/Git services and the local endpoint land in later migration
//! slices — this binary exists so packaging, lifecycle and rollout can be
//! exercised before any of that is wired to the UI.

use std::io::Write;
use std::path::Path;

mod command_service;
mod device_service;
mod file_service;
mod git_service;
mod ipc_server;
mod journal_shadow;
mod mini_json;
mod process_visibility;
mod pty_service;
mod remote_runtime;
mod session_scan;
mod settings_service;
mod supervisor;

pub use file_service::is_path_within;

const HOST_VERSION: &str = concat!("ompweb-host ", env!("CARGO_PKG_VERSION"));

/// Extracts a JSON array of strings from params (e.g. `roots` for files.*).
fn string_array(value: Option<&mini_json::JsonValue>) -> Vec<String> {
    match value {
        Some(mini_json::JsonValue::Arr(items)) => items
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect(),
        _ => Vec::new(),
    }
}

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
    let mut slot = format!(
        "{{\"type\":\"title\",\"v\":1,\"title\":{},\"updatedAt\":\"\",\"pad\":\"",
        crate::ipc_server::json_str(title)
    );
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
            // 128-bit token from /dev/urandom when available (same-host
            // adversary hardening; subsec_nanos+pid is only the fallback).
            let token = match std::fs::File::open("/dev/urandom").and_then(|mut f| {
                use std::io::Read;
                let mut buf = [0u8; 16];
                f.read_exact(&mut buf)
                    .map(|_| buf.iter().map(|b| format!("{b:02x}")).collect::<String>())
            }) {
                Ok(hex) => hex,
                Err(_) => {
                    format!(
                        "{:x}",
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.subsec_nanos())
                            .unwrap_or(0)
                    ) + &format!("-{}", std::process::id())
                }
            };
            let server = match ipc_server::IpcServer::start(token.clone()) {
                Ok(srv) => srv,
                Err(err) => {
                    eprintln!("ipc start failed: {err}");
                    std::process::exit(4);
                }
            };
            let supervisor =
                std::sync::Arc::new(supervisor::Supervisor::new(resolve_omp_bin(), vec![]));
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
                ompweb_storage::sqlite_journal::SqliteJournal::open(
                    &journal_path,
                    "runtime-epoch-1",
                )
                .map_err(|e| e.to_string())
                .expect("runtime journal open"),
            );
            // Device registry lives in the same runtime DB (doc 16 route 6:
            // runtime.db grows devices/enrollment tables; route 13 authority).
            let device_registry =
                ompweb_storage::DeviceRegistry::open(std::path::Path::new(&journal_path))
                    .expect("device registry open");
            let device_service = std::sync::Arc::new(device_service::DeviceService::with_registry(
                device_registry,
            ));
            // RemoteRuntime (doc 16 route 14 first slice): a second loopback
            // listener serving the remote protocol v1 WS endpoint. Mutation
            // executors route agent.prompt/agent.cancel into the supervisor.
            let supervisor_handle = supervisor.clone();
            let remote_executor: remote_runtime::Executor =
                std::sync::Arc::new(move |_device, command| {
                    let command_value =
                        mini_json::JsonValue::parse(command).unwrap_or(mini_json::JsonValue::Null);
                    let session_id = command_value
                        .get(&["sessionId"])
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if session_id.is_empty() {
                        return Err("agent command requires sessionId".into());
                    }
                    supervisor_handle
                        .send(&session_id, command)
                        .map(|()| "null".to_string())
                        .map_err(|e| e.to_string())
                });
            let remote_runtime = remote_runtime::RemoteRuntimeShared::new(
                device_service.clone(),
                remote_executor,
                "runtime-epoch-1",
                25_000,
            );
            let remote_bind =
                std::env::var("OMP_WEB_REMOTE_BIND").unwrap_or_else(|_| "127.0.0.1:0".to_string());
            let remote_listener =
                std::net::TcpListener::bind(&remote_bind).expect("remote ws bind");
            let remote_port = remote_listener.local_addr().expect("remote addr").port();
            // tokio::net::TcpListener::from_std requires a non-blocking fd.
            remote_listener
                .set_nonblocking(true)
                .expect("remote nonblocking");
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
                rt.block_on(async move {
                    let listener =
                        tokio::net::TcpListener::from_std(remote_listener).expect("tokio listener");
                    let _ = remote_runtime.serve(listener, 16).await;
                });
            });
            let handler: std::sync::Arc<ipc_server::Handler> =
                std::sync::Arc::new(move |method, params, emit| {
                    match method {
                        "ping" => Ok(Some("{\"pong\":true}".into())),
                        "session.scan" => {
                            // R10 read path: mirror of session_scan::scan_root over
                            // an explicit sessions root (shadow-equivalent).
                            let root = params
                                .get(&["root"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            match session_scan::scan_root(std::path::Path::new(&root)) {
                                Ok(items) => Ok(Some(session_scan::projections_to_json(&items))),
                                Err(err) => Err(ipc_server::IpcError::new("scan_failed", err)),
                            }
                        }
                        "session.rename" => {
                            // R10 mutation: title slot rewrite via file rename of the
                            // session title line (in-place 256-byte slot write).
                            let root = params
                                .get(&["root"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let path = params
                                .get(&["path"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let title = params
                                .get(&["title"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            if !is_path_within(&root, &path) {
                                return Err(ipc_server::IpcError::new(
                                    "path_out_of_scope",
                                    "path outside sessions root",
                                ));
                            }
                            match rewrite_title_slot(&path, &title) {
                                Ok(()) => Ok(Some("null".into())),
                                Err(err) => Err(ipc_server::IpcError::new("rename_failed", err)),
                            }
                        }
                        "session.delete" => {
                            // R10 mutation: remove a session file (archive semantics
                            // stay in Node; this is the raw authority path).
                            let root = params
                                .get(&["root"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let path = params
                                .get(&["path"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            if !is_path_within(&root, &path) {
                                return Err(ipc_server::IpcError::new(
                                    "path_out_of_scope",
                                    "path outside sessions root",
                                ));
                            }
                            match std::fs::remove_file(&path) {
                                Ok(()) => Ok(Some("null".into())),
                                Err(err) => {
                                    Err(ipc_server::IpcError::new("delete_failed", err.to_string()))
                                }
                            }
                        }
                        "journal.append" => {
                            let stream = params
                                .get(&["stream"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let kind = params
                                .get(&["kind"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("message")
                                .to_string();
                            let payload = params
                                .get(&["payload"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let class = match params
                                .get(&["class"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("reliable")
                            {
                                "coalesced" => {
                                    ompweb_storage::sqlite_journal::EventClass::Coalesced
                                }
                                "ephemeral" => {
                                    ompweb_storage::sqlite_journal::EventClass::Ephemeral
                                }
                                _ => ompweb_storage::sqlite_journal::EventClass::Reliable,
                            };
                            let now_ms = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .map(|d| d.as_millis() as i64)
                                .unwrap_or(0);
                            match journal
                                .lock()
                                .unwrap()
                                .append(&stream, &kind, class, &payload, now_ms)
                            {
                                Ok(seq) => Ok(Some(format!("{{\"seq\":{}}}", seq))),
                                Err(err) => {
                                    Err(ipc_server::IpcError::new("journal_error", err.to_string()))
                                }
                            }
                        }
                        "journal.view" => {
                            let stream = params
                                .get(&["stream"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            match journal.lock().unwrap().view_seqs(&stream) {
                                Ok(seqs) => {
                                    let mut body = String::from("[");
                                    for (i, seq) in seqs.iter().enumerate() {
                                        if i > 0 {
                                            body.push(',');
                                        }
                                        body.push_str(&seq.to_string());
                                    }
                                    body.push(']');
                                    Ok(Some(body))
                                }
                                Err(err) => {
                                    Err(ipc_server::IpcError::new("journal_error", err.to_string()))
                                }
                            }
                        }
                        "settings.list" => settings_service::list().map(Some),
                        "settings.path" => settings_service::path().map(Some),
                        "settings.set" => {
                            let key = params.get(&["key"]).and_then(|v| v.as_str()).unwrap_or("");
                            let value = params
                                .get(&["value"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            settings_service::set(key, value).map(Some)
                        }
                        "settings.reset" => {
                            let key = params.get(&["key"]).and_then(|v| v.as_str()).unwrap_or("");
                            settings_service::reset(key).map(Some)
                        }
                        "host.health" => Ok(Some(format!(
                            "{{\"pid\":{},\"binary\":\"ompweb-host\",\"version\":{}}}",
                            std::process::id(),
                            ipc_server::json_str(HOST_VERSION)
                        ))),
                        "files.list" => {
                            // Doc 16 route 9 first slice: directory listing. Node
                            // remains the root authority and passes the computed
                            // allowed roots; the host re-enforces containment.
                            let roots = string_array(params.get(&["roots"]));
                            let path = params
                                .get(&["path"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            match file_service::list(&roots, &path) {
                                Ok(body) => Ok(Some(body)),
                                Err(err) => Err(err),
                            }
                        }
                        "files.read" => {
                            // Text-JSON read (<256 KiB). Binary/streaming reads
                            // stay on the Node legacy surface for this slice.
                            let roots = string_array(params.get(&["roots"]));
                            let path = params
                                .get(&["path"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            match file_service::read(&roots, &path) {
                                Ok(body) => Ok(Some(body)),
                                Err(err) => Err(err),
                            }
                        }
                        "files.meta" => {
                            let roots = string_array(params.get(&["roots"]));
                            let path = params
                                .get(&["path"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            match file_service::meta(&roots, &path) {
                                Ok(body) => Ok(Some(body)),
                                Err(err) => Err(err),
                            }
                        }
                        "git.status" => {
                            // Doc 16 route 10 first slice: local git status. Node
                            // passes allowed roots + cwd; the host re-enforces
                            // containment and spawns git itself.
                            let roots = string_array(params.get(&["roots"]));
                            let cwd = params
                                .get(&["cwd"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            match git_service::status(&roots, &cwd) {
                                Ok(body) => Ok(Some(body)),
                                Err(err) => Err(err),
                            }
                        }
                        "git.diff" => {
                            // Single-file diff preview (route 10 later slice):
                            // read-only, root-gated on both cwd and file path.
                            let roots = string_array(params.get(&["roots"]));
                            let cwd = params
                                .get(&["cwd"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let file_path = params
                                .get(&["filePath"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            match git_service::diff(&roots, &cwd, &file_path) {
                                Ok(body) => Ok(Some(body)),
                                Err(err) => Err(err),
                            }
                        }
                        "git.branches" => {
                            let roots = string_array(params.get(&["roots"]));
                            let cwd = params
                                .get(&["cwd"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            match git_service::branches(&roots, &cwd) {
                                Ok(body) => Ok(Some(body)),
                                Err(err) => Err(err),
                            }
                        }
                        "git.checkout" => {
                            let roots = string_array(params.get(&["roots"]));
                            let cwd = params
                                .get(&["cwd"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let branch = params
                                .get(&["branch"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            match git_service::checkout(&roots, &cwd, &branch) {
                                Ok(body) => Ok(Some(body)),
                                Err(err) => Err(err),
                            }
                        }
                        "git.commit" => {
                            // Mutation authority (audit 阶段二): commit runs on the
                            // host in Rust mode; the Node implementation exists only
                            // for the explicit OMPWEB_BACKEND=node rollback.
                            let roots = string_array(params.get(&["roots"]));
                            let cwd = params
                                .get(&["cwd"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let message = params
                                .get(&["message"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            match git_service::commit(&roots, &cwd, &message) {
                                Ok(body) => Ok(Some(body)),
                                Err(err) => Err(err),
                            }
                        }
                        "git.push" => {
                            let roots = string_array(params.get(&["roots"]));
                            let cwd = params
                                .get(&["cwd"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            match git_service::push(&roots, &cwd) {
                                Ok(body) => Ok(Some(body)),
                                Err(err) => Err(err),
                            }
                        }
                        "pty.spawn" | "pty.write" | "pty.resize" | "pty.kill" | "pty.attach" => {
                            // Doc 16 route 8: terminal domain lives on the host.
                            // All pty.* param parsing, containment enforcement and
                            // streaming live in pty_service::dispatch (which owns
                            // the documented security model for this domain).
                            pty_service::dispatch(method, params, emit)
                        }
                        // Doc 16 route 13: device identity & enrollment in Rust.
                        "device.issue" | "device.enroll" | "device.touch" | "device.revoke"
                        | "device.revokeAll" | "device.list" | "device.authSecret" => {
                            device_service::dispatch(method, params, &device_service)
                        }
                        "commands.run" => {
                            // Doc 16 route 12 first slice: registry-resolved quick
                            // scripts execute on the host (Node keeps the on-disk
                            // registry and root authority). env carries per-request
                            // overrides (proxy vars) merged by the Node layer.
                            let roots = string_array(params.get(&["roots"]));
                            let cwd = params
                                .get(&["cwd"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let command = params
                                .get(&["command"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let detach = params
                                .get(&["detach"])
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            let mut envs: Vec<(String, String)> = Vec::new();
                            if let Some(mini_json::JsonValue::Obj(entries)) = params.get(&["env"]) {
                                for (key, value) in entries {
                                    if let Some(value) = value.as_str() {
                                        envs.push((key.clone(), value.to_string()));
                                    }
                                }
                            }
                            match command_service::run(&roots, &cwd, &command, detach, &envs) {
                                Ok(body) => Ok(Some(body)),
                                Err(err) => Err(err),
                            }
                        }
                        "agent.spawn" => {
                            let cwd = params
                                .get(&["cwd"])
                                .and_then(|v| v.as_str())
                                .unwrap_or(".")
                                .to_string();
                            let session_id = params
                                .get(&["sessionId"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            if session_id.is_empty() {
                                return Err(ipc_server::IpcError::new(
                                    "bad_params",
                                    "agent.spawn: sessionId required",
                                ));
                            }
                            // Route 4 (doc 16): spawn args travel verbatim from the
                            // Node adapter (--resume/--tools/--advisor/...). Trust
                            // boundary: values originate ONLY in the Node layer
                            // (rpc-manager buildSessionSpawnArgs) over
                            // token-authenticated local IPC; the host mirrors the
                            // Node spawn order and does not re-interpret them.
                            let args: Vec<String> = match params.get(&["args"]) {
                                Some(crate::mini_json::JsonValue::Arr(items)) => items
                                    .iter()
                                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                    .collect(),
                                _ => Vec::new(),
                            };
                            match supervisor.spawn(&session_id, &cwd, &args) {
                                Ok((pid, restarts)) => Ok(Some(format!(
                                    "{{\"pid\":{},\"restarts\":{}}}",
                                    pid, restarts
                                ))),
                                Err(err) => Err(ipc_server::IpcError::new("spawn_failed", err)),
                            }
                        }
                        "agent.send" => {
                            let session_id = params
                                .get(&["sessionId"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let command = params
                                .get(&["command"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            if command.is_empty() {
                                return Err(ipc_server::IpcError::new(
                                    "bad_params",
                                    "command required",
                                ));
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
                                if i > 0 {
                                    body.push(',');
                                }
                                body.push_str(&format!(
                                    "{{\"sessionId\":{},\"pid\":{},\"restarts\":{}}}",
                                    ipc_server::json_str(id),
                                    pid,
                                    restarts
                                ));
                            }
                            body.push(']');
                            Ok(Some(body))
                        }
                        "agent.kill" => {
                            let session_id = params
                                .get(&["sessionId"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            match supervisor.kill(&session_id) {
                                Ok(()) => Ok(Some("null".into())),
                                Err(err) => Err(ipc_server::IpcError::new("kill_failed", err)),
                            }
                        }
                        "agent.attach" => {
                            let session_id = params
                                .get(&["sessionId"])
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let rx = match supervisor.subscribe(&session_id) {
                                Ok(rx) => rx,
                                Err(err) => {
                                    return Err(ipc_server::IpcError::new("no_such_session", err))
                                }
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
                                        emit(&format!(
                                            "{{\"type\":\"frame\",\"frame\":{}}}",
                                            frame
                                        ));
                                    }
                                    supervisor::SessionEvent::Exited { code, signal } => {
                                        emit(&format!(
                                            "{{\"type\":\"exit\",\"code\":{},\"signal\":{}}}",
                                            code.map(|c| c.to_string())
                                                .unwrap_or_else(|| "null".into()),
                                            signal
                                                .map(|c| c.to_string())
                                                .unwrap_or_else(|| "null".into())
                                        ));
                                        return Ok(Some("null".into()));
                                    }
                                }
                            }
                            Ok(Some("null".into()))
                        }
                        _ => Err(ipc_server::IpcError::new(
                            "unknown_method",
                            format!("no method {method}"),
                        )),
                    }
                });
            let _ = writeln!(
                std::io::stdout(),
                "{{\"status\":\"ok\",\"port\":{},\"token\":{},\"pid\":{},\"remotePort\":{}}}",
                server.port(),
                ipc_server::json_str(&token),
                std::process::id(),
                remote_port,
            );
            std::io::stdout().flush().ok();
            server.serve(handler);
        }
        "--scan-sessions" | "scan-sessions" => {
            // usage: ompweb-host --scan-sessions <sessions-root>
            let root = args.get(2).map(String::as_str).unwrap_or(".");
            match session_scan::scan_root(Path::new(root)) {
                Ok(items) => {
                    let _ = writeln!(
                        std::io::stdout(),
                        "{}",
                        session_scan::projections_to_json(&items)
                    );
                }
                Err(err) => {
                    eprintln!("scan-sessions failed: {err}");
                    std::process::exit(3);
                }
            }
        }
        "--files-list" | "files-list" => {
            // usage: ompweb-host --files-list <dir>  (parity/CLI mode: entries array, no roots gate)
            let dir = args.get(2).map(String::as_str).unwrap_or(".");
            match file_service::cli_list(dir) {
                Ok(body) => {
                    let _ = writeln!(std::io::stdout(), "{body}");
                }
                Err(err) => {
                    eprintln!("files-list failed: {err}");
                    std::process::exit(3);
                }
            }
        }
        "--files-read" | "files-read" => {
            // usage: ompweb-host --files-read <path>  (parity/CLI mode)
            let path = args.get(2).map(String::as_str).unwrap_or("");
            match file_service::cli_read(path) {
                Ok(body) => {
                    let _ = writeln!(std::io::stdout(), "{body}");
                }
                Err(err) => {
                    eprintln!("files-read failed: {err}");
                    std::process::exit(3);
                }
            }
        }
        "--files-meta" | "files-meta" => {
            // usage: ompweb-host --files-meta <path>  (parity/CLI mode)
            let path = args.get(2).map(String::as_str).unwrap_or("");
            match file_service::cli_meta(path) {
                Ok(body) => {
                    let _ = writeln!(std::io::stdout(), "{body}");
                }
                Err(err) => {
                    eprintln!("files-meta failed: {err}");
                    std::process::exit(3);
                }
            }
        }
        "--git-status" | "git-status" => {
            // usage: ompweb-host --git-status <cwd>  (parity/CLI mode)
            let cwd = args.get(2).map(String::as_str).unwrap_or(".");
            match git_service::cli_status(cwd) {
                Ok(body) => {
                    let _ = writeln!(std::io::stdout(), "{body}");
                }
                Err(err) => {
                    eprintln!("git-status failed: {err}");
                    std::process::exit(3);
                }
            }
        }
        "--git-branches" | "git-branches" => {
            // usage: ompweb-host --git-branches <cwd>  (parity/CLI mode)
            let cwd = args.get(2).map(String::as_str).unwrap_or(".");
            match git_service::cli_branches(cwd) {
                Ok(body) => {
                    let _ = writeln!(std::io::stdout(), "{body}");
                }
                Err(err) => {
                    eprintln!("git-branches failed: {err}");
                    std::process::exit(3);
                }
            }
        }
        "--git-checkout" | "git-checkout" => {
            // usage: ompweb-host --git-checkout <cwd> <branch>  (parity/CLI mode)
            let cwd = args.get(2).map(String::as_str).unwrap_or(".");
            let branch = args.get(3).map(String::as_str).unwrap_or("");
            match git_service::cli_checkout(cwd, branch) {
                Ok(body) => {
                    let _ = writeln!(std::io::stdout(), "{body}");
                }
                Err(err) => {
                    eprintln!("git-checkout failed: {err}");
                    std::process::exit(3);
                }
            }
        }
        "--git-commit" | "git-commit" => {
            // usage: ompweb-host --git-commit <cwd> <message>  (parity/CLI mode)
            let cwd = args.get(2).map(String::as_str).unwrap_or(".");
            let message = args.get(3).map(String::as_str).unwrap_or("");
            match git_service::cli_commit(cwd, message) {
                Ok(body) => {
                    let _ = writeln!(std::io::stdout(), "{body}");
                }
                Err(err) => {
                    eprintln!("git-commit failed: {err}");
                    std::process::exit(3);
                }
            }
        }
        "--git-push" | "git-push" => {
            // usage: ompweb-host --git-push <cwd>  (parity/CLI mode)
            let cwd = args.get(2).map(String::as_str).unwrap_or(".");
            match git_service::cli_push(cwd) {
                Ok(body) => {
                    let _ = writeln!(std::io::stdout(), "{body}");
                }
                Err(err) => {
                    eprintln!("git-push failed: {err}");
                    std::process::exit(3);
                }
            }
        }
        "--git-diff" | "git-diff" => {
            // usage: ompweb-host --git-diff <cwd> <path>  (parity/CLI mode)
            let cwd = args.get(2).map(String::as_str).unwrap_or(".");
            let file_path = args.get(3).map(String::as_str).unwrap_or("");
            match git_service::cli_diff(cwd, file_path) {
                Ok(body) => {
                    let _ = writeln!(std::io::stdout(), "{body}");
                }
                Err(err) => {
                    eprintln!("git-diff failed: {err}");
                    std::process::exit(3);
                }
            }
        }
        other => {
            eprintln!("unknown flag: {other}\nusage: ompweb-host [--version | --health | --journal-shadow <root> <db> | --scan-sessions <root> | --files-list <dir> | --files-read <path> | --files-meta <path> | --git-status <cwd> | --git-branches <cwd> | --git-checkout <cwd> <branch> | --git-commit <cwd> <message> | --git-push <cwd> | --git-diff <cwd> <path>]");
            std::process::exit(2);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::is_path_within;

    #[test]
    fn containment_accepts_children_and_rejects_siblings() {
        let root = "/Users/u/.omp/agent/sessions";
        assert!(is_path_within(root, "/Users/u/.omp/agent/sessions/a.jsonl"));
        assert!(is_path_within(
            root,
            "/Users/u/.omp/agent/sessions/sub/b.jsonl"
        ));
        assert!(is_path_within(root, root));
        assert!(!is_path_within(
            root,
            "/Users/u/.omp/agent/sessions2/a.jsonl"
        ));
        assert!(!is_path_within(
            root,
            "/Users/u/.omp/agent/sessions-archive/a.jsonl"
        ));
        assert!(!is_path_within(
            root,
            "/Users/u/.omp/agent/sessions/../other/x"
        ));
        assert!(!is_path_within(root, "/etc/passwd"));
        assert!(!is_path_within(root, ""));
    }
}

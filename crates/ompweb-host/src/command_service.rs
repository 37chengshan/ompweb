//! command_service: Rust authority for quick-script execution
//! (doc 16 route 12, first slice). Mirrors app/api/scripts/run/route.ts.
//!
//! SECURITY MODEL (identical to the Node route it ports):
//! - The command TEXT never comes from the request body — the body only names
//!   a script; the executable text is read from the on-disk registry
//!   (project .omp/scripts.json + global registry) by the Node layer, which
//!   passes the resolved command to this service.
//! - Execution always goes through a constant literal shell binary and a
//!   FIXED argv shape (["/bin/sh", "-c", command] / ["cmd.exe","/d","/s","/c",command])
//!   — the command is a plain argv element, never interpolated into a
//!   runtime-built option string. The snippet being shell source is the
//!   feature's contract, exactly like a Makefile target.
//! - The host re-enforces that cwd is inside the allowed roots (defense in
//!   depth; Node keeps root authority).
//!
//! wait mode: 60s timeout, 20 KiB merged-output cap, SIGTERM on timeout.
//! detach mode: background spawn writing to `<project>/.omp/scripts-logs/<ts>.log`.
//!
//! Explicitly-exempted Node surfaces (not pending migration — see
//! backend-ownership.yaml commands.migrate): script-registry reads (quick
//! scripts live on disk and are resolved by Node), the ui-request lifecycle
//! (omp's extension_ui_request frame flow + React UI rendering), and slash
//! registration (authority is omp's get_available_commands; Node only
//! translates).

use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use crate::file_service::is_path_within_any;
use crate::ipc_server::{json_str, IpcError};

const WAIT_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_OUTPUT_BYTES: usize = 20 * 1024;

fn spawn_shell_with_env(
    cwd: &str,
    command: &str,
    stdout: Stdio,
    stderr: Stdio,
    envs: &[(String, String)],
) -> Result<Child, std::io::Error> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("cmd.exe");
        cmd.args(["/d", "/s", "/c", command]);
        cmd.current_dir(cwd)
            .env("LC_ALL", "C")
            .stdin(Stdio::null())
            .stdout(stdout)
            .stderr(stderr);
        cmd.envs(envs.iter().map(|(k, v)| (k.as_str(), v.as_str())));
        cmd.spawn()
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", command]);
        cmd.current_dir(cwd)
            .env("LC_ALL", "C")
            .stdin(Stdio::null())
            .stdout(stdout)
            .stderr(stderr);
        cmd.envs(envs.iter().map(|(k, v)| (k.as_str(), v.as_str())));
        cmd.spawn()
    }
}

/// 20 KiB merged-output cap (mirror of MAX_OUTPUT_BYTES in the route).
struct Sink {
    bytes: Vec<u8>,
    capped: bool,
}

impl Sink {
    fn new() -> Self {
        Sink {
            bytes: Vec::with_capacity(MAX_OUTPUT_BYTES),
            capped: false,
        }
    }
    fn feed(&mut self, chunk: &[u8]) {
        if self.capped {
            return;
        }
        let room = MAX_OUTPUT_BYTES - self.bytes.len();
        if chunk.len() >= room {
            self.bytes.extend_from_slice(&chunk[..room]);
            self.capped = true;
        } else {
            self.bytes.extend_from_slice(chunk);
        }
    }
}

/// Read one pipe into the shared sink until EOF (own thread — a blocking
/// read must never stall the wait loop that watches for child exit).
fn drain_thread<R: Read + Send + 'static>(
    mut pipe: R,
    sink: std::sync::Arc<std::sync::Mutex<Sink>>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match pipe.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => sink.lock().unwrap().feed(&buf[..n]),
            }
        }
    })
}

/// Wait mode: run to completion (60s cap) with merged, capped output.
fn run_wait(cwd: &str, command: &str, envs: &[(String, String)]) -> Result<String, IpcError> {
    run_wait_with_timeout(cwd, command, WAIT_TIMEOUT, envs)
}

fn run_wait_with_timeout(
    cwd: &str,
    command: &str,
    timeout: Duration,
    envs: &[(String, String)],
) -> Result<String, IpcError> {
    let mut child = spawn_shell_with_env(cwd, command, Stdio::piped(), Stdio::piped(), envs)
        .map_err(|e| IpcError::new("spawn_failed", e.to_string()))?;
    let sink = std::sync::Arc::new(std::sync::Mutex::new(Sink::new()));
    let mut readers = Vec::new();
    if let Some(out) = child.stdout.take() {
        readers.push(drain_thread(out, sink.clone()));
    }
    if let Some(err) = child.stderr.take() {
        readers.push(drain_thread(err, sink.clone()));
    }
    let deadline = Instant::now() + timeout;
    let mut timed_out = false;
    loop {
        if child.try_wait().ok().flatten().is_some() {
            break;
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            timed_out = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    for reader in readers {
        let _ = reader.join();
    }
    let exit_code = if timed_out {
        None
    } else {
        child.wait().ok().and_then(|s| s.code())
    };
    let code_json = match exit_code {
        Some(code) => code.to_string(),
        None => "null".to_string(),
    };
    let sink = sink.lock().unwrap();
    Ok(format!(
        "{{\"mode\":\"wait\",\"exitCode\":{},\"timedOut\":{},\"output\":{}}}",
        code_json,
        timed_out,
        json_str(&String::from_utf8_lossy(&sink.bytes))
    ))
}

/// Detach mode: spawn in the background writing to a project-local log file.
fn run_detach(cwd: &str, command: &str, envs: &[(String, String)]) -> Result<String, IpcError> {
    let log_dir = format!("{cwd}/.omp/scripts-logs");
    std::fs::create_dir_all(&log_dir)
        .map_err(|e| IpcError::new("log_dir_failed", e.to_string()))?;
    let log_path = format!(
        "{log_dir}/{}.log",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| IpcError::new("log_open_failed", e.to_string()))?;
    let child = spawn_shell_with_env(
        cwd,
        command,
        Stdio::from(
            file.try_clone()
                .map_err(|e| IpcError::new("log_clone_failed", e.to_string()))?,
        ),
        Stdio::from(file),
        envs,
    )
    .map_err(|e| IpcError::new("spawn_failed", e.to_string()))?;
    let pid = child.id();
    // Never reap: the script outlives this request, like Node's unref().
    std::mem::forget(child);
    Ok(format!(
        "{{\"mode\":\"detach\",\"pid\":{},\"logPath\":{}}}",
        pid,
        json_str(&log_path)
    ))
}

/// IPC arm `commands.run` — wait or detach a registry-resolved script.
/// Node stays the script-registry + root authority; the host re-enforces
/// containment and owns process spawning. `envs` carries per-request env
/// overrides (proxy vars) merged by the Node layer; the host's own inherited
/// environment stays the base, exactly like Node's `{...process.env, ...proxy}`.
pub fn run(
    roots: &[String],
    cwd: &str,
    command: &str,
    detach: bool,
    envs: &[(String, String)],
) -> Result<String, IpcError> {
    if !is_path_within_any(roots, cwd) {
        return Err(IpcError::new("access_denied", "cwd outside allowed roots"));
    }
    if command.trim().is_empty() {
        return Err(IpcError::new("bad_params", "command required"));
    }
    if detach {
        run_detach(cwd, command, envs)
    } else {
        run_wait(cwd, command, envs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> String {
        let dir = std::env::temp_dir().join(format!(
            "ompweb-cmd-{tag}-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .subsec_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir.to_str().unwrap().to_string()
    }

    #[test]
    fn wait_mode_returns_output_and_exit_code() {
        let d = temp_dir("test");
        let out = run_wait(&d, "printf 'hello cmd'", &[]).unwrap();
        assert!(out.contains("hello cmd"));
        assert!(out.contains("\"timedOut\":false"));
        let out = run_wait(&d, "exit 3", &[]).unwrap();
        assert!(out.contains("\"exitCode\":3"));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn wait_mode_times_out() {
        let d = temp_dir("timeout");
        // 60s production cap would make the test slow; exercise the same
        // kill-on-timeout path with a short deadline.
        let out = run_wait_with_timeout(&d, "sleep 5", Duration::from_millis(300), &[]).unwrap();
        assert!(out.contains("\"timedOut\":true"));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn wait_mode_caps_output_at_20k() {
        let d = temp_dir("cap");
        let out = run_wait(&d, "head -c 100000 /dev/zero | tr '\\0' 'x'", &[]).unwrap();
        assert!(out.contains("\"timedOut\":false"));
        assert!(out.len() < 24 * 1024, "output must be capped");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn detach_writes_log_and_returns_pid() {
        let d = temp_dir("detach");
        let out = run_detach(&d, "printf 'detached log'; sleep 0.2", &[]).unwrap();
        assert!(out.contains("\"mode\":\"detach\""));
        assert!(out.contains("\"pid\":"));
        assert!(out.contains(".omp/scripts-logs/"));
        std::thread::sleep(Duration::from_millis(500));
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn run_gates_containment_and_empty_commands() {
        let err = run(&["/tmp/root".to_string()], "/etc", "echo x", false, &[]).unwrap_err();
        assert_eq!(err.code, "access_denied");
        let err = run(&["/tmp/root".to_string()], "/tmp/root", "   ", false, &[]).unwrap_err();
        assert_eq!(err.code, "bad_params");
    }
}

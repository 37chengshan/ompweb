//! Rust-backed OMP settings service (doc 16 route 11, first production slice).
//!
//! The OMP CLI remains the schema and persistence authority.  The host owns
//! the process boundary and exposes bounded argv-only list/path/set/reset
//! operations to Node/Tauri/Headless clients.  No YAML is parsed here, so the
//! service stays compatible with every OMP schema version and never echoes a
//! credential value itself.

use crate::ipc_server::IpcError;
use crate::process_visibility::hide_console_window;
use std::process::Command;

const MAX_SETTING_KEY: usize = 256;
const MAX_SETTING_VALUE: usize = 1024 * 1024;
const MAX_OUTPUT: usize = 8 * 1024 * 1024;

fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= MAX_SETTING_KEY
        && key
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'))
}

fn omp_bin() -> String {
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
    candidates
        .into_iter()
        .find(|candidate| std::path::Path::new(candidate).exists())
        .unwrap_or_else(|| "omp".to_string())
}

fn run(args: &[&str], json_output: bool) -> Result<String, IpcError> {
    let mut command = Command::new(omp_bin());
    command.args(args).env("LC_ALL", "C");
    hide_console_window(&mut command);
    let output = command
        .output()
        .map_err(|err| IpcError::new("settings_exec_failed", err.to_string()))?;
    if output.stdout.len() > MAX_OUTPUT || output.stderr.len() > MAX_OUTPUT {
        return Err(IpcError::new(
            "settings_output_too_large",
            "omp settings output exceeds 8MiB",
        ));
    }
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(IpcError::new(
            "settings_command_failed",
            if detail.is_empty() {
                format!("omp exited with {}", output.status)
            } else {
                detail
            },
        ));
    }
    let stdout = String::from_utf8(output.stdout)
        .map_err(|_| IpcError::new("settings_invalid_utf8", "omp returned non-UTF-8 output"))?;
    if json_output {
        // Parse before returning so malformed upstream output becomes a
        // structured failure rather than poisoning the IPC response stream.
        let trimmed = stdout.trim();
        crate::mini_json::JsonValue::parse(trimmed)
            .map_err(|err| IpcError::new("settings_invalid_json", err))?;
        // IPC is newline-delimited JSON. OMP's pretty-printed config output
        // may contain literal newlines inside the JSON document, which would
        // split one response into several protocol frames and make clients
        // wait until timeout. Whitespace outside JSON strings is insignificant
        // here, so compact the validated document before returning it.
        return Ok(compact_json(trimmed));
    }
    Ok(stdout)
}

fn compact_json(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut in_string = false;
    let mut escaped = false;
    for ch in input.chars() {
        if in_string {
            output.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
        } else if ch == '"' {
            in_string = true;
            output.push(ch);
        } else if !ch.is_whitespace() {
            output.push(ch);
        }
    }
    output
}

pub fn list() -> Result<String, IpcError> {
    run(&["config", "list", "--json"], true)
}

pub fn path() -> Result<String, IpcError> {
    let value = run(&["config", "path"], false)?.trim().to_string();
    Ok(crate::ipc_server::json_str(&value))
}

pub fn set(key: &str, value: &str) -> Result<String, IpcError> {
    if !valid_key(key) {
        return Err(IpcError::new("invalid_key", "invalid setting key"));
    }
    if value.len() > MAX_SETTING_VALUE {
        return Err(IpcError::new(
            "setting_value_too_large",
            "setting value exceeds 1MiB",
        ));
    }
    let output = run(&["config", "set", key, value], false)?;
    Ok(format!(
        "{{\"output\":{}}}",
        crate::ipc_server::json_str(output.trim())
    ))
}

pub fn reset(key: &str) -> Result<String, IpcError> {
    if !valid_key(key) {
        return Err(IpcError::new("invalid_key", "invalid setting key"));
    }
    let output = run(&["config", "reset", key], false)?;
    Ok(format!(
        "{{\"output\":{}}}",
        crate::ipc_server::json_str(output.trim())
    ))
}

#[cfg(test)]
mod tests {
    use super::{compact_json, valid_key, MAX_SETTING_KEY, MAX_SETTING_VALUE};

    #[test]
    fn keys_are_bounded_and_argv_safe() {
        assert!(valid_key("terminal.hyperlinks"));
        assert!(valid_key("a-b_c.1"));
        assert!(!valid_key(""));
        assert!(!valid_key("../config"));
        assert!(!valid_key("a b"));
        assert!(!valid_key(&"a".repeat(MAX_SETTING_KEY + 1)));
    }

    #[test]
    fn setting_value_cap_is_one_megabyte() {
        assert_eq!(MAX_SETTING_VALUE, 1024 * 1024);
    }

    #[test]
    fn compact_json_preserves_string_whitespace() {
        let input = "{\n  \"label\": \"keep\\n spaces\",\n  \"enabled\": true\n}";
        assert_eq!(
            compact_json(input),
            "{\"label\":\"keep\\n spaces\",\"enabled\":true}"
        );
    }
}

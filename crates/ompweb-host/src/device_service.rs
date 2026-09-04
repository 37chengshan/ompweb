//! device_service: Rust authority for device identity & enrollment
//! (doc 16 route 13). Mirrors lib/remote-pairing.ts semantics:
//!   - one active enrollment token (issue replaces; consume-once;
//!     expired == unknown — no oracle);
//!   - device id = 128-bit random hex; name from UA (truncated);
//!   - touch refreshes last_seen; revoke single / revoke_all drops token;
//!   - youngest-wins max-devices cap.
//!
//! Tokens and devices live in the OMPWEB_RUNTIME_DB SQLite registry
//! (`crates/ompweb-storage/src/device_registry.rs`); the Node pair routes
//! become HTTP adapters over these IPC arms.

use crate::ipc_server::{json_str, IpcError};
use ompweb_storage::DeviceRegistry;
use std::sync::Mutex;

pub struct DeviceService {
    registry: Mutex<Option<DeviceRegistry>>,
}

impl DeviceService {
    #[cfg(test)]
    pub fn new() -> Self {
        DeviceService {
            registry: Mutex::new(None),
        }
    }

    pub fn with_registry(registry: DeviceRegistry) -> Self {
        DeviceService {
            registry: Mutex::new(Some(registry)),
        }
    }

    fn use_registry<T>(&self, f: impl FnOnce(&DeviceRegistry) -> T) -> Result<T, IpcError> {
        let guard = self.registry.lock().unwrap();
        match guard.as_ref() {
            Some(registry) => Ok(f(registry)),
            None => Err(IpcError::new(
                "registry_unavailable",
                "device registry not initialized",
            )),
        }
    }

    pub fn issue_token(&self, ttl_ms: i64) -> Result<String, IpcError> {
        let now = now_ms();
        let value = format!("{}{}", random_hex(), serial());
        self.use_registry(|registry| registry.issue_token(&value, now + ttl_ms))
            .and_then(|res| res.map_err(|e| IpcError::new("token_issue_failed", e.to_string())))?;
        Ok(value)
    }

    /// Accept a token: consume-once, then register a new device. Returns the
    /// new device id. Name comes from the UA string (mirror of
    /// deviceNameFromUserAgent: Phone / Windows PC / Mac / Linux PC /
    /// Paired device; truncated to 180 chars).
    pub fn enroll(
        &self,
        token: &str,
        user_agent: &str,
        mobile: bool,
        max_devices: usize,
    ) -> Result<String, IpcError> {
        let now = now_ms();
        let consumed = self
            .use_registry(|registry| registry.consume_token(token, now))
            .and_then(|res| {
                res.map_err(|e| IpcError::new("token_consume_failed", e.to_string()))
            })?;
        if !consumed {
            return Err(IpcError::new(
                "invalid_or_expired_token",
                "invalid or expired token",
            ));
        }
        let id = random_hex();
        let name = device_name_from_user_agent(user_agent, mobile);
        let platform = if mobile { "mobile" } else { "desktop" };
        // Per-device random auth secret (128-bit hex) — the remote runtime
        // uses it for challenge-response proof instead of exposing the bare
        // device id as a bearer credential.
        let auth_secret = random_hex();
        self.use_registry(|registry| {
            registry.register_device(&id, &name, platform, &auth_secret, now)
        })
        .and_then(|res| res.map_err(|e| IpcError::new("device_register_failed", e.to_string())))?;
        self.use_registry(|registry| registry.enforce_max_devices(max_devices, now))
            .and_then(|res| res.map_err(|e| IpcError::new("device_cap_failed", e.to_string())))?;
        Ok(id)
    }

    /// Resolve a device's auth secret for the WS challenge (None when the
    /// device is unknown/revoked).
    pub fn auth_secret_for(&self, id: &str) -> Result<Option<String>, IpcError> {
        self.use_registry(|registry| registry.get_device(id))
            .and_then(|res| res.map_err(|e| IpcError::new("device_get_failed", e.to_string())))
            .map(|record| {
                record
                    .filter(|d| d.revoked_at.is_none())
                    .map(|d| d.auth_secret.clone())
            })
    }

    pub fn touch(&self, id: &str) -> Result<bool, IpcError> {
        self.use_registry(|registry| registry.touch(id, now_ms()))
            .and_then(|res| res.map_err(|e| IpcError::new("device_touch_failed", e.to_string())))
    }

    pub fn revoke(&self, id: &str) -> Result<bool, IpcError> {
        self.use_registry(|registry| registry.revoke(id, now_ms()))
            .and_then(|res| res.map_err(|e| IpcError::new("device_revoke_failed", e.to_string())))
    }

    pub fn revoke_all(&self) -> Result<(), IpcError> {
        self.use_registry(|registry| registry.revoke_all(now_ms()))
            .and_then(|res| res.map_err(|e| IpcError::new("device_revoke_failed", e.to_string())))
    }

    pub fn list(&self, offline_after_ms: i64) -> Result<String, IpcError> {
        let now = now_ms();
        let devices = self
            .use_registry(|registry| registry.list_devices())
            .and_then(|res| res.map_err(|e| IpcError::new("device_list_failed", e.to_string())))?;
        let mut body = String::from("[");
        let mut first = true;
        for device in devices {
            if device.revoked_at.is_some() {
                continue;
            }
            if !first {
                body.push(',');
            }
            first = false;
            let online = now - device.last_seen <= offline_after_ms;
            body.push_str(&format!(
                "{{\"id\":{},\"name\":{},\"platform\":{},\"pairedAt\":{},\"lastActiveAt\":{},\"online\":{}}}",
                json_str(&device.id),
                json_str(&device.name),
                json_str(&device.platform),
                device.enrolled_at,
                device.last_seen,
                online
            ));
        }
        body.push(']');
        Ok(body)
    }

    /// Presence check used by the WS runtime: id must exist, not revoked,
    /// and seen within the offline window.
    #[cfg(test)]
    pub fn is_online(&self, id: &str, offline_after_ms: i64) -> Result<bool, IpcError> {
        let now = now_ms();
        self.use_registry(|registry| registry.get_device(id))
            .and_then(|res| res.map_err(|e| IpcError::new("device_get_failed", e.to_string())))
            .map(|device| match device {
                Some(device) => {
                    device.revoked_at.is_none() && now - device.last_seen <= offline_after_ms
                }
                None => false,
            })
    }
}

/// IPC dispatch for every `device.*` method.
pub fn dispatch(
    method: &str,
    params: &crate::mini_json::JsonValue,
    service: &DeviceService,
) -> Result<Option<String>, IpcError> {
    fn str_param(params: &crate::mini_json::JsonValue, key: &str) -> String {
        params
            .get(&[key])
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    }
    match method {
        "device.authSecret" => {
            let id = str_param(params, "id");
            service.auth_secret_for(&id).map(|secret| match secret {
                Some(secret) => Some(format!(
                    "{{\"secret\":{}}}",
                    crate::ipc_server::json_str(&secret)
                )),
                None => Some("{\"secret\":null}".to_string()),
            })
        }
        "device.issue" => {
            let ttl = params
                .get(&["ttlMs"])
                .and_then(|v| v.as_num())
                .map(|n| n as i64)
                .unwrap_or(600_000);
            service.issue_token(ttl).map(|token| {
                Some(format!(
                    "{{\"token\":{},\"expiresAt\":{}}}",
                    json_str(&token),
                    now_ms() + ttl
                ))
            })
        }
        "device.enroll" => {
            let token = str_param(params, "token");
            let user_agent = str_param(params, "userAgent");
            let mobile = params
                .get(&["mobile"])
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let max_devices = params
                .get(&["maxDevices"])
                .and_then(|v| v.as_num())
                .map(|n| n as usize)
                .unwrap_or(4);
            service
                .enroll(&token, &user_agent, mobile, max_devices)
                .map(|id| Some(format!("{{\"id\":{}}}", json_str(&id))))
        }
        "device.touch" => {
            let id = str_param(params, "id");
            service
                .touch(&id)
                .map(|ok| Some(format!("{{\"ok\":{}}}", ok)))
        }
        "device.revoke" => {
            let id = str_param(params, "id");
            service
                .revoke(&id)
                .map(|ok| Some(format!("{{\"ok\":{}}}", ok)))
        }
        "device.revokeAll" => service
            .revoke_all()
            .map(|()| Some("{\"ok\":true}".to_string())),
        "device.list" => {
            let offline_after = params
                .get(&["offlineAfterMs"])
                .and_then(|v| v.as_num())
                .map(|n| n as i64)
                .unwrap_or(25_000);
            service.list(offline_after).map(Some)
        }
        _ => Err(IpcError::new(
            "unknown_method",
            format!("no method {method}"),
        )),
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn random_hex() -> String {
    // 128-bit token/device id from /dev/urandom when available (same
    // hardening as the IPC boot token).
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
    format!("{:016x}{:016x}", now_ms() as u64, std::process::id())
}

fn serial() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    SERIAL.fetch_add(1, Ordering::Relaxed)
}

/// UA → device name (mirror of deviceNameFromUserAgent).
fn device_name_from_user_agent(user_agent: &str, mobile: bool) -> String {
    let name = if mobile {
        "Phone".to_string()
    } else if user_agent.contains("Windows") {
        "Windows PC".to_string()
    } else if user_agent.contains("Macintosh") || user_agent.contains("Mac OS") {
        "Mac".to_string()
    } else if user_agent.contains("Linux") {
        "Linux PC".to_string()
    } else {
        "Paired device".to_string()
    };
    let mut out = name;
    if user_agent.len() > 180 {
        out.truncate(180);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service() -> DeviceService {
        DeviceService::with_registry(DeviceRegistry::open_in_memory().unwrap())
    }

    #[test]
    fn issue_enroll_touch_revoke_lifecycle() {
        let service = service();
        let token = service.issue_token(600_000).unwrap();
        assert!(token.len() >= 32);
        // Enroll consumes once; second enroll with same token fails.
        let id = service
            .enroll(&token, "Mozilla/5.0 (iPhone)", true, 4)
            .unwrap();
        assert_eq!(id.len(), 32);
        assert!(service.enroll(&token, "x", false, 4).is_err());
        assert!(service.touch(&id).unwrap());
        assert!(!service.touch("nope").unwrap());
        assert!(service.is_online(&id, 25_000).unwrap());
        assert!(service.revoke(&id).unwrap());
        assert!(!service.is_online(&id, 25_000).unwrap());
        assert!(!service.revoke(&id).unwrap());
    }

    #[test]
    fn list_marks_offline_and_revoke_all_clears() {
        let service = service();
        let token = service.issue_token(60_000).unwrap();
        let id = service
            .enroll(&token, "Mozilla/5.0 (Windows NT 10.0)", false, 4)
            .unwrap();
        let listed = service.list(25_000).unwrap();
        assert!(listed.contains(&format!("\"id\":\"{id}\"")));
        assert!(listed.contains("Windows PC"));
        assert!(listed.contains("\"online\":true"));
        service.revoke_all().unwrap();
        let listed = service.list(25_000).unwrap();
        assert!(!listed.contains(&id));
    }

    #[test]
    fn max_devices_evicts_oldest() {
        let service = service();
        for i in 0..3 {
            let token = service.issue_token(60_000).unwrap();
            let id = service
                .enroll(&token, &format!("UA {i}"), false, 2)
                .unwrap();
            let _ = id;
        }
        let listed = service.list(25_000).unwrap();
        // Only the two newest survive (cap 2, youngest wins).
        let count = listed.matches("\"id\":\"").count();
        assert_eq!(count, 2);
    }
}

//! device_registry: SQLite-backed device identity / enrollment registry
//! (doc 16 route 13, Rust authority). Follows sqlite_journal.rs idioms:
//! WAL, INSERT OR IGNORE meta seeding, bounded transactions behind a Mutex.
//!
//! Schema (over the same OMPWEB_RUNTIME_DB file the journal uses; SQLite WAL
//! allows multiple connections in one process):
//!   devices(id TEXT PK, enrolled_at, last_seen, name, platform, revoked_at)
//!   enrollment_tokens(value TEXT PK, expires_at, consumed_at)
//!
//! NOTE on token storage: the token is stored as issued. Hashing it (sha256)
//! requires a digest dependency; the current Node authority also stores the
//! raw value, and tokens are 128-bit random, single-use, 10-minute TTL and
//! loopback-issued — the `05-security-and-device-identity.md` hash
//! recommendation is queued behind the same dependency gate as ADR-005.

use rusqlite::{params, Connection};
use std::sync::Mutex;

pub struct DeviceRecord {
    pub id: String,
    pub enrolled_at: i64,
    pub last_seen: i64,
    pub name: String,
    pub platform: String,
    pub revoked_at: Option<i64>,
    /// Per-device random auth secret (128-bit hex) used for the
    /// challenge-response remote proof. Persisted so a host restart keeps
    /// the device's secret stable.
    pub auth_secret: String,
}

pub struct EnrollmentRecord {
    pub value: String,
    pub expires_at: i64,
    pub consumed_at: Option<i64>,
}

pub struct DeviceRegistry {
    conn: Mutex<Connection>,
}

impl DeviceRegistry {
    pub fn open_in_memory() -> rusqlite::Result<Self> {
        let conn = Connection::open_in_memory()?;
        init(&conn)?;
        Ok(DeviceRegistry {
            conn: Mutex::new(conn),
        })
    }

    pub fn open(path: &std::path::Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL;")?;
        init(&conn)?;
        Ok(DeviceRegistry {
            conn: Mutex::new(conn),
        })
    }

    // ── enrollment tokens ────────────────────────────────────────────────

    /// Store a fresh enrollment token; any previous unconsumed token is
    /// replaced (one active token — a refreshed QR invalidates the old link,
    /// mirroring PairingService.issue).
    pub fn issue_token(&self, value: &str, expires_at: i64) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM enrollment_tokens WHERE consumed_at IS NULL",
            [],
        )?;
        conn.execute(
            "INSERT INTO enrollment_tokens (value, expires_at) VALUES (?1, ?2)",
            params![value, expires_at],
        )?;
        Ok(())
    }

    /// Consume-once matching: delete on exact match; expired == unknown.
    /// Returns true when the token was valid and consumed.
    pub fn consume_token(&self, value: &str, now_ms: i64) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let deleted = conn.execute(
            "DELETE FROM enrollment_tokens WHERE value = ?1 AND consumed_at IS NULL AND expires_at > ?2",
            params![value, now_ms],
        )?;
        Ok(deleted > 0)
    }

    pub fn token_exists(&self, value: &str, now_ms: i64) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM enrollment_tokens WHERE value = ?1 AND consumed_at IS NULL AND expires_at > ?2",
            params![value, now_ms],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    // ── devices ──────────────────────────────────────────────────────────

    pub fn register_device(
        &self,
        id: &str,
        name: &str,
        platform: &str,
        auth_secret: &str,
        now_ms: i64,
    ) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO devices (id, enrolled_at, last_seen, name, platform, revoked_at, auth_secret) VALUES (?1, ?2, ?2, ?3, ?4, NULL, ?5)",
            params![id, now_ms, name, platform, auth_secret],
        )?;
        Ok(())
    }

    pub fn touch(&self, id: &str, now_ms: i64) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let updated = conn.execute(
            "UPDATE devices SET last_seen = ?2 WHERE id = ?1 AND revoked_at IS NULL",
            params![id, now_ms],
        )?;
        Ok(updated > 0)
    }

    pub fn revoke(&self, id: &str, now_ms: i64) -> rusqlite::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let updated = conn.execute(
            "UPDATE devices SET revoked_at = ?2 WHERE id = ?1 AND revoked_at IS NULL",
            params![id, now_ms],
        )?;
        Ok(updated > 0)
    }

    /// Revoke all devices and drop the unconsumed token (stop()).
    pub fn revoke_all(&self, now_ms: i64) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE devices SET revoked_at = ?1 WHERE revoked_at IS NULL",
            params![now_ms],
        )?;
        conn.execute("DELETE FROM enrollment_tokens", [])?;
        Ok(())
    }

    pub fn get_device(&self, id: &str) -> rusqlite::Result<Option<DeviceRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, enrolled_at, last_seen, name, platform, revoked_at, auth_secret FROM devices WHERE id = ?1",
        )?;
        let mut rows = stmt.query(params![id])?;
        match rows.next()? {
            Some(row) => Ok(Some(DeviceRecord {
                id: row.get(0)?,
                enrolled_at: row.get(1)?,
                last_seen: row.get(2)?,
                name: row.get(3)?,
                platform: row.get(4)?,
                revoked_at: row.get(5)?,
                auth_secret: row.get(6)?,
            })),
            None => Ok(None),
        }
    }

    pub fn list_devices(&self) -> rusqlite::Result<Vec<DeviceRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, enrolled_at, last_seen, name, platform, revoked_at, auth_secret FROM devices ORDER BY enrolled_at")?;
        let rows = stmt.query_map([], |row| {
            Ok(DeviceRecord {
                id: row.get(0)?,
                enrolled_at: row.get(1)?,
                last_seen: row.get(2)?,
                name: row.get(3)?,
                platform: row.get(4)?,
                revoked_at: row.get(5)?,
                auth_secret: row.get(6)?,
            })
        })?;
        rows.collect()
    }

    /// Youngest-wins cap: evict the oldest non-revoked device past the cap
    /// (mirror of PairingService.sweepDevices maxDevices semantics).
    pub fn enforce_max_devices(&self, max_devices: usize, now_ms: i64) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        let alive: i64 = conn.query_row(
            "SELECT COUNT(*) FROM devices WHERE revoked_at IS NULL",
            [],
            |row| row.get(0),
        )?;
        if (alive as usize) <= max_devices {
            return Ok(());
        }
        let excess = (alive as usize) - max_devices;
        conn.execute(
            "UPDATE devices SET revoked_at = ?2 WHERE id IN (SELECT id FROM devices WHERE revoked_at IS NULL ORDER BY enrolled_at LIMIT ?1)",
            params![excess as i64, now_ms],
        )?;
        Ok(())
    }
}

fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS devices (
            id TEXT PRIMARY KEY,
            enrolled_at INTEGER NOT NULL,
            last_seen INTEGER NOT NULL,
            name TEXT NOT NULL,
            platform TEXT NOT NULL,
            revoked_at INTEGER,
            auth_secret TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS enrollment_tokens (
            value TEXT PRIMARY KEY,
            expires_at INTEGER NOT NULL,
            consumed_at INTEGER
        );",
    )?;
    // Migration: the auth_secret column may not exist on a database created
    // before this column was introduced (runtime.db persists across binary
    // updates; CREATE IF NOT EXISTS does not alter existing tables).
    let names = {
        let mut stmt = conn.prepare("PRAGMA table_info(devices)")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        let mut names = Vec::new();
        for row in rows {
            names.push(row?);
        }
        names
    };
    if !names.iter().any(|name| name == "auth_secret") {
        conn.execute_batch("ALTER TABLE devices ADD COLUMN auth_secret TEXT NOT NULL DEFAULT '';")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_issue_replace_consume_once_and_expire() {
        let registry = DeviceRegistry::open_in_memory().unwrap();
        let now = 1_000_000i64;
        registry.issue_token("a-token", now + 1000).unwrap();
        registry.issue_token("b-token", now + 1000).unwrap();
        // One active token: the first is gone after re-issue.
        assert!(!registry.consume_token("a-token", now).unwrap());
        assert!(registry.consume_token("b-token", now).unwrap());
        // Single-use.
        assert!(!registry.consume_token("b-token", now).unwrap());
        // Expired == unknown (no oracle).
        registry.issue_token("c-token", now + 1000).unwrap();
        assert!(!registry.consume_token("c-token", now + 2000).unwrap());
    }

    #[test]
    fn device_register_touch_revoke_list_and_cap() {
        let registry = DeviceRegistry::open_in_memory().unwrap();
        let now = 1_000_000i64;
        registry
            .register_device("dev-1", "Phone", "ios", "secret-1", now)
            .unwrap();
        registry
            .register_device("dev-2", "PC", "darwin", "secret-2", now + 1)
            .unwrap();
        registry
            .register_device("dev-3", "PC", "win32", "secret-3", now + 2)
            .unwrap();
        assert!(registry.touch("dev-1", now + 100).unwrap());
        assert!(!registry.touch("nope", now).unwrap());
        registry.enforce_max_devices(2, now + 10_000).unwrap();
        let devices = registry.list_devices().unwrap();
        let alive: Vec<&DeviceRecord> = devices.iter().filter(|d| d.revoked_at.is_none()).collect();
        assert_eq!(alive.len(), 2);
        // The oldest (dev-1) was evicted.
        assert!(alive.iter().all(|d| d.id != "dev-1"));
        assert!(registry.revoke("dev-2", now + 20_000).unwrap());
        assert!(!registry.revoke("dev-2", now + 20_001).unwrap());
    }

    #[test]
    fn revoke_all_clears_devices_and_token() {
        let registry = DeviceRegistry::open_in_memory().unwrap();
        let now = 1_000_000i64;
        registry.issue_token("t", now + 1000).unwrap();
        registry
            .register_device("d", "Phone", "ios", "secret-d", now)
            .unwrap();
        registry.revoke_all(now + 50).unwrap();
        assert!(!registry.token_exists("t", now + 50).unwrap());
        assert!(registry
            .get_device("d")
            .unwrap()
            .unwrap()
            .revoked_at
            .is_some());
    }
}

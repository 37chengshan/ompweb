//! Persistent Event Continuity storage (doc 02 "数据库最小结构" / doc 06
//! slice 2). SQLite-backed journal implementing the same semantics as the
//! TypeScript and in-memory oracles; the shared conformance script drives it
//! in tests. Single-writer, short transactions, WAL with explicit checkpoint
//! on close. SQLite version comes from the bundled feature (≥3.51.3 gate,
//! ADR-003).

pub mod device_registry;
pub mod sqlite_journal;

pub use device_registry::{DeviceRecord, DeviceRegistry};
pub use sqlite_journal::{ClientCursor, EventClass, ResumePlan, SqliteJournal};

/// Windows' default SQLite VFS limits paths independently of Rust/Win32.
/// Keep normal locking and WAL semantics while enabling extended paths for
/// both connections sharing runtime.db (journal and device registry).
fn open_database(path: &std::path::Path) -> rusqlite::Result<rusqlite::Connection> {
    #[cfg(windows)]
    { rusqlite::Connection::open_with_flags_and_vfs(path, rusqlite::OpenFlags::default(), "win32-longpath") }
    #[cfg(not(windows))]
    { rusqlite::Connection::open(path) }
}

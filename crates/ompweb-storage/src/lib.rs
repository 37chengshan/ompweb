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

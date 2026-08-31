// Event Continuity semantic model (5.0 doc 02 / ADR-003) — TypeScript oracle.
//
// This module defines the wire-level event envelope and the resume state
// machine. The oracle exists to pin the semantics with conformance fixtures
// BEFORE a persistent implementation (Rust host, doc 06) exists; it must never
// be wired to production traffic. Purity rules: no I/O, no clocks other than
// the injected one, no randomness.

/** v1 cursor: per-stream monotonic seq inside a host identity generation. */
export interface EventCursor {
  hostEpoch: string;
  streamId: string;
  seq: number;
}

export type EventClass = "reliable" | "coalesced" | "ephemeral";

export interface ReliableEvent<T = unknown> {
  cursor: EventCursor;
  eventId: string;
  type: string;
  payloadVersion: number;
  occurredAt: number;
  recordedAt: number;
  class: EventClass;
  origin?: { ompEntryId?: string; rpcRunId?: string };
  payload: T;
}

export interface ClientCursor {
  streamId: string;
  seq: number;
}

export type ResumePlan<T = unknown> =
  | { kind: "FULL_SNAPSHOT"; reason: "epoch_mismatch" }
  | { kind: "PROTOCOL_ERROR"; reason: "cursor_ahead_of_head"; streamId: string; headSeq: number }
  | { kind: "SNAPSHOT_THEN_REPLAY"; streamId: string; snapshot: StreamSnapshot<T> | null; events: ReliableEvent[] }
  | { kind: "REPLAY"; streamId: string; events: ReliableEvent[] }
  | { kind: "NO_CHANGE"; streamId: string };

export interface StreamSnapshot<T = unknown> {
  seq: number;
  stateVersion: number;
  payload: T;
  createdAt: number;
}

export const EVENT_CLASSES: readonly EventClass[] = ["reliable", "coalesced", "ephemeral"];

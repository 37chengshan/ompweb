// Mutation receipt ledger (doc 02 "Mutation 幂等边界"). Implements the
// achievable semantics — persist-before-execute, duplicate detection, conflict
// on same key + different payload, UNKNOWN on crash ambiguity, and retention
// expiry that refuses to treat aged keys as fresh — never fake exactly-once.

export type MutationStatus = "accepted" | "committed" | "failed" | "unknown";

export interface MutationRecord {
  deviceId: string;
  clientMsgId: string;
  requestHash: string;
  status: MutationStatus;
  result?: unknown;
  recordedAt: number;
  updatedAt: number;
}

export type MutationAcceptOutcome =
  | { kind: "accepted" }
  | { kind: "duplicate"; record: MutationRecord }
  | { kind: "conflict"; record: MutationRecord }
  | { kind: "retention_expired" };

export interface MutationLedgerOptions {
  /** Must exceed the client's max retry window (doc 02 rule 6). */
  retentionMs?: number;
  clock?: () => number;
}

export class MutationLedger {
  private readonly entries = new Map<string, MutationRecord>();
  /** Tombstones for expired keys: retrying them must be refused, never
   *  silently treated as a brand-new command (doc 02 rule 6). */
  private readonly expired = new Map<string, number>();
  private readonly retentionMs: number;
  private readonly clock: () => number;

  constructor(options: MutationLedgerOptions = {}) {
    this.retentionMs = options.retentionMs ?? 24 * 60 * 60 * 1000;
    this.clock = options.clock ?? (() => 0);
  }

  static key(deviceId: string, clientMsgId: string): string {
    // NUL separator: neither id can contain one (validated upstream), and it
    // cannot collide across the two fields the way a space could.
    return `${deviceId}\u0000${clientMsgId}`;
  }

  accept(deviceId: string, clientMsgId: string, requestHash: string): MutationAcceptOutcome {
    const key = MutationLedger.key(deviceId, clientMsgId);
    if (this.expired.has(key)) return { kind: "retention_expired" };
    const existing = this.entries.get(key);
    const now = this.clock();
    if (existing) {
      if (now - existing.recordedAt > this.retentionMs) {
        // Aged past retention: tombstone + refuse rather than re-execute.
        this.entries.delete(key);
        this.expired.set(key, existing.recordedAt);
        return { kind: "retention_expired" };
      }
      if (existing.requestHash !== requestHash) return { kind: "conflict", record: existing };
      return { kind: "duplicate", record: existing };
    }
    const record: MutationRecord = {
      deviceId,
      clientMsgId,
      requestHash,
      status: "accepted",
      recordedAt: now,
      updatedAt: now,
    };
    this.entries.set(key, record);
    return { kind: "accepted" };
  }

  /** Retried acceptance of an UNKNOWN record with the same payload. */
  reacceptUnknown(deviceId: string, clientMsgId: string, requestHash: string): MutationAcceptOutcome {
    const key = MutationLedger.key(deviceId, clientMsgId);
    const existing = this.entries.get(key);
    if (!existing) return { kind: "retention_expired" };
    if (existing.requestHash !== requestHash) return { kind: "conflict", record: existing };
    if (existing.status !== "unknown") return { kind: "duplicate", record: existing };
    existing.status = "accepted";
    existing.updatedAt = this.clock();
    return { kind: "accepted" };
  }

  settle(deviceId: string, clientMsgId: string, status: "committed" | "failed" | "unknown", result?: unknown): MutationRecord | null {
    const key = MutationLedger.key(deviceId, clientMsgId);
    const record = this.entries.get(key);
    if (!record) return null;
    record.status = status;
    if (result !== undefined) record.result = result;
    record.updatedAt = this.clock();
    return record;
  }

  get(deviceId: string, clientMsgId: string): MutationRecord | null {
    return this.entries.get(MutationLedger.key(deviceId, clientMsgId)) ?? null;
  }

  /** Client retry semantics for a timed-out request: never re-issue blindly. */
  queryForRetry(deviceId: string, clientMsgId: string, requestHash: string): MutationAcceptOutcome {
    return this.accept(deviceId, clientMsgId, requestHash);
  }

  expire(now = this.clock()): number {
    let removed = 0;
    for (const [key, record] of this.entries) {
      if (now - record.recordedAt > this.retentionMs) {
        this.entries.delete(key);
        this.expired.set(key, record.recordedAt);
        removed++;
      }
    }
    // Tombstones outlive records; afterwards the client must mint a fresh
    // clientMsgId anyway (its own retry window has long passed).
    for (const [key, since] of this.expired) {
      if (now - since > this.retentionMs * 2) this.expired.delete(key);
    }
    return removed;
  }

  size(): number {
    return this.entries.size;
  }
}

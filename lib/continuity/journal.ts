// In-memory journal/snapshot/resume oracle (doc 02 Slice 1). Conformance
// fixture target for the future persistent implementation (doc 06); forbidden
// from production traffic. Semantics pinned here:
//
// - reliable events are journaled, replayed in seq order;
// - coalesced events keep only the LATEST per (stream, type) — replay always
//   ends with the final state of a coalesced family;
// - ephemeral events live only in the bounded tail buffer and are lost on
//   resume (documented loss, never replayed);
// - snapshots compact: resume from a cursor <= snapshot seq replays the
//   snapshot then the retained tail (never from before the snapshot);
// - hostEpoch mismatch ⇒ FULL_SNAPSHOT; cursor ahead of head ⇒ PROTOCOL_ERROR;
// - during resume, live appends buffer in a bounded tail and drain strictly
//   after the replay — replay and live never interleave.

import type {
  ClientCursor,
  EventClass,
  EventCursor,
  ReliableEvent,
  ResumePlan,
  StreamSnapshot,
} from "./model";

export interface JournalEventInput<T = unknown> {
  type: string;
  payload: T;
  class: EventClass;
  payloadVersion?: number;
  occurredAt?: number;
  origin?: { ompEntryId?: string; rpcRunId?: string };
}

export interface MemoryJournalOptions {
  hostEpoch: string;
  /** Max live events buffered per stream while a resume is in flight. */
  tailBufferMax?: number;
  clock?: () => number;
  eventIdSeed?: number;
}

interface StreamState {
  nextSeq: number;
  events: ReliableEvent[];
  snapshots: StreamSnapshot<unknown>[];
  /** Seq through which coalesced families have collapsed. */
  compactedThrough: number;
  tail: ReliableEvent[];
  tailDropped: number;
}

export class MemoryJournal {
  readonly hostEpoch: string;
  private readonly streams = new Map<string, StreamState>();
  private tailBufferMax: number;
  private readonly clock: () => number;
  private eventIdCounter: number;
  /** Set while a resume plan is outstanding: live appends buffer in the tail. */
  private resuming = new Set<string>();
  /** Live-forwarding listeners (protocol endpoint). Not persisted. */
  private appendListeners = new Set<(event: ReliableEvent) => void>();

  constructor(options: MemoryJournalOptions) {
    this.hostEpoch = options.hostEpoch;
    this.tailBufferMax = options.tailBufferMax ?? 1024;
    this.clock = options.clock ?? (() => 0);
    this.eventIdCounter = options.eventIdSeed ?? 0;
  }

  private stream(streamId: string): StreamState {
    let s = this.streams.get(streamId);
    if (!s) {
      s = { nextSeq: 1, events: [], snapshots: [], compactedThrough: 0, tail: [], tailDropped: 0 };
      this.streams.set(streamId, s);
    }
    return s;
  }

  /** Adjust the bounded tail buffer size (conformance scenarios use this). */
  setTailMax(max: number): void {
    this.tailBufferMax = max;
  }

  headSeq(streamId: string): number {
    const s = this.stream(streamId);
    return s.nextSeq - 1;
  }

  /** Subscribe to appends (live forwarding). Returns an unsubscribe fn. */
  onAppend(listener: (event: ReliableEvent) => void): () => void {
    this.appendListeners.add(listener);
    return () => this.appendListeners.delete(listener);
  }

  append<T>(streamId: string, input: JournalEventInput<T>): ReliableEvent<T> {
    const s = this.stream(streamId);
    const seq = s.nextSeq++;
    const now = this.clock();
    const event: ReliableEvent<T> = {
      cursor: { hostEpoch: this.hostEpoch, streamId, seq },
      eventId: `evt-${this.eventIdCounter++}`,
      type: input.type,
      payloadVersion: input.payloadVersion ?? 1,
      occurredAt: input.occurredAt ?? now,
      recordedAt: now,
      class: input.class,
      ...(input.origin ? { origin: input.origin } : {}),
      payload: input.payload,
    };

    // Live listeners observe every append (including coalesced updates and
    // ephemeral frames); journal placement below decides what is retained.
    for (const listener of this.appendListeners) listener(event as ReliableEvent);

    const buffering = this.resuming.has(streamId);
    if (input.class === "ephemeral") {
      // Ephemeral: tail-only, dropped silently when the buffer is full.
      if (buffering || true) {
        if (s.tail.length >= this.tailBufferMax) {
          s.tail.shift();
          s.tailDropped++;
        }
        s.tail.push(event as ReliableEvent);
      }
      return event;
    }

    if (input.class === "coalesced") {
      // Keep only the latest per (stream, type) once that family has been
      // committed to the journal; the live tail always records every event.
      const existingIdx = s.events.findIndex((e) => e.type === input.type && e.class === "coalesced" && e.cursor.seq > s.compactedThrough);
      if (existingIdx >= 0 && !buffering) {
        s.events[existingIdx] = event as ReliableEvent;
        return event;
      }
    }

    if (buffering) {
      if (s.tail.length >= this.tailBufferMax) {
        s.tail.shift();
        s.tailDropped++;
      }
      s.tail.push(event as ReliableEvent);
    } else {
      s.events.push(event as ReliableEvent);
    }
    return event;
  }

  /** Compact the stream at its current head: a snapshot becomes the resume base. */
  snapshot<T>(streamId: string, payload: T, stateVersion = 1): StreamSnapshot<T> {
    const s = this.stream(streamId);
    const snap: StreamSnapshot<T> = {
      seq: s.nextSeq - 1,
      stateVersion,
      payload,
      createdAt: this.clock(),
    };
    s.snapshots.push(snap as StreamSnapshot<unknown>);
    s.compactedThrough = snap.seq;
    // Drop journaled events the snapshot fully covers.
    s.events = s.events.filter((e) => e.cursor.seq > snap.seq);
    return snap;
  }

  beginResume(streamId: string): void {
    this.resuming.add(streamId);
  }

  /** Drain the bounded live tail collected while the stream was resuming. */
  drainTail(streamId: string): ReliableEvent[] {
    const s = this.stream(streamId);
    const drained = s.tail.splice(0, s.tail.length);
    this.resuming.delete(streamId);
    // Commit drained (non-ephemeral) events into the journal in seq order.
    for (const e of drained) {
      if (e.class === "ephemeral") continue;
      s.events.push(e);
    }
    s.events.sort((a, b) => a.cursor.seq - b.cursor.seq);
    return drained;
  }

  resume(client: { hostEpoch: string; cursors: ClientCursor[] }): ResumePlan[] {
    if (client.hostEpoch !== this.hostEpoch) {
      return [{ kind: "FULL_SNAPSHOT", reason: "epoch_mismatch" }];
    }
    const plans: ResumePlan[] = [];
    for (const cursor of client.cursors) {
      const s = this.stream(cursor.streamId);
      const head = s.nextSeq - 1;
      if (cursor.seq > head) {
        plans.push({ kind: "PROTOCOL_ERROR", reason: "cursor_ahead_of_head", streamId: cursor.streamId, headSeq: head });
        continue;
      }
      const snapshot = [...s.snapshots].reverse().find((snap) => snap.seq >= cursor.seq) ?? null;
      if (snapshot) {
        plans.push({
          kind: "SNAPSHOT_THEN_REPLAY",
          streamId: cursor.streamId,
          snapshot: snapshot as StreamSnapshot<unknown>,
          events: s.events.filter((e) => e.cursor.seq > snapshot!.seq),
        });
        continue;
      }
      const events = s.events.filter((e) => e.cursor.seq > cursor.seq);
      plans.push(events.length === 0 ? { kind: "NO_CHANGE", streamId: cursor.streamId } : { kind: "REPLAY", streamId: cursor.streamId, events });
    }
    return plans;
  }

  /** Live-tail merge test helper: what a client sees for a stream right now. */
  streamView(streamId: string): ReliableEvent[] {
    const s = this.stream(streamId);
    return [...s.events].sort((a, b) => a.cursor.seq - b.cursor.seq);
  }

  tailStats(streamId: string): { buffered: number; dropped: number } {
    const s = this.stream(streamId);
    return { buffered: s.tail.length, dropped: s.tailDropped };
  }
}

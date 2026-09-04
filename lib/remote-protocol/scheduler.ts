// Bounded scheduler for a protocol connection (doc 03 流控/优先级).
//
// Browser WebSocket has no backpressure, so the guarantee lives HERE:
// every enqueued frame passes a budget check, and when the connection is at
// high-water the policy is, in order — drop P3, merge P2 by (stream,type),
// pause Data, and for P0/P1 refuse by closing the connection and demanding a
// cursor resume. Nothing in this module can grow without bound.

export type Priority = "P0" | "P1" | "P2" | "P3" | "data";

export const PRIORITY_ORDER: readonly Priority[] = ["P0", "P1", "P2", "P3", "data"];

export interface SchedulerLimits {
  /** Total bytes across all queued frames. */
  maxConnectionBytes: number;
  /** Per-stream byte cap. */
  maxStreamBytes: number;
  /** Data channel pauses at this fraction of its budget. */
  dataPauseRatio: number;
}

export const DEFAULT_SCHEDULER_LIMITS: SchedulerLimits = {
  maxConnectionBytes: 8 * 1024 * 1024,
  maxStreamBytes: 1024 * 1024,
  dataPauseRatio: 0.75,
};

export type EnqueueDecision =
  | { action: "queued" }
  | { action: "dropped"; reason: "p3_overflow" }
  | { action: "merged"; reason: "p2_overflow" }
  | { action: "pause"; reason: "data_overflow" }
  | { action: "resume_required"; reason: "p0p1_overflow" };

export interface QueuedFrame {
  priority: Priority;
  streamId: string;
  type: string;
  bytes: number;
  /** Final-state payloads (P2) can replace their predecessor on merge. */
  render(): string;
}

interface StreamBudget {
  bytes: number;
  frames: QueuedFrame[];
}

export class ConnectionScheduler {
  private readonly limits: SchedulerLimits;
  private readonly streams = new Map<string, StreamBudget>();
  private totalBytes = 0;
  private dataPaused = false;
  /** Ordered drain: P0 first, then P1, P2, P3; data drains last. */
  private readonly queue: QueuedFrame[] = [];

  constructor(limits: Partial<SchedulerLimits> = {}) {
    this.limits = { ...DEFAULT_SCHEDULER_LIMITS, ...limits };
  }

  enqueue(frame: QueuedFrame): EnqueueDecision {
    if (frame.priority === "P3" && this.totalBytes + frame.bytes > this.limits.maxConnectionBytes) {
      return { action: "dropped", reason: "p3_overflow" };
    }
    if (frame.priority === "P2") {
      const budget = this.budgetFor(frame.streamId);
      const superseded = budget.frames.findLast((f) => f.priority === "P2" && f.type === frame.type);
      if (superseded && this.totalBytes + frame.bytes - superseded.bytes <= this.limits.maxConnectionBytes) {
        // Merge: replace the stale final-state frame with the newer one.
        this.totalBytes -= superseded.bytes;
        budget.bytes -= superseded.bytes;
        const idx = this.queue.indexOf(superseded);
        if (idx >= 0) this.queue.splice(idx, 1);
        budget.frames.splice(budget.frames.indexOf(superseded), 1);
      }
    }
    const streamBudget = this.budgetFor(frame.streamId);
    if (frame.priority === "data" && this.totalBytes + frame.bytes > this.limits.maxConnectionBytes * this.limits.dataPauseRatio) {
      this.dataPaused = true;
      return { action: "pause", reason: "data_overflow" };
    }
    if ((frame.priority === "P0" || frame.priority === "P1") && (this.totalBytes + frame.bytes > this.limits.maxConnectionBytes || streamBudget.bytes + frame.bytes > this.limits.maxStreamBytes)) {
      // Never grow unbounded for must-deliver traffic: demand a cursor resume.
      return { action: "resume_required", reason: "p0p1_overflow" };
    }
    this.totalBytes += frame.bytes;
    streamBudget.bytes += frame.bytes;
    streamBudget.frames.push(frame);
    this.queue.push(frame);
    return { action: "queued" };
  }

  /** Data stays paused until the queue drains below the resume line. */
  isDataPaused(): boolean {
    if (this.dataPaused && this.totalBytes < this.limits.maxConnectionBytes * this.limits.dataPauseRatio * 0.5) {
      this.dataPaused = false;
    }
    return this.dataPaused;
  }

  /** Drain frames in priority order; `render` runs at flush time. */
  drain(): string[] {
    const out: string[] = [];
    while (this.queue.length > 0) {
      const frame = this.queue.shift()!;
      out.push(frame.render());
      const budget = this.budgetFor(frame.streamId);
      budget.bytes -= frame.bytes;
      budget.frames.splice(budget.frames.indexOf(frame), 1);
      this.totalBytes -= frame.bytes;
    }
    this.dataPaused = false;
    return out;
  }

  pendingBytes(): number {
    return this.totalBytes;
  }

  private budgetFor(streamId: string): StreamBudget {
    let b = this.streams.get(streamId);
    if (!b) {
      b = { bytes: 0, frames: [] };
      this.streams.set(streamId, b);
    }
    return b;
  }
}

/** Event class → scheduling priority (doc 03 stream table). */
export function priorityForEventClass(eventClass: string): Priority {
  switch (eventClass) {
    case "reliable":
      return "P1";
    case "coalesced":
      return "P2";
    case "ephemeral":
      return "P3";
    default:
      return "data";
  }
}

// In-process blind-relay simulator (5.0 doc 04 C1 slice 1).
//
// Validates relay-behavior contracts BEFORE any real relay exists: routing,
// quotas, rate shedding, and fault injection (drop / reorder / delay). Frames
// are OPAQUE — the relay never parses, decodes or inspects them, which is the
// structural guarantee behind "payload-confidential blind relay" (the real
// E2EE frame format stays behind ADR-005 and does not change this file).
//
// Routing model (doc 04): hosts register under a routable id; client
// connections attach to that id. A client frame goes to its host; a host
// frame fans out to every attached client. The relay is a rendezvous +
// forwarding table — nothing more.
//
// Determinism: all randomness and time flow through injected `rng()` and
// `now()`; delayed frames deliver on explicit `advance()`, so tests never
// rely on wall-clock timers.

export interface RelayLimits {
  maxFrameBytes: number;
  /** Frames a connection may push per 1000ms of sim-time; excess is shed. */
  maxFramesPerSecond: number;
  /** Total bytes a connection may push before forced close. */
  maxBytesPerConnection: number;
  /** Reorder: with this probability two adjacent buffered frames swap. */
  reorderProbability: number;
  /** Fraction of frames dropped after the reorder pass. */
  dropRate: number;
  /** Every frame is held for this many sim-ms before delivery. */
  delayMs: number;
}

export const DEFAULT_RELAY_LIMITS: RelayLimits = {
  maxFrameBytes: 256 * 1024,
  maxFramesPerSecond: 1000,
  maxBytesPerConnection: 64 * 1024 * 1024,
  reorderProbability: 0,
  dropRate: 0,
  delayMs: 0,
};

export interface RelayFaults {
  rng?: () => number;
  now?: () => number;
}

export interface RelayEndpoint {
  /** Push an opaque frame toward the other side. */
  send(frame: string): void;
  close(reason?: string): void;
  readonly closed: boolean;
  readonly closeReason?: string;
}

export interface RelayStats {
  hostsRegistered: number;
  clientsConnected: number;
  framesRelayed: number;
  bytesRelayed: number;
  framesDropped: number;
  connectionsClosed: number;
  connectionsRejected: number;
}

interface Side {
  sink: (frame: string) => void;
  framesThisWindow: number;
  windowStart: number;
  bytes: number;
  closed: boolean;
  closeReason?: string;
}

interface PendingDelivery {
  to: Side;
  frame: string;
  dueAt: number;
}

export interface RelaySimulator {
  registerHost(hostId: string, sink: (frame: string) => void): RelayEndpoint;
  connectClient(hostId: string, sink: (frame: string) => void): RelayEndpoint;
  /** Deliver every frame whose delay has elapsed by `untilMs` sim-time. */
  advance(untilMs: number): void;
  stats(): RelayStats;
}

export function createRelaySimulator(limits: Partial<RelayLimits> = {}, faults: RelayFaults = {}): RelaySimulator {
  const config: RelayLimits = { ...DEFAULT_RELAY_LIMITS, ...limits };
  const rng = faults.rng ?? (() => 0.5);
  const now = faults.now ?? (() => 0);

  const hosts = new Map<string, { side: Side; clients: Set<Side> }>();
  const pending: PendingDelivery[] = [];
  const stats = {
    hostsRegistered: 0,
    clientsConnected: 0,
    framesRelayed: 0,
    bytesRelayed: 0,
    framesDropped: 0,
    connectionsClosed: 0,
    connectionsRejected: 0,
  };

  function closeSide(side: Side, reason: string): void {
    if (side.closed) return;
    side.closed = true;
    side.closeReason = reason;
    stats.connectionsClosed++;
  }

  function admit(side: Side, frame: string, targets: () => Side[]): void {
    if (side.closed) return;
    // Opaque-frame size cap: the relay cannot know what a frame means, but it
    // can refuse to carry absurd bytes (doc 04 abuse gate).
    if (frame.length > config.maxFrameBytes) {
      closeSide(side, "frame_too_large");
      return;
    }
    // Rate shedding per connection (fixed 1000ms windows of sim-time).
    if (now() - side.windowStart >= 1000) {
      side.windowStart = now();
      side.framesThisWindow = 0;
    }
    side.framesThisWindow++;
    if (side.framesThisWindow > config.maxFramesPerSecond) {
      stats.framesDropped++;
      return;
    }
    side.bytes += frame.length;
    if (side.bytes > config.maxBytesPerConnection) {
      closeSide(side, "quota_exceeded");
      return;
    }
    enqueueDelivery(side, targets(), frame);
  }

  function enqueueDelivery(side: Side, targets: Side[], frame: string): void {
    if (config.delayMs > 0) {
      const dueAt = now() + config.delayMs;
      for (const target of targets) pending.push({ to: target, frame, dueAt });
      return;
    }
    deliverFrames(targets, [frame]);
  }

  function deliverFrames(targets: Side[], frames: string[]): void {
    // Fault order: reorder (within a small batch) → drop → deliver.
    let window = frames;
    if (config.reorderProbability > 0 && window.length > 1) {
      window = window.slice();
      for (let i = 0; i < window.length - 1; i++) {
        if (rng() < config.reorderProbability) {
          [window[i], window[i + 1]] = [window[i + 1], window[i]];
        }
      }
    }
    const survivors = config.dropRate > 0 ? window.filter(() => rng() >= config.dropRate) : window;
    stats.framesDropped += window.length - survivors.length;
    for (const target of targets) {
      for (const frame of survivors) {
        if (target.closed) break;
        stats.framesRelayed++;
        stats.bytesRelayed += frame.length;
        target.sink(frame);
      }
    }
  }

  function makeEndpoint(side: Side, targets: () => Side[]): RelayEndpoint {
    return {
      send: (frame) => admit(side, frame, targets),
      close: (reason) => closeSide(side, reason ?? "closed_by_peer"),
      get closed() {
        return side.closed;
      },
      get closeReason() {
        return side.closeReason;
      },
    };
  }

  return {
    registerHost(hostId, sink) {
      if (hosts.has(hostId)) {
        stats.connectionsRejected++;
        throw new Error(`host id already registered: ${hostId}`);
      }
      const side: Side = { sink, framesThisWindow: 0, windowStart: now(), bytes: 0, closed: false };
      const entry = { side, clients: new Set<Side>() };
      hosts.set(hostId, entry);
      stats.hostsRegistered++;
      return makeEndpoint(side, () => [...entry.clients]);
    },
    connectClient(hostId, sink) {
      const host = hosts.get(hostId);
      if (!host) {
        stats.connectionsRejected++;
        throw new Error(`unknown host: ${hostId}`);
      }
      if (host.side.closed) {
        stats.connectionsRejected++;
        throw new Error(`host ${hostId} is not accepting connections`);
      }
      const side: Side = { sink, framesThisWindow: 0, windowStart: now(), bytes: 0, closed: false };
      host.clients.add(side);
      stats.clientsConnected++;
      return makeEndpoint(side, () => [host.side]);
    },
    advance(untilMs) {
      const due = pending.filter((p) => p.dueAt <= untilMs);
      pending.splice(0, pending.length, ...pending.filter((p) => p.dueAt > untilMs));
      // Group per target so reorder operates on frames delivered together.
      const byTarget = new Map<Side, string[]>();
      for (const d of due) {
        const list = byTarget.get(d.to) ?? [];
        list.push(d.frame);
        byTarget.set(d.to, list);
      }
      for (const [target, frames] of byTarget) deliverFrames([target], frames);
    },
    stats() {
      return { ...stats };
    },
  };
}

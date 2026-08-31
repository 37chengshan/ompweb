// Loopback protocol endpoint (doc 03 P2–P4): handshake, resume via the doc-02
// journal, and mutation receipts via the doc-02 ledger. Transport is an
// injected message pipe — the in-memory pipe backs conformance tests; a real
// `ws` binding (loopback only) is a separate dependency decision and this file
// does not change when it lands.

import type { MemoryJournal } from "@/lib/continuity/journal";
import type { MutationLedger } from "@/lib/continuity/mutations";
import type { ReliableEvent } from "@/lib/continuity/model";
import {
  DEFAULT_PROTOCOL_LIMITS,
  PROTOCOL_FEATURES,
  PROTOCOL_VERSION,
  decodeMessage,
  encodeMessage,
  type HelloPayload,
  type ProtocolLimits,
  type ProtocolMessage,
  type ResumePayload,
  type WelcomePayload,
} from "./protocol";
import { ConnectionScheduler, DEFAULT_SCHEDULER_LIMITS, priorityForEventClass, type SchedulerLimits } from "./scheduler";

/** Message pipe abstraction: what a WebSocket provides, nothing more. */
export interface MessageTransport {
  send(text: string): void;
  onMessage(handler: (text: string) => void): void;
  close(code?: number, reason?: string): void;
  onClose(handler: () => void): void;
}

export type AuthResult = { ok: true; deviceId: string } | { ok: false; code: string; message: string };

export interface HostConnectionOptions {
  journal: MemoryJournal;
  ledger: MutationLedger;
  authenticator?: (proof: string, hello: HelloPayload) => Promise<AuthResult>;
  limits?: ProtocolLimits;
  schedulerLimits?: Partial<SchedulerLimits>;
  serverVersion?: string;
  /** Executes accepted mutations; receipt semantics stay in this file. */
  executeMutation?: (deviceId: string, mutation: { type: string; payload: unknown }) => Promise<{ status: "committed" | "failed" | "unknown"; result?: unknown }>;
}

type ConnectionState = "await_hello" | "await_auth" | "await_resume" | "live" | "closed";

export class HostConnection {
  readonly transport: MessageTransport;
  private readonly options: HostConnectionOptions;
  private readonly limits: ProtocolLimits;
  private state: ConnectionState = "await_hello";
  private deviceId = "";
  private hello: HelloPayload | null = null;
  private negotiatedFeatures = new Set<string>();
  private scheduler: ConnectionScheduler;
  private unsubscribeLive: (() => void) | null = null;
  private pendingMutations = new Map<string, string>(); // clientMsgId → requestHash

  constructor(transport: MessageTransport, options: HostConnectionOptions) {
    this.transport = transport;
    this.options = options;
    this.limits = options.limits ?? DEFAULT_PROTOCOL_LIMITS;
    this.scheduler = new ConnectionScheduler(options.schedulerLimits ?? DEFAULT_SCHEDULER_LIMITS);
    transport.onMessage((text) => void this.handleText(text));
    transport.onClose(() => this.teardown());
  }

  private teardown(): void {
    this.state = "closed";
    this.unsubscribeLive?.();
    this.unsubscribeLive = null;
  }

  private send<T>(message: Omit<ProtocolMessage<T>, "version">): void {
    const encoded = encodeMessage({ ...message, version: PROTOCOL_VERSION } as ProtocolMessage<T>, this.limits);
    if (encoded.ok) this.transport.send(encoded.text);
  }

  private fail(code: string, message: string, requestId?: string): void {
    this.send({ kind: "error", streamId: "host", type: "protocol_error", requestId, payload: { code, message } });
    this.transport.close(1008, code);
    this.teardown();
  }

  private async handleText(text: string): Promise<void> {
    const decoded = decodeMessage(text, this.limits);
    if (!decoded.ok) {
      this.fail(decoded.code, `Malformed protocol message: ${decoded.code}`);
      return;
    }
    const msg = decoded.message;
    switch (this.state) {
      case "await_hello":
        await this.onHello(msg);
        return;
      case "await_auth":
        await this.onAuth(msg);
        return;
      case "await_resume":
        this.onResume(msg);
        return;
      case "live":
        this.onLiveMessage(msg);
        return;
      case "closed":
      default:
        return;
    }
  }

  private async onHello(msg: ProtocolMessage): Promise<void> {
    if (msg.type !== "hello" || msg.kind !== "request") {
      this.fail("invalid_envelope", "Expected hello request");
      return;
    }
    const payload = msg.payload as HelloPayload;
    if (!payload || !Array.isArray(payload.protocolVersions) || !payload.protocolVersions.includes(PROTOCOL_VERSION)) {
      this.fail("version_unsupported", "Client does not offer protocol version 1");
      return;
    }
    this.hello = payload;
    const features = new Set<string>(payload.features ?? []);
    // Unknown REQUIRED features reject the connection; optional ones ignored.
    const known = new Set<string>(Object.values(PROTOCOL_FEATURES));
    for (const feature of features) {
      if (!known.has(feature)) {
        this.fail("version_unsupported", `Unknown required feature: ${feature}`);
        return;
      }
    }
    this.negotiatedFeatures = new Set([...features].filter((f) => known.has(f)));
    if (this.options.authenticator) {
      this.state = "await_auth";
      this.send({
        kind: "response",
        requestId: msg.requestId,
        streamId: "host",
        type: "auth_required",
        payload: { methods: ["token"], transcriptBinding: JSON.stringify(payload) },
      });
      return;
    }
    await this.completeHandshake(msg.requestId);
  }

  private async onAuth(msg: ProtocolMessage): Promise<void> {
    if (msg.type !== "auth" || msg.kind !== "request") {
      this.fail("invalid_envelope", "Expected auth request");
      return;
    }
    const payload = (msg.payload ?? {}) as { proof?: string };
    const result = await this.options.authenticator?.(String(payload.proof ?? ""), this.hello!);
    if (!result || !result.ok) {
      this.fail("auth_failed", result?.message ?? "Authentication failed", msg.requestId);
      return;
    }
    this.deviceId = result.deviceId;
    await this.completeHandshake(msg.requestId);
  }

  private async completeHandshake(requestId?: string): Promise<void> {
    const welcome: WelcomePayload = {
      protocolVersion: PROTOCOL_VERSION,
      serverVersion: this.options.serverVersion ?? "ompweb-host-dev",
      hostEpoch: this.options.journal.hostEpoch,
      features: [...this.negotiatedFeatures],
      limits: { maxMessageBytes: this.limits.maxMessageBytes },
    };
    this.send({ kind: "response", requestId, streamId: "host", type: "welcome", payload: welcome });
    this.state = "await_resume";
  }

  private onResume(msg: ProtocolMessage): void {
    if (msg.type === "resume" && msg.kind === "request") {
      const payload = (msg.payload ?? { cursors: [] }) as ResumePayload;
      const clientEpoch = payload.hostEpoch ?? this.options.journal.hostEpoch;
      const plans = this.options.journal.resume({
        hostEpoch: clientEpoch,
        cursors: payload.cursors ?? [],
      });
      let epochMismatch = false;
      for (const plan of plans) {
        if (plan.kind === "PROTOCOL_ERROR") {
          this.fail("invalid_cursor", `Cursor ahead of head for ${plan.streamId}`);
          return;
        }
        if (plan.kind === "FULL_SNAPSHOT") {
          // Host identity regenerated: the client must drop its cache and
          // re-request; we keep the connection open for that round trip.
          this.send({
            kind: "error",
            streamId: "host",
            type: "full_resync_required",
            requestId: msg.requestId,
            payload: { code: "full_resync_required", hostEpoch: this.options.journal.hostEpoch },
          });
          epochMismatch = true;
          continue;
        }
        const streamId = "streamId" in plan ? plan.streamId : "host";
        if (plan.kind === "SNAPSHOT_THEN_REPLAY") {
          this.send({
            kind: "event",
            streamId,
            type: "snapshot",
            cursor: { hostEpoch: this.options.journal.hostEpoch, seq: plan.snapshot?.seq ?? 0 },
            payload: plan.snapshot?.payload ?? null,
          });
          for (const event of plan.events) this.emitEvent(event, true);
        } else if (plan.kind === "REPLAY") {
          for (const event of plan.events) this.emitEvent(event, true);
        }
      }
      const heads = [...new Set([...this.clientHeads(payload), "host"])].map((streamId) => ({
        streamId,
        seq: this.options.journal.headSeq(streamId),
      }));
      if (epochMismatch) {
        // Clients resubmit resume with empty cursors after clearing cache.
        return;
      }
      this.send({ kind: "response", requestId: msg.requestId, streamId: "host", type: "sync_complete", payload: { heads } });
      this.goLive();
      return;
    }
    if (msg.type === "start" && msg.kind === "request") {
      // Fresh subscription without history.
      this.send({ kind: "response", requestId: msg.requestId, streamId: "host", type: "sync_complete", payload: { heads: [] } });
      this.goLive();
      return;
    }
    this.fail("invalid_envelope", "Expected resume or start");
  }

  private clientHeads(payload: ResumePayload): string[] {
    return (payload.cursors ?? []).map((c) => c.streamId);
  }

  private goLive(): void {
    this.state = "live";
    // Forward journal appends live through the scheduler.
    this.unsubscribeLive = this.options.journal.onAppend((event) => this.emitEvent(event, false));
  }

  private emitEvent(event: ReliableEvent, _replay: boolean): void {
    const priority = priorityForEventClass(event.class);
    // Each frame carries its own stream/type/cursor: drain() flushes frames
    // that may belong to different streams (merged P2, buffered P3).
    const encoded = encodeMessage({
      version: PROTOCOL_VERSION,
      kind: "event",
      streamId: event.cursor.streamId,
      type: event.type,
      cursor: { hostEpoch: event.cursor.hostEpoch, seq: event.cursor.seq },
      payload: event.payload,
    }, this.limits);
    if (!encoded.ok) return;
    const text = encoded.text;
    const decision = this.scheduler.enqueue({
      priority,
      streamId: event.cursor.streamId,
      type: event.type,
      bytes: Buffer.byteLength(text),
      render: () => text,
    });
    if (decision.action === "dropped") return;
    if (decision.action === "resume_required") {
      this.fail("resume_required", "Connection budgets exhausted for reliable traffic");
      return;
    }
    if (decision.action === "pause") {
      // Data channels are not wired in v1 JSON mode; the pause decision is
      // recorded by dropping (test-visible) rather than silently growing.
      return;
    }
    for (const frameText of this.scheduler.drain()) {
      this.transport.send(frameText);
    }
  }

  private onLiveMessage(msg: ProtocolMessage): void {
    if (msg.kind === "request" && msg.type === "ping") {
      this.send({ kind: "response", requestId: msg.requestId, streamId: "host", type: "pong", payload: null });
      return;
    }
    if (msg.kind === "request" && (msg.type === "mutation" || msg.type === "mutation_query")) {
      void this.onMutation(msg);
      return;
    }
    this.send({ kind: "error", streamId: "host", type: "unknown_request", requestId: msg.requestId, payload: { code: "invalid_request" } });
  }

  /**
   * Receipt semantics (doc 03 Mutation / doc 02 ledger): persist ACCEPTED
   * before any side effect; the result arrives asynchronously and may be
   * UNKNOWN — the client retries with the SAME clientMsgId.
   */
  private async onMutation(msg: ProtocolMessage): Promise<void> {
    if (!this.negotiatedFeatures.has(PROTOCOL_FEATURES.mutationsV1)) {
      this.send({ kind: "error", streamId: "host", type: "mutation_unavailable", requestId: msg.requestId, payload: { code: "invalid_request" } });
      return;
    }
    const payload = (msg.payload ?? {}) as { clientMsgId?: string; requestHash?: string; mutation?: { type: string; payload: unknown } };
    const clientMsgId = String(payload.clientMsgId ?? "");
    const requestHash = String(payload.requestHash ?? "");
    if (!clientMsgId || !requestHash) {
      this.send({ kind: "error", streamId: "host", type: "mutation_rejected", requestId: msg.requestId, payload: { code: "invalid_request" } });
      return;
    }
    const outcome = this.options.ledger.accept(this.deviceId, clientMsgId, requestHash);
    if (outcome.kind === "conflict") {
      this.send({ kind: "error", streamId: "host", type: "mutation_conflict", requestId: msg.requestId, payload: { code: "invalid_request" } });
      return;
    }
    if (outcome.kind === "retention_expired") {
      this.send({ kind: "error", streamId: "host", type: "mutation_expired", requestId: msg.requestId, payload: { code: "invalid_request" } });
      return;
    }
    if (outcome.kind === "duplicate") {
      // Dedup: re-issue the recorded outcome instead of re-running.
      const record = outcome.record;
      this.send({
        kind: "response",
        requestId: msg.requestId,
        streamId: "host",
        type: "mutation_receipt",
        payload: { clientMsgId, status: record.status, result: record.result },
      });
      return;
    }
    this.pendingMutations.set(clientMsgId, requestHash);
    this.send({ kind: "response", requestId: msg.requestId, streamId: "host", type: "mutation_receipt", payload: { clientMsgId, status: "accepted" } });

    const executor = this.options.executeMutation;
    if (!executor) {
      // No executor wired: the mutation stays ACCEPTED (never guessed done).
      this.options.ledger.settle(this.deviceId, clientMsgId, "unknown");
      return;
    }
    try {
      const result = await executor(this.deviceId, (payload.mutation ?? { type: "noop", payload: null }) as { type: string; payload: unknown });
      this.options.ledger.settle(this.deviceId, clientMsgId, result.status, result.result);
      this.send({
        kind: "event",
        streamId: "host",
        type: "mutation_result",
        payload: { clientMsgId, status: result.status, result: result.result },
      });
    } catch {
      this.options.ledger.settle(this.deviceId, clientMsgId, "unknown");
      this.send({ kind: "event", streamId: "host", type: "mutation_result", payload: { clientMsgId, status: "unknown" } });
    }
  }
}

/** Convenience: negotiate features the PoC client uses. */
export function clientFeatures(): string[] {
  return [PROTOCOL_FEATURES.resumeV1, PROTOCOL_FEATURES.mutationsV1];
}

export function makeHello(deviceId: string, features: string[] = clientFeatures()): ProtocolMessage<HelloPayload> {
  return {
    version: PROTOCOL_VERSION,
    kind: "request",
    requestId: `hello-${deviceId}`,
    streamId: "host",
    type: "hello",
    payload: { clientVersion: "ompweb-dev", protocolVersions: [PROTOCOL_VERSION], features, deviceId },
  };
}

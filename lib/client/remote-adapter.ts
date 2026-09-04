/**
 * RemoteProtocolAdapter (doc 16 route 14/20, first slice).
 *
 * A transport-level remote client speaking the repo's remote protocol v1 to
 * the Rust RemoteRuntime's WebSocket endpoint (/remote/v1): hello →
 * auth_required → auth(proof = paired device id) → welcome → start →
 * sync_complete → live, then mutations (agent.prompt / agent.cancel) with
 * receipt-before-execute and clientMsgId dedup.
 *
 * Scope discipline (fail-closed): only the agent mutation surface is
 * implemented here. sessions/git/files/terminal remote operations and the
 * event subscription surface are later route-14/20 slices — calling them
 * throws AdapterUnavailableError naming the pending route, the same rule the
 * host uses.
 */
import { createHmac } from "node:crypto";
import { createWsClientTransport } from "@/lib/remote-protocol/ws-transport";
import type { MessageTransport } from "@/lib/remote-protocol/host-connection";

function hmacSha256Hex(key: string, data: string): string {
  const mac = createHmac("sha256", Buffer.from(key, "utf8"));
  mac.update(data, "utf8");
  return mac.digest("hex");
}

export class AdapterUnavailableError extends Error {
  readonly code = "client_runtime_unavailable";
  constructor(message: string) {
    super(message);
    this.name = "AdapterUnavailableError";
  }
}

export interface RemoteClientOptions {
  url: string;
  deviceId: string;
  /** The paired device's auth secret (challenge-response proof material). */
  deviceSecret: string;
  /** Timeout for a single request/response pair (default 10s). */
  requestTimeoutMs?: number;
}

type PendingRequest = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
};

export class RemoteProtocolAdapter {
  private transport: MessageTransport;
  private pending = new Map<string, PendingRequest>();
  private mutationWaiters = new Map<string, (payload: unknown) => void>();
  private requestSerial = 0;
  private transportClosed = false;

  private constructor(transport: MessageTransport) {
    this.transport = transport;
    this.transport.onMessage((text) => this.handleFrame(text));
    this.transport.onClose(() => {
      this.transportClosed = true;
      for (const waiter of this.mutationWaiters.values()) {
        waiter({ error: "connection closed" });
      }
      this.mutationWaiters.clear();
    });
  }

  /** Connect and complete the handshake. Rejects on auth failure or timeout. */
  static async connect(options: RemoteClientOptions): Promise<RemoteProtocolAdapter> {
    const transport = createWsClientTransport(options.url);
    const client = new RemoteProtocolAdapter(transport);
    const timeoutMs = options.requestTimeoutMs ?? 10_000;
    const hello = await client.request("hello", {
      clientVersion: "ompweb-web",
      protocolVersions: [1],
      features: ["resume_v1", "mutations_v1"],
      deviceId: options.deviceId,
    }, timeoutMs);
    if (hello?.type !== "auth_required") {
      throw new AdapterUnavailableError("remote handshake: expected auth_required");
    }
    // Challenge-response: the proof is HMAC-SHA256(nonce, deviceSecret) —
    // never the raw device id (P0 review: bearer id was replayable).
    const challenge = (hello as { challenge?: string }).challenge;
    if (!challenge) {
      throw new Error("remote handshake: missing challenge");
    }
    const proof = hmacSha256Hex(options.deviceSecret, challenge);
    const welcome = await client.request("auth", { proof, deviceId: options.deviceId }, timeoutMs);
    if (welcome?.type !== "welcome") {
      throw new Error("remote auth failed");
    }
    await client.request("start", {}, timeoutMs);
    return client;
  }

  /** Send an agent mutation and wait for its mutation_result (dedup via the
   *  runtime ledger using a fresh clientMsgId per call). */
  async sendAgentCommand(sessionId: string, command: { type: string; [key: string]: unknown }): Promise<{ status: string; result: string }> {
    if (this.transportClosed) throw new Error("remote connection closed");
    if (command.type !== "prompt" && command.type !== "cancel") {
      throw new AdapterUnavailableError("remote agent commands beyond prompt/cancel are a route 14/20 slice");
    }
    const clientMsgId = `web-${Date.now().toString(36)}-${(this.requestSerial++).toString(36)}`;
    const requestHash = `${command.type}:${sessionId}`;
    const resultPromise = new Promise<{ status: string; result: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.mutationWaiters.delete(clientMsgId);
        reject(new Error("remote mutation timed out"));
      }, 60_000);
      this.mutationWaiters.set(clientMsgId, (payload) => {
        clearTimeout(timer);
        if (payload && typeof payload === "object" && "status" in payload) {
          resolve(payload as { status: string; result: string });
        } else {
          reject(new Error(`remote mutation failed: ${JSON.stringify(payload)}`));
        }
      });
    });
    await this.transport.send(JSON.stringify({
      version: 1,
      kind: "request",
      requestId: `m-${clientMsgId}`,
      streamId: "host",
      type: "mutation",
      payload: {
        clientMsgId,
        requestHash,
        mutation: { type: command.type === "prompt" ? "agent.prompt" : "agent.cancel", payload: { sessionId, ...command } },
      },
    }));
    return resultPromise;
  }

  close(): void {
    this.transport.close();
  }

  private request(type: string, payload: Record<string, unknown>, timeoutMs: number): Promise<{ type?: string; [key: string]: unknown } | undefined> {
    const requestId = `web-${this.requestSerial++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`remote request timed out: ${type}`));
      }, timeoutMs);
      this.pending.set(requestId, {
        resolve: (value) => { clearTimeout(timer); resolve(value as { type?: string } | undefined); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      void this.transport.send(JSON.stringify({ version: 1, kind: "request", requestId, streamId: "host", type, payload }));
    });
  }

  private handleFrame(text: string): void {
    let msg: { requestId?: string; type?: string; payload?: unknown; kind?: string };
    try {
      msg = JSON.parse(text) as typeof msg;
    } catch {
      return;
    }
    if (msg.kind === "event" && msg.type === "mutation_result" && msg.payload && typeof msg.payload === "object") {
      const clientMsgId = (msg.payload as { clientMsgId?: string }).clientMsgId;
      if (clientMsgId) {
        const waiter = this.mutationWaiters.get(clientMsgId);
        if (waiter) {
          this.mutationWaiters.delete(clientMsgId);
          waiter(msg.payload);
        }
      }
      return;
    }
    if (msg.type === "sync_complete" || msg.type === "pong" || msg.type === "auth_required" || msg.type === "welcome") {
      const requestId = typeof msg.requestId === "string" ? msg.requestId : "";
      if (requestId) {
        const pending = this.pending.get(requestId);
        if (pending) {
          this.pending.delete(requestId);
          const payload = msg.payload && typeof msg.payload === "object"
            ? { ...(msg.payload as Record<string, unknown>), type: msg.type }
            : { type: msg.type };
          pending.resolve(payload);
        }
      }
    }
  }
}
// HttpSseAdapter: the 4.x-faithful OmpwebClient implementation over Next API
// routes + EventSource (doc 01 Slice 2). Behavior mirrors the existing call
// sites exactly — same endpoints, same envelope parsing, same error mapping —
// so useAgentSession can consume the interface without behavior change.

import type {
  AgentClient,
  AgentSessionEvents,
  EventSubscription,
  OmpwebClient,
  SessionClient,
  SubscriptionState,
  SystemClient,
} from "./types";
import { toClientError } from "./types";
import type { SessionInfo } from "@/lib/types";
import { subscribeSessionsChanged } from "../session-change-bus";

/** Same envelope contract as lib/agent-client.ts. */
interface ApiBody<T> {
  success?: boolean;
  data?: T;
  error?: string;
  code?: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as ApiBody<T>;
  if (!res.ok || body.error) throw toClientError(body, res.status);
  return body.data as T;
}

class SseSubscription implements EventSubscription {
  private es: EventSource | null;
  #state: SubscriptionState = "connecting";
  #userClosed = false;
  constructor(
    url: string,
    private handlers: { onOpen?: () => void; onFatalClose?: () => void },
    wire: (es: EventSource) => void,
  ) {
    this.es = new EventSource(url);
    this.es.onopen = () => {
      this.#state = "open";
      this.handlers.onOpen?.();
    };
    wire(this.es);
    this.es.onerror = () => {
      // EventSource retries by itself; surface state but keep the handle.
      const fatal = this.#userClosed || this.es?.readyState === EventSource.CLOSED;
      this.#state = fatal ? "closed" : "connecting";
      if (fatal && !this.#userClosed) this.handlers.onFatalClose?.();
    };
  }
  get state(): SubscriptionState {
    return this.#state;
  }
  get isOpen(): boolean {
    return this.es?.readyState === EventSource.OPEN;
  }
  get lastCursor(): null {
    return null;
  }
  close(): void {
    // Deliberate close is NOT a fatal down (mirrors EventSource semantics:
    // close() does not fire onerror).
    this.#userClosed = true;
    this.es?.close();
    this.es = null;
    this.#state = "closed";
  }
  resync(): void {
    // 4.x SSE has no replay: resync == reconnect.
    const url = this.es?.url;
    if (url) {
      this.close();
      // Recreated by the owning hook when it observes state === "closed".
    }
  }
}

class HttpAgentClient implements AgentClient {
  async sendCommand<T = unknown>(sessionId: string, command: Record<string, unknown>): Promise<T> {
    return request<T>(`/api/agent/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
  }
  subscribeSessionEvents(sessionId: string, handlers: AgentSessionEvents): EventSubscription {
    return new SseSubscription(
      `/api/agent/${encodeURIComponent(sessionId)}/events`,
      { onOpen: () => handlers.onOpen?.(), onFatalClose: () => handlers.onDown?.({ fatal: true }) },
      (es) => {
        es.onmessage = (ev) => {
          let frame: unknown;
          try {
            frame = JSON.parse(ev.data);
          } catch {
            handlers.onError?.({ code: "invalid_json", message: "Malformed SSE frame", retryable: false });
            return;
          }
          const type = (frame as { type?: string }).type;
          if (type === "connected") handlers.onConnected?.(frame as never);
          else if (type === "session_destroyed") handlers.onDestroyed?.(frame as never);
          else handlers.onEvent?.(frame as never);
        };
      },
    );
  }
  subscribeRunningSessions(handlers: { onIds?: (ids: string[]) => void; onError?: (error: never) => void }): EventSubscription {
    return new SseSubscription(
      "/api/agent/running/events",
      {},
      (es) => {
        es.onmessage = (ev) => {
          try {
            const frame = JSON.parse(ev.data) as { type?: string; runningSessionIds?: string[] };
            if (frame.type === "running" && Array.isArray(frame.runningSessionIds)) {
              handlers.onIds?.(frame.runningSessionIds);
            }
          } catch {
            /* tolerate malformed keepalives */
          }
        };
      },
    );
  }
}

class HttpSessionClient implements SessionClient {
  async list(): Promise<SessionInfo[]> {
    // The list route answers a raw body ({sessions, runningSessionIds}) —
    // NOT the {success,data} envelope; the adapter maps it faithfully.
    const res = await fetch("/api/sessions", { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as
      | SessionInfo[]
      | { sessions?: SessionInfo[]; error?: string; code?: string };
    if (!res.ok || (!Array.isArray(body) && body.error)) {
      throw toClientError(Array.isArray(body) ? {} : body, res.status);
    }
    if (Array.isArray(body)) return body;
    return Array.isArray(body.sessions) ? body.sessions : [];
  }
  async getContext(sessionId: string, leafId?: string | null): Promise<unknown> {
    const query = leafId ? `?leafId=${encodeURIComponent(leafId)}` : "";
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/context${query}`, { cache: "no-store" });
    // The context route answers a raw `{ context }` body (no envelope).
    const body = (await res.json().catch(() => ({}))) as { context?: unknown; data?: unknown; error?: string; code?: string };
    if (!res.ok || body.error) throw toClientError(body, res.status);
    if (body.context !== undefined) return body.context;
    if (body.data !== undefined) return body.data;
    return body;
  }
  async rename(sessionId: string, name: string): Promise<void> {
    await request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }
  async archive(sessionId: string): Promise<void> {
    await request(`/api/sessions/${encodeURIComponent(sessionId)}/archive`, { method: "POST" });
  }
  async delete(sessionId: string): Promise<void> {
    await request(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  }
}

class HttpSystemClient implements SystemClient {
  subscribeSessionsChanged(listener: (sessionIds: string[]) => void): () => void {
    return subscribeSessionsChanged(listener);
  }
}

export function createHttpSseClient(): OmpwebClient {
  return {
    agent: new HttpAgentClient(),
    sessions: new HttpSessionClient(),
    system: new HttpSystemClient(),
  };
}

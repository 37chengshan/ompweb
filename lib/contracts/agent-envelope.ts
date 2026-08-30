// Wire-contract primitives for the ompweb client boundary (5.0 doc 01).
//
// W0 freezes the current 4.x HTTP envelope and the SSE frame-type surface as
// fixtures + tests (lib/contracts/agent-contract.test.mjs). Slice 2 builds the
// AgentClient/SessionClient on top of these types; adapters (HTTP/SSE now,
// Remote WS later) must preserve them. These are transport-independent
// declarations — no Node or DOM specific types may appear here.

/** Every /api JSON route answers with one of these envelopes. */
export interface ApiSuccessEnvelope<T = unknown> {
  success: true;
  data: T;
}

export interface ApiFailureEnvelope {
  /** HTTP status stays in the response; this is the body. */
  success?: false;
  /** Human-readable server text (English) — fallback only. */
  error: string;
  /** Stable machine code; UI branches on this, never on `error` text. */
  code?: string;
}

export type ApiEnvelope<T = unknown> = ApiSuccessEnvelope<T> | ApiFailureEnvelope;

/** Transport-level SSE frames sent by /api/agent/[id]/events. */
export interface ConnectedFrame {
  type: "connected";
  sessionId: string;
}

export interface SessionDestroyedFrame {
  type: "session_destroyed";
}

/**
 * Event frames forwarded from the omp RPC layer. The concrete per-type payload
 * shapes live in pi-types.ts; the frozen surface is the type-name set (see
 * fixtures/sse-frames.json + the contract test).
 */
export interface AgentEventFrame {
  type: string;
  [key: string]: unknown;
}

export const TRANSPORT_FRAME_TYPES = ["connected", "session_destroyed"] as const;

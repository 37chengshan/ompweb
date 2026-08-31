// Remote Protocol v1 wire types + codec (5.0 doc 03 / ADR-004).
//
// Versioned JSON messages over a message-framed transport (WS today, in-memory
// for conformance). No binary framing in v1; data channels come later behind
// `binary_data_v1`. The codec is deliberately strict: unknown OPTIONAL fields
// are preserved, but malformed envelopes fail with stable error codes instead
// of being guessed at.

export const PROTOCOL_VERSION = 1;

export const PROTOCOL_KINDS = ["request", "response", "event", "flow", "error"] as const;
export type ProtocolKind = (typeof PROTOCOL_KINDS)[number];

/** Doc 03 envelope. `cursor` is transport-level (host epoch + stream seq). */
export interface ProtocolMessage<T = unknown> {
  version: 1;
  kind: ProtocolKind;
  requestId?: string;
  streamId: string;
  cursor?: { hostEpoch: string; seq: number };
  type: string;
  payload?: T;
}

export const PROTOCOL_ERROR_CODES = [
  "invalid_json",
  "version_unsupported",
  "invalid_kind",
  "invalid_type",
  "invalid_stream_id",
  "missing_request_id",
  "seq_not_safe_integer",
  "payload_too_large",
  "invalid_cursor",
  "invalid_envelope",
] as const;
export type ProtocolErrorCode = (typeof PROTOCOL_ERROR_CODES)[number];

export interface ProtocolLimits {
  /** Hard cap for a single encoded message. */
  maxMessageBytes: number;
  maxStreamIdLength: number;
  maxTypeLength: number;
}

export const DEFAULT_PROTOCOL_LIMITS: ProtocolLimits = {
  maxMessageBytes: 1024 * 1024,
  maxStreamIdLength: 128,
  maxTypeLength: 128,
};

const STREAM_ID_RE = /^[a-zA-Z0-9:_./-]+$/;

export interface DecodeSuccess<T = unknown> {
  ok: true;
  message: ProtocolMessage<T>;
}

export interface DecodeFailure {
  ok: false;
  code: ProtocolErrorCode;
  detail?: string;
}

export function encodeMessage<T>(message: ProtocolMessage<T>, limits: ProtocolLimits = DEFAULT_PROTOCOL_LIMITS): { ok: true; text: string } | { ok: false; code: ProtocolErrorCode } {
  if (!Number.isSafeInteger(message.version) || message.version !== PROTOCOL_VERSION) {
    return { ok: false, code: "version_unsupported" };
  }
  const text = JSON.stringify(message);
  if (Buffer.byteLength(text) > limits.maxMessageBytes) return { ok: false, code: "payload_too_large" };
  return { ok: true, text };
}

export function decodeMessage<T = unknown>(text: string, limits: ProtocolLimits = DEFAULT_PROTOCOL_LIMITS): DecodeSuccess<T> | DecodeFailure {
  if (Buffer.byteLength(text) > limits.maxMessageBytes) return { ok: false, code: "payload_too_large" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: "invalid_json" };
  }
  const result = validateEnvelope(raw, limits);
  if (!result.ok) return result;
  return { ok: true, message: raw as ProtocolMessage<T> };
}

/** Structural validation shared by decode and outbound construction. */
export function validateEnvelope(raw: unknown, limits: ProtocolLimits = DEFAULT_PROTOCOL_LIMITS): DecodeSuccess | DecodeFailure {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, code: "invalid_envelope" };
  }
  const msg = raw as Record<string, unknown>;
  if (!Number.isSafeInteger(msg.version) || msg.version !== PROTOCOL_VERSION) {
    return { ok: false, code: "version_unsupported" };
  }
  if (typeof msg.kind !== "string" || !PROTOCOL_KINDS.includes(msg.kind as ProtocolKind)) {
    return { ok: false, code: "invalid_kind" };
  }
  if (typeof msg.type !== "string" || msg.type.length === 0 || msg.type.length > limits.maxTypeLength) {
    return { ok: false, code: "invalid_type" };
  }
  if (typeof msg.streamId !== "string" || msg.streamId.length === 0 || msg.streamId.length > limits.maxStreamIdLength || !STREAM_ID_RE.test(msg.streamId)) {
    return { ok: false, code: "invalid_stream_id" };
  }
  if ((msg.kind === "request" || msg.kind === "response") && (typeof msg.requestId !== "string" || msg.requestId.length === 0)) {
    return { ok: false, code: "missing_request_id" };
  }
  if (msg.cursor !== undefined) {
    const cursor = msg.cursor as Record<string, unknown>;
    if (typeof cursor !== "object" || cursor === null || typeof cursor.hostEpoch !== "string" || cursor.hostEpoch.length === 0) {
      return { ok: false, code: "invalid_cursor" };
    }
    if (!Number.isSafeInteger(cursor.seq) || (cursor.seq as number) < 0) {
      return { ok: false, code: "seq_not_safe_integer" };
    }
  }
  // Unknown optional fields are preserved (forward compatibility, doc 03).
  return { ok: true, message: raw as ProtocolMessage };
}

/** Wire handshake messages (doc 03 握手). AUTH proof semantics live in ADR-005. */
export interface HelloPayload {
  clientVersion: string;
  protocolVersions: number[];
  features: string[];
  deviceId: string;
}

export interface WelcomePayload {
  protocolVersion: number;
  serverVersion: string;
  hostEpoch: string;
  features: string[];
  limits: { maxMessageBytes: number };
}

export interface ResumePayload {
  /** Client-cached host epoch; mismatch ⇒ full resync (doc 02 resume). */
  hostEpoch?: string;
  cursors: Array<{ streamId: string; seq: number }>;
}

export interface SyncCompletePayload {
  heads: Array<{ streamId: string; seq: number }>;
}

export const PROTOCOL_FEATURES = {
  resumeV1: "resume_v1",
  mutationsV1: "mutations_v1",
  binaryDataV1: "binary_data_v1",
  settingsRegistryV1: "settings_registry_v1",
} as const;

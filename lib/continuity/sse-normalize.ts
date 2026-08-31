// 4.x SSE frame → ReliableEvent envelope normalizer (doc 02 Slice 2 PoC).
//
// Classifies every frame type the chat client handles today (the set frozen in
// lib/contracts/fixtures/sse-frames.json) into the doc-02 event classes. This
// is the experiment-flag PoC path: it lets the WS/Host resume semantics be
// tested against real 4.x frames without touching production SSE behavior.

import type { EventClass, ReliableEvent } from "./model";

/**
 * Class map, derived from doc 02's persistence policy:
 * - reliable: state boundaries and receipts (agent start/end, message
 *   start/end, tool start/end, notices, config/model changes, approvals);
 * - coalesced: high-rate streaming frames where only the latest matters;
 * - ephemeral: transport/keepalive noise (nothing in 4.x maps here today).
 */
export const SSE_FRAME_CLASSES: Readonly<Record<string, EventClass>> = Object.freeze({
  agent_start: "reliable",
  agent_end: "reliable",
  prompt_result: "reliable",
  prompt_error: "reliable",
  notice: "reliable",
  command_output: "reliable",
  thinking_level_changed: "reliable",
  model_changed: "reliable",
  config_update: "reliable",
  available_commands_update: "reliable",
  message_start: "reliable",
  message_end: "reliable",
  tool_execution_start: "reliable",
  tool_execution_end: "reliable",
  todo_reminder: "coalesced",
  todo_auto_clear: "reliable",
  auto_retry_start: "reliable",
  auto_retry_end: "reliable",
  auto_compaction_start: "reliable",
  auto_compaction_end: "reliable",
  subagent_lifecycle: "reliable",
  host_tool_call: "reliable",
  host_uri_request: "reliable",
  subagent_progress: "coalesced",
  subagent_event: "coalesced",
  extension_ui_request: "reliable",
  message_update: "coalesced",
});

export interface NormalizeOptions {
  hostEpoch: string;
  streamId: string;
  seq: number;
  occurredAt?: number;
  eventId?: string;
}

export interface NormalizedUnknown {
  class: "ephemeral";
  unknownType: true;
  type: string;
}

/** True when every handled frame type has an explicit classification. */
export function isKnownFrameType(type: string): boolean {
  return Object.hasOwn(SSE_FRAME_CLASSES, type);
}

export function normalizeFrame(frame: { type?: string } & Record<string, unknown>, opts: NormalizeOptions): ReliableEvent | (ReliableEvent & NormalizedUnknown) {
  const type = typeof frame.type === "string" ? frame.type : "unknown";
  const known = isKnownFrameType(type);
  const event: ReliableEvent = {
    cursor: { hostEpoch: opts.hostEpoch, streamId: opts.streamId, seq: opts.seq },
    eventId: opts.eventId ?? `sse-${opts.streamId}-${opts.seq}`,
    type,
    payloadVersion: 1,
    occurredAt: opts.occurredAt ?? 0,
    recordedAt: opts.occurredAt ?? 0,
    class: known ? SSE_FRAME_CLASSES[type] : "ephemeral",
    payload: frame,
  };
  if (!known) {
    // Unknown types are recorded as telemetry-shaped ephemeral events and
    // safely ignored (doc 02: never guess success for unknown results).
    return Object.assign(event, { unknownType: true as const, type });
  }
  return event;
}

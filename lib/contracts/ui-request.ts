// HostUIRequest lifecycle contract (5.0 doc 08) — the extension dialog
// methods omp sends over RPC (select / confirm / input / editor), with the
// settle semantics that must hold across timeout, cancel and disconnect.
//
// Pure state machine: no DOM, no Next, no timers — the caller supplies the
// clock. Used by the chat hook's extension-dialog handling and by adapters.

export type HostUiRequestMethod = "select" | "confirm" | "input" | "editor";

export interface HostUiRequestBase {
  /** omp request id — stable across reconnects of the same logical request. */
  id: string;
  title: string;
  /** Wall-clock deadline; enforced through `settle(request, nowMs)`. */
  expiresAt?: number;
}

export interface SelectUiRequest extends HostUiRequestBase {
  method: "select";
  options: string[];
}

export interface ConfirmUiRequest extends HostUiRequestBase {
  method: "confirm";
  message: string;
}

export interface InputUiRequest extends HostUiRequestBase {
  method: "input";
  placeholder?: string;
}

export interface EditorUiRequest extends HostUiRequestBase {
  method: "editor";
  prefill?: string;
}

export type HostUiRequest = SelectUiRequest | ConfirmUiRequest | InputUiRequest | EditorUiRequest;

export type HostUiOutcome =
  | { status: "resolved"; response: HostUiResponse }
  | { status: "cancelled" }
  | { status: "expired" }
  | { status: "disconnected" };

export type HostUiResponse = { value: string } | { confirmed: boolean } | { cancelled: true };

export interface HostUiRequestState {
  request: HostUiRequest;
  outcome: HostUiOutcome | null;
}

/**
 * Settle a request exactly once. Whichever terminal condition arrives first
 * (user response, cancel, deadline, disconnect) wins; every later settle is a
 * no-op. This is the contract doc 08 requires for reconnect/timeout paths:
 * a request can never be answered twice, and an expired request can never be
 * answered late.
 */
export function settleUiRequest(state: HostUiRequestState, outcome: HostUiOutcome, nowMs: number): HostUiRequestState {
  if (state.outcome) return state;
  if (outcome.status === "resolved") {
    // Method-shaped validation: select needs one of its options; confirm a
    // boolean; input/editor a string value.
    const { request, } = state;
    const response = outcome.response;
    if ("cancelled" in response) return { ...state, outcome };
    switch (request.method) {
      case "select":
        if (!("value" in response) || !request.options.includes(response.value)) return state;
        break;
      case "confirm":
        if (!("confirmed" in response)) return state;
        break;
      case "input":
      case "editor":
        if (!("value" in response) || typeof response.value !== "string") return state;
        break;
    }
  }
  if (outcome.status === "resolved" && state.request.expiresAt !== undefined && nowMs > state.request.expiresAt) {
    return { ...state, outcome: { status: "expired" } };
  }
  return { ...state, outcome };
}

/** Deadline sweep: called on tick / reconnect; marks overdue requests. */
export function expireOverdue(state: HostUiRequestState, nowMs: number): HostUiRequestState {
  if (state.outcome) return state;
  if (state.request.expiresAt !== undefined && nowMs > state.request.expiresAt) {
    return { ...state, outcome: { status: "expired" } };
  }
  return state;
}

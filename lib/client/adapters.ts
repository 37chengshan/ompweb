/**
 * Client adapter contract (doc 16 route 1): React must not know the
 * transport — sessions/agent/events/terminal/files/git/settings/commands/
 * remote all flow through the OmpWebClient surface, and the runtime picks
 * the adapter by kind:
 *
 *   legacy-http  — current production shape (Next /api + SSE)
 *   tauri-core   — Tauri IPC/Channel (route 18; not landed → unavailable)
 *   remote       — RemoteProtocol WS (routes 14/20; not landed → unavailable)
 *
 * Unlanded kinds fail deterministically (client_runtime_unavailable, naming
 * the pending route) instead of pretending to work — the same fail-closed
 * rule the Rust host uses. The factory is the single construction point for
 * production clients.
 */
import { createHttpSseClient } from "./http-sse-adapter";
import type { OmpwebClient } from "./types";

export type ClientAdapterKind = "legacy-http" | "tauri-core" | "remote";

export class AdapterUnavailableError extends Error {
  readonly code = "client_runtime_unavailable";
  constructor(kind: Exclude<ClientAdapterKind, "legacy-http">, pendingRoute: string) {
    super(`client adapter "${kind}" is not available yet — lands with ${pendingRoute}; use legacy-http`);
    this.name = "AdapterUnavailableError";
  }
}

/** Kind → pending doc-16 route that retires the error. */
const PENDING_ROUTE: Record<Exclude<ClientAdapterKind, "legacy-http">, string> = {
  "tauri-core": "doc16 路线 18（Tauri Desktop）",
  remote: "doc16 路线 14/20（Remote Runtime / Mobile）",
};

export function createOmpwebClient(kind: ClientAdapterKind): OmpwebClient {
  switch (kind) {
    case "legacy-http":
      return createHttpSseClient();
    case "tauri-core":
    case "remote":
      throw new AdapterUnavailableError(kind, PENDING_ROUTE[kind]);
    default: {
      const exhaustive: never = kind;
      throw new Error(`unknown client adapter kind: ${String(exhaustive)}`);
    }
  }
}

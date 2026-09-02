// Barrel for the transport-agnostic client boundary (5.0 doc 01).

export type {
  AgentClient,
  AgentSessionEvents,
  ClientError,
  EventSubscription,
  GitClient,
  GitHubStatusPayload,
  OmpwebClient,
  SessionClient,
  SubscriptionState,
} from "./types";
export { toClientError } from "./types";
export { createHttpSseClient } from "./http-sse-adapter";
export { createFixtureClient, type FixtureState } from "./fixture-adapter";
// Route 1 (doc 16): the adapter contract + single construction point.
export { AdapterUnavailableError, createOmpwebClient, type ClientAdapterKind } from "./adapters";

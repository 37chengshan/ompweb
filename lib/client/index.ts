// Barrel for the transport-agnostic client boundary (5.0 doc 01).

export type {
  AgentClient,
  AgentSessionEvents,
  ClientError,
  EventSubscription,
  OmpwebClient,
  SessionClient,
  SubscriptionState,
} from "./types";
export { toClientError } from "./types";
export { createHttpSseClient } from "./http-sse-adapter";
export { createFixtureClient, type FixtureState } from "./fixture-adapter";

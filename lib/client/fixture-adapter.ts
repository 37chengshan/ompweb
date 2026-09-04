// FixtureAdapter: drives the same OmpwebClient interfaces from the committed
// contract fixtures (lib/contracts/fixtures) so contract/UI tests render and
// assert without Next or OMP running (doc 01 Slice 2, doc 10 static client).

import type {
  AgentClient,
  AgentSessionEvents,
  EventSubscription,
  GitClient,
  GitHubStatusPayload,
  OmpwebClient,
  SessionClient,
  SubscriptionState,
  SystemClient,
} from "./types";
import type { SessionInfo } from "@/lib/types";

export interface FixtureState {
  /** RPC command recorder — assertions assert on issued commands. */
  readonly issuedCommands: Array<{ sessionId: string; command: Record<string, unknown> }>;
  /** Queue an event frame to the next/current session subscription. */
  emitSessionEvent(frame: Record<string, unknown>): void;
  setSessions(sessions: SessionInfo[]): void;
  setContext(context: unknown): void;
  failNextCommand(error: { code: string; message: string }): void;
  emitSessionsChanged(ids: string[]): void;
  /** Serve a git status payload once (null = no repo). */
  setGitStatus(payload: GitHubStatusPayload | null): void;
  /** Fail the next git mutation once. */
  failNextGit(error: Error): void;
}

class ManualSubscription implements EventSubscription {
  #state: SubscriptionState = "open";
  constructor(private onClose: () => void) {}
  get state(): SubscriptionState {
    return this.#state;
  }
  get isOpen(): boolean {
    return this.#state === "open";
  }
  get lastCursor(): null {
    return null;
  }
  close(): void {
    this.#state = "closed";
    this.onClose();
  }
  resync(): void {
    /* fixtures are static; nothing to re-issue */
  }
  forceClose(): void {
    this.#state = "closed";
  }
}

export function createFixtureClient(initialSessions: SessionInfo[] = []): { client: OmpwebClient; fixtures: FixtureState } {
  const sessions = [...initialSessions];
  let context: unknown = { messages: [], entryIds: [], thinkingLevel: "off", model: null, todoPhases: [] };
  const issuedCommands: Array<{ sessionId: string; command: Record<string, unknown> }> = [];
  const sessionHandlers = new Set<AgentSessionEvents>();
  let nextCommandFailure: { code: string; message: string } | null = null;

  const fixtures: FixtureState = {
    issuedCommands,
    emitSessionEvent(frame) {
      for (const h of sessionHandlers) h.onEvent?.(frame as never);
    },
    setSessions(next) {
      sessions.splice(0, sessions.length, ...next);
    },
    setContext(next) {
      context = next;
    },
    failNextCommand(error) {
      nextCommandFailure = error;
    },
    emitSessionsChanged(ids) {
      for (const l of sessionListeners) l(ids);
    },
    setGitStatus(payload) {
      nextGitStatus = payload;
    },
    failNextGit(error) {
      nextGitFailure = error;
    },
  };

  const agent: AgentClient = {
    async sendCommand<T = unknown>(sessionId: string, command: Record<string, unknown>): Promise<T> {
      issuedCommands.push({ sessionId, command });
      if (nextCommandFailure) {
        const failure = nextCommandFailure;
        nextCommandFailure = null;
        throw failure;
      }
      return { ok: true } as T;
    },
    subscribeSessionEvents(_sessionId, handlers) {
      sessionHandlers.add(handlers);
      handlers.onConnected?.({ type: "connected", sessionId: _sessionId } as never);
      return new ManualSubscription(() => sessionHandlers.delete(handlers));
    },
    subscribeRunningSessions(handlers) {
      handlers.onIds?.([]);
      return new ManualSubscription(() => undefined);
    },
  };

  const sessionApi: SessionClient = {
    async list() {
      return sessions.map((s) => ({ ...s }));
    },
    async getContext() {
      return typeof context === "object" && context !== null ? JSON.parse(JSON.stringify(context)) : context;
    },
    async rename(sessionId, name) {
      const found = sessions.find((s) => s.id === sessionId);
      if (found) found.name = name;
    },
    async archive() {
      /* fixture no-op */
    },
    async delete(sessionId) {
      const idx = sessions.findIndex((s) => s.id === sessionId);
      if (idx >= 0) sessions.splice(idx, 1);
    },
  };

  const sessionListeners = new Set<(sessionIds: string[]) => void>();
  const system: SystemClient = {
    subscribeSessionsChanged(listener) {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
  };

  let nextGitStatus: GitHubStatusPayload | null = null;
  let nextGitFailure: Error | null = null;

  // Fixture git: no network; the panel's commit/push/status flows are
  // exercised in render tests via explicit fixture errors/values below.
  const git: GitClient = {
    async status() {
      if (nextGitStatus) {
        const payload = nextGitStatus;
        nextGitStatus = null;
        return payload;
      }
      return { repo: null };
    },
    async commit() {
      if (nextGitFailure) {
        const failure = nextGitFailure;
        nextGitFailure = null;
        throw failure;
      }
      return { hash: "fixture-hash" };
    },
    async push() {
      if (nextGitFailure) {
        const failure = nextGitFailure;
        nextGitFailure = null;
        throw failure;
      }
      return { branch: "fixture-branch" };
    },
    async branches() {
      return [{ name: "fixture-branch", current: true }, { name: "main", current: false }];
    },
    async checkout() {
      return { branch: "fixture-branch" };
    },
  };

  // Fixture native settings: no network — render tests only need the surface.
  const nativeSettings = {
    async list() {
      return { settings: [], path: null };
    },
    async set() {
      return { ok: true };
    },
    async reset() {
      return { ok: true };
    },
  };

  return {
    client: { agent, sessions: sessionApi, system, git, nativeSettings },
    fixtures,
  };
}

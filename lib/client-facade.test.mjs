import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createFixtureClient } = await jiti.import("./client/fixture-adapter.ts");
const { createHttpSseClient } = await jiti.import("./client/http-sse-adapter.ts");
const { toClientError } = await jiti.import("./client/types.ts");

// 5.0 doc 01 Slice 2 gate: both adapters satisfy the same OmpwebClient
// contract. The fixture adapter proves UI states can run without Next/OMP;
// the HTTP adapter proves the 4.x envelope mapping is preserved.

const sampleSession = {
  path: "/tmp/s.jsonl",
  id: "abc",
  cwd: "/tmp",
  name: "t",
  created: "2026-08-30T00:00:00.000Z",
  modified: "2026-08-30T00:00:00.000Z",
  messageCount: 1,
  firstMessage: "hi",
};

test("fixture adapter: session CRUD + command recording + event emission", async () => {
  const { client, fixtures } = createFixtureClient([{ ...sampleSession }]);

  assert.equal((await client.sessions.list()).length, 1);
  await client.sessions.rename("abc", "renamed");
  assert.equal((await client.sessions.list())[0].name, "renamed");

  await client.agent.sendCommand("abc", { type: "prompt", content: "hello" });
  await client.agent.sendCommand("abc", { type: "abort" });
  assert.deepEqual(fixtures.issuedCommands.map((c) => c.command.type), ["prompt", "abort"]);

  const seen = [];
  const sub = client.agent.subscribeSessionEvents("abc", { onEvent: (f) => seen.push(f) });
  fixtures.emitSessionEvent({ type: "message_update", payload: { text: "x" } });
  fixtures.emitSessionEvent({ type: "agent_end" });
  assert.deepEqual(seen.map((f) => f.type), ["message_update", "agent_end"]);
  assert.equal(sub.state, "open");
  sub.close();
  assert.equal(sub.state, "closed");
  assert.equal(sub.isOpen, false);
  assert.equal(sub.lastCursor, null);

  fixtures.failNextCommand({ code: "agent_busy", message: "busy" });
  await assert.rejects(() => client.agent.sendCommand("abc", { type: "prompt" }), (err) => err.code === "agent_busy");
});

test("http adapter: sendCommand preserves the 4.x request/response envelope", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { state: "idle" } }),
    };
  };
  try {
    const client = createHttpSseClient();
    const data = await client.agent.sendCommand("s 1", { type: "get_state" });
    assert.deepEqual(data, { state: "idle" });
    assert.equal(calls[0].url, "/api/agent/s%201");
    assert.deepEqual(JSON.parse(calls[0].init.body), { type: "get_state" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("http adapter: error envelope maps to ClientError with retryability", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: "boom", code: "internal_error" }),
  });
  try {
    const client = createHttpSseClient();
    await assert.rejects(() => client.sessions.list(), (err) => {
      assert.equal(err.code, "internal_error");
      assert.equal(err.retryable, true);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("http adapter: session subscription routes connected/destroyed/event frames", async () => {
  class FakeEventSource {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSED = 2;
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      FakeEventSource.last = this;
    }
    close() {
      this.readyState = 2;
    }
  }
  FakeEventSource.last = null;
  const originalES = globalThis.EventSource;
  globalThis.EventSource = FakeEventSource;
  try {
    const client = createHttpSseClient();
    const seen = { open: 0, connected: 0, events: [], destroyed: 0 };
    const sub = client.agent.subscribeSessionEvents("abc", {
      onOpen: () => seen.open++,
      onConnected: () => seen.connected++,
      onEvent: (f) => seen.events.push(f.type),
      onDestroyed: () => seen.destroyed++,
    });
    const es = FakeEventSource.last;
    assert.equal(es.url, "/api/agent/abc/events");
    es.onopen?.();
    assert.equal(seen.open, 1);
    assert.equal(sub.isOpen, true);
    es.onmessage?.({ data: JSON.stringify({ type: "connected", sessionId: "abc" }) });
    es.onmessage?.({ data: JSON.stringify({ type: "agent_start" }) });
    es.onmessage?.({ data: "not-json" });
    es.onmessage?.({ data: JSON.stringify({ type: "session_destroyed" }) });
    assert.equal(seen.connected, 1);
    assert.deepEqual(seen.events, ["agent_start"]);
    assert.equal(seen.destroyed, 1);
    es.readyState = 2;
    es.onerror?.();
    sub.close();
    assert.equal(sub.state, "closed");
  } finally {
    globalThis.EventSource = originalES;
  }
});

test("toClientError keeps codes stable and derives retryability from status", () => {
  assert.deepEqual(toClientError({ error: "nope", code: "not_paired" }, 403), {
    code: "not_paired",
    message: "nope",
    retryable: false,
  });
  assert.equal(toClientError({}, 429).retryable, true);
  assert.equal(toClientError({}).code.startsWith("http_"), true);
});

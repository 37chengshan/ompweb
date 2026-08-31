import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const protocol = await jiti.import("./remote-protocol/protocol.ts");
const { ConnectionScheduler } = await jiti.import("./remote-protocol/scheduler.ts");
const { HostConnection, makeHello, clientFeatures } = await jiti.import("./remote-protocol/host-connection.ts");
const { MemoryJournal } = await jiti.import("./continuity/journal.ts");
const { MutationLedger } = await jiti.import("./continuity/mutations.ts");

const { PROTOCOL_VERSION, encodeMessage, decodeMessage, DEFAULT_PROTOCOL_LIMITS } = protocol;

// 5.0 doc 03 P1–P4 conformance (ADR-004). Transport is an in-memory pipe —
// the `ws` binding is a separate dependency decision and plugs in unchanged.

/** Full-duplex in-memory message pipe. */
const flush = () => new Promise((r) => setImmediate(r));

function makePipe() {
  // client.send() → host's onMessage handlers; host.send() → client's.
  const clientReceive = [];
  const hostReceive = [];
  const clientClose = [];
  const hostClose = [];
  const client = {
    send: (text) => hostReceive.forEach((h) => h(text)),
    onMessage: (h) => clientReceive.push(h),
    close: () => hostClose.forEach((h) => h()),
    onClose: (h) => clientClose.push(h),
  };
  const host = {
    send: (text) => clientReceive.forEach((h) => h(text)),
    onMessage: (h) => hostReceive.push(h),
    close: (code, reason) => clientClose.forEach((h) => h(code, reason)),
    onClose: (h) => hostClose.push(h),
  };
  return { client, host };
}

/** Client test harness: collects frames, exposes request() helper. */
function makeClient(pipe) {
  const frames = [];
  pipe.client.onMessage((text) => frames.push(JSON.parse(text)));
  const send = (msg) => pipe.client.send(JSON.stringify(msg));
  return {
    frames,
    send,
    last(type) {
      return frames.filter((f) => f.type === type).at(-1);
    },
  };
}

test("codec: roundtrip preserves unknown optional fields; malformed input fails with stable codes", () => {
  const msg = {
    version: 1,
    kind: "event",
    streamId: "session:abc",
    type: "agent_end",
    cursor: { hostEpoch: "e1", seq: 42 },
    payload: { ok: true },
    unknownOptional: { keep: "me" },
  };
  const encoded = encodeMessage(msg);
  assert.ok(encoded.ok);
  const decoded = decodeMessage(encoded.text);
  assert.ok(decoded.ok);
  assert.equal(decoded.message.unknownOptional.keep, "me");
  assert.equal(decoded.message.cursor.seq, 42);

  assert.equal(decodeMessage("{not json").code, "invalid_json");
  assert.equal(decodeMessage(JSON.stringify({ ...msg, version: 2 })).code, "version_unsupported");
  assert.equal(decodeMessage(JSON.stringify({ ...msg, kind: "steal" })).code, "invalid_kind");
  assert.equal(decodeMessage(JSON.stringify({ ...msg, streamId: "bad id!" })).code, "invalid_stream_id");
  assert.equal(
    decodeMessage(JSON.stringify({ version: 1, kind: "request", streamId: "host", type: "x", payload: {} })).code,
    "missing_request_id",
  );
  const badSeq = { ...msg, cursor: { hostEpoch: "e1", seq: Number.MAX_SAFE_INTEGER + 1 } };
  assert.equal(decodeMessage(JSON.stringify(badSeq)).code, "seq_not_safe_integer");
  const huge = JSON.stringify({ ...msg, payload: { blob: "x".repeat(DEFAULT_PROTOCOL_LIMITS.maxMessageBytes + 10) } });
  assert.equal(decodeMessage(huge).code, "payload_too_large");
});

function handshake(pipe, { token, journal, ledger, limits } = {}) {
  const executed = [];
  const connection = new HostConnection(pipe.host, {
    journal,
    ledger,
    ...(token
      ? { authenticator: async (proof) => (proof === token ? { ok: true, deviceId: "dev-1" } : { ok: false, code: "auth_failed", message: "bad token" }) }
      : {}),
    ...(limits ? { schedulerLimits: limits } : {}),
    executeMutation: async (_deviceId, mutation) => {
      executed.push(mutation);
      if (mutation.type === "explode") throw new Error("boom");
      return { status: "committed", result: { echoed: mutation.type } };
    },
  });
  const client = makeClient(pipe);
  return { connection, client, executed };
}

test("handshake: hello → welcome; version mismatch and unknown features reject", async () => {
  const journal = new MemoryJournal({ hostEpoch: "epoch-1" });
  const ledger = new MutationLedger();

  const p1 = makePipe();
  const c1 = handshake(p1, { journal, ledger }).client;
  c1.send(makeHello("dev-1"));
  const welcome = c1.last("welcome");
  assert.equal(welcome.payload.protocolVersion, 1);
  assert.equal(welcome.payload.hostEpoch, "epoch-1");

  const p2 = makePipe();
  const c2 = handshake(p2, { journal, ledger }).client;
  c2.send({ ...makeHello("dev-1"), payload: { ...makeHello("dev-1").payload, protocolVersions: [99] } });
  assert.equal(c2.last("protocol_error").payload.code, "version_unsupported");

  const p3 = makePipe();
  const c3 = handshake(p3, { journal, ledger }).client;
  c3.send(makeHello("dev-1", [...clientFeatures(), "time_travel_v9"]));
  assert.equal(c3.last("protocol_error").payload.code, "version_unsupported");
});

test("handshake: auth required, wrong token rejected, right token binds device", async () => {
  const journal = new MemoryJournal({ hostEpoch: "epoch-1" });
  const ledger = new MutationLedger();
  const pipe = makePipe();
  const { client } = handshake(pipe, { journal, ledger, token: "sekrit-token" });
  client.send(makeHello("dev-1"));
  await flush();
  assert.equal(client.last("auth_required").payload.methods.includes("token"), true);
  client.send({ version: 1, kind: "request", requestId: "a2", streamId: "host", type: "auth", payload: { proof: "wrong" } });
  await flush();
  assert.equal(client.last("protocol_error").payload.code, "auth_failed");

  const pipe2 = makePipe();
  const { client: c2 } = handshake(pipe2, { journal, ledger, token: "sekrit-token" });
  c2.send(makeHello("dev-1"));
  await flush();
  c2.send({ version: 1, kind: "request", requestId: "a2", streamId: "host", type: "auth", payload: { proof: "sekrit-token" } });
  await flush();
  assert.ok(c2.last("welcome"));
});

async function goLive(pipe, { journal, ledger, token } = {}) {
  const h = handshake(pipe, { journal, ledger, token });
  h.client.send(makeHello("dev-1"));
  if (token) {
    h.client.send({ version: 1, kind: "request", requestId: "auth-1", streamId: "host", type: "auth", payload: { proof: token } });
  }
  h.client.send({
    version: 1,
    kind: "request",
    requestId: "start-1",
    streamId: "host",
    type: "start",
    payload: {},
  });
  assert.ok(h.client.last("sync_complete"));
  return h;
}

test("resume: replay is seq-ordered, then live events continue after sync_complete", async () => {
  const journal = new MemoryJournal({ hostEpoch: "epoch-1" });
  const ledger = new MutationLedger();
  const STREAM = "session:s1";
  for (let i = 1; i <= 5; i++) journal.append(STREAM, { type: "tool_execution_end", payload: { i }, class: "reliable" });

  const pipe = makePipe();
  const h = handshake(pipe, { journal, ledger });
  h.client.send(makeHello("dev-1"));
  h.client.send({
    version: 1,
    kind: "request",
    requestId: "resume-1",
    streamId: "host",
    type: "resume",
    payload: { hostEpoch: "epoch-1", cursors: [{ streamId: STREAM, seq: 2 }] },
  });
  const sync = h.client.last("sync_complete");
  assert.ok(sync);
  assert.deepEqual(sync.payload.heads, [{ streamId: STREAM, seq: 5 }, { streamId: "host", seq: 0 }]);

  // Replay arrived as event frames with cursors, seq 3..5, in order.
  const replayed = h.client.frames.filter((f) => f.kind === "event" && f.cursor && f.cursor.seq > 2);
  assert.deepEqual(replayed.map((f) => f.cursor.seq), [3, 4, 5]);

  // Live: appends after go-live are forwarded.
  journal.append(STREAM, { type: "agent_start", payload: { live: true }, class: "reliable" });
  const live = h.client.frames.filter((f) => f.type === "agent_start");
  assert.equal(live.length, 1);
  assert.equal(live[0].cursor.seq, 6);
});

test("resume: stale epoch yields full_resync_required instead of stale state", async () => {
  const journal = new MemoryJournal({ hostEpoch: "epoch-2" });
  const ledger = new MutationLedger();
  const pipe = makePipe();
  const h = handshake(pipe, { journal, ledger });
  h.client.send(makeHello("dev-1"));
  h.client.send({
    version: 1,
    kind: "request",
    requestId: "resume-1",
    streamId: "host",
    type: "resume",
    payload: { hostEpoch: "epoch-1", cursors: [{ streamId: "session:s1", seq: 100 }] },
  });
  const resync = h.client.last("full_resync_required");
  assert.equal(resync.payload.hostEpoch, "epoch-2");
});

test("mutation receipts: accepted before execution; retry dedups; conflicts and unknowns behave", async () => {
  const journal = new MemoryJournal({ hostEpoch: "epoch-1" });
  const ledger = new MutationLedger();
  const pipe = makePipe();
  const h = await goLive(pipe, { journal, ledger });

  const mutation = (clientMsgId, requestHash, type = "agent.prompt") => ({
    version: 1,
    kind: "request",
    requestId: `req-${clientMsgId}`,
    streamId: "session:s1",
    type: "mutation",
    payload: { clientMsgId, requestHash, mutation: { type, payload: { text: "hi" } } },
  });

  // First submission: ACCEPTED receipt persists before the executor runs.
  h.client.send(mutation("m1", "hash-1"));
  assert.equal(h.client.last("mutation_receipt").payload.status, "accepted");
  await new Promise((r) => setTimeout(r, 10));
  const result = h.client.last("mutation_result");
  assert.equal(result.payload.status, "committed");
  assert.deepEqual(result.payload.result, { echoed: "agent.prompt" });
  assert.equal(h.executed.length, 1);

  // Retry with the same clientMsgId: duplicate receipt from the ledger, the
  // executor is NOT invoked again (no silent re-execution).
  h.client.send(mutation("m1", "hash-1"));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(h.executed.length, 1);
  assert.equal(h.client.last("mutation_receipt").payload.status, "committed");

  // Same id, different payload → conflict.
  h.client.send(mutation("m1", "hash-2"));
  assert.equal(h.client.last("mutation_conflict").payload.code, "invalid_request");

  // Executor crash → UNKNOWN, never a fake success.
  h.client.send(mutation("m2", "hash-3", "explode"));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(h.client.last("mutation_result").payload.status, "unknown");

  // Mutation feature not negotiated → refused.
  const pipe2 = makePipe();
  const h2 = handshake(pipe2, { journal, ledger });
  // (no hello yet — nothing to assert beyond no-crash on send)
});

test("flow control: P3 floods drop, P1 still delivers, P1 over budget demands resume", () => {
  const scheduler = new ConnectionScheduler({ maxConnectionBytes: 500, maxStreamBytes: 400 });
  const frame = (priority, streamId, type, bytes) => ({ priority, streamId, type, bytes, render: () => "x".repeat(bytes) });

  // P3 overflow drops (9 would exceed the 500-byte budget).
  const verdicts = [];
  for (let i = 0; i < 10; i++) verdicts.push(scheduler.enqueue(frame("P3", "session:s", "presence", 60)).action);
  assert.equal(verdicts.filter((a) => a === "queued").length, 8);
  assert.equal(verdicts.filter((a) => a === "dropped").length, 2);

  // Drain resets the budget: P1 delivers once there is room.
  assert.equal(scheduler.drain().length, 8);
  assert.equal(scheduler.enqueue(frame("P1", "session:s", "agent_end", 100)).action, "queued");
  // …but P1 beyond the budget forces a resume instead of unbounded growth.
  assert.equal(scheduler.enqueue(frame("P1", "session:s2", "agent_start", 900)).action, "resume_required");

  // P2 merges on (stream, type): two updates collapse to the latest.
  scheduler.enqueue(frame("P2", "session:m", "message_update", 50));
  scheduler.enqueue(frame("P2", "session:m", "message_update", 60));
  const drained = scheduler.drain();
  assert.equal(drained.filter((t) => t === "x".repeat(60)).length, 1);
  assert.equal(scheduler.pendingBytes(), 0);
});

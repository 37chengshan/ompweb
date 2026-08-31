import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { MemoryJournal } = await jiti.import("./continuity/journal.ts");
const { MutationLedger } = await jiti.import("./continuity/mutations.ts");
const { normalizeFrame, isKnownFrameType, SSE_FRAME_CLASSES } = await jiti.import("./continuity/sse-normalize.ts");
const sseFixture = JSON.parse(readFileSync(new URL("./contracts/fixtures/sse-frames.json", import.meta.url), "utf8"));

// 5.0 doc 02 Slice 1 conformance vectors (ADR-003). These are the oracle
// semantics the future persistent implementation (Rust host) must reproduce.

const EPOCH = "epoch-1";
const STREAM = "session:s1";

function makeJournal(opts = {}) {
  let tick = 0;
  return new MemoryJournal({
    hostEpoch: EPOCH,
    clock: () => ++tick,
    ...opts,
  });
}

const reliable = (type, payload) => ({ type, payload, class: "reliable" });

test("normal replay: cursor inside retained range replays seq-ordered events", () => {
  const journal = makeJournal();
  for (let i = 1; i <= 5; i++) journal.append(STREAM, reliable(`e${i}`, { i }));
  const plans = journal.resume({ hostEpoch: EPOCH, cursors: [{ streamId: STREAM, seq: 2 }] });
  assert.deepEqual(plans, [{
    kind: "REPLAY",
    streamId: STREAM,
    events: [3, 4, 5].map((seq) => journal.streamView(STREAM).find((e) => e.cursor.seq === seq)),
  }]);
});

test("no-change and protocol error boundaries", () => {
  const journal = makeJournal();
  journal.append(STREAM, reliable("e1", {}));
  const atHead = journal.resume({ hostEpoch: EPOCH, cursors: [{ streamId: STREAM, seq: 1 }] });
  assert.deepEqual(atHead.map((p) => p.kind), ["NO_CHANGE"]);
  const ahead = journal.resume({ hostEpoch: EPOCH, cursors: [{ streamId: STREAM, seq: 9 }] });
  assert.deepEqual(ahead.map((p) => p.kind), ["PROTOCOL_ERROR"]);
  assert.equal(ahead[0].headSeq, 1);
});

test("epoch mismatch forces FULL_SNAPSHOT", () => {
  const journal = makeJournal();
  journal.append(STREAM, reliable("e1", {}));
  const plans = journal.resume({ hostEpoch: "epoch-2", cursors: [{ streamId: STREAM, seq: 1 }] });
  assert.deepEqual(plans, [{ kind: "FULL_SNAPSHOT", reason: "epoch_mismatch" }]);
});

test("compact fallback: cursor behind snapshot yields SNAPSHOT_THEN_REPLAY", () => {
  const journal = makeJournal();
  for (let i = 1; i <= 10; i++) journal.append(STREAM, reliable(`e${i}`, { i }));
  journal.snapshot(STREAM, { state: "at-10" }, 3);
  for (let i = 11; i <= 15; i++) journal.append(STREAM, reliable(`e${i}`, { i }));

  const [plan] = journal.resume({ hostEpoch: EPOCH, cursors: [{ streamId: STREAM, seq: 5 }] });
  assert.equal(plan.kind, "SNAPSHOT_THEN_REPLAY");
  assert.equal(plan.snapshot.seq, 10);
  assert.deepEqual(plan.snapshot.payload, { state: "at-10" });
  assert.deepEqual(plan.events.map((e) => e.cursor.seq), [11, 12, 13, 14, 15]);
});

test("coalesced families keep only the latest committed value", () => {
  const journal = makeJournal();
  journal.append(STREAM, reliable("message_start", {}));
  for (let i = 1; i <= 3; i++) journal.append(STREAM, { type: "message_update", payload: { text: "x".repeat(i) }, class: "coalesced" });
  journal.append(STREAM, reliable("message_end", {}));
  const view = journal.streamView(STREAM);
  const updates = view.filter((e) => e.type === "message_update");
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].payload, { text: "xxx" });
});

test("live-tail merge: replay never interleaves with buffered live events", () => {
  const journal = makeJournal();
  for (let i = 1; i <= 3; i++) journal.append(STREAM, reliable(`e${i}`, { i }));
  journal.beginResume(STREAM);
  const [oldPlan] = journal.resume({ hostEpoch: EPOCH, cursors: [{ streamId: STREAM, seq: 1 }] });
  assert.deepEqual(oldPlan.events.map((e) => e.cursor.seq), [2, 3]);

  // Live events during resume buffer in the tail (ephemeral included).
  journal.append(STREAM, { type: "message_update", payload: { live: 1 }, class: "coalesced" });
  journal.append(STREAM, { type: "presence", payload: { typing: true }, class: "ephemeral" });
  journal.append(STREAM, reliable("agent_end", {}));
  assert.equal(journal.tailStats(STREAM).buffered, 3);

  const drained = journal.drainTail(STREAM);
  assert.deepEqual(drained.map((e) => e.type), ["message_update", "presence", "agent_end"]);

  // After drain, journal contains everything in seq order; ephemeral dropped.
  const view = journal.streamView(STREAM);
  assert.deepEqual(view.map((e) => e.cursor.seq), [1, 2, 3, 4, 5, 6].filter((s) => s !== 5));
  assert.equal(view.some((e) => e.type === "presence"), false);
});

test("bounded tail drops oldest and counts the loss", () => {
  const journal = makeJournal({ tailBufferMax: 3 });
  journal.beginResume(STREAM);
  for (let i = 1; i <= 5; i++) journal.append(STREAM, reliable(`e${i}`, { i }));
  const stats = journal.tailStats(STREAM);
  assert.equal(stats.buffered, 3);
  assert.equal(stats.dropped, 2);
  const drained = journal.drainTail(STREAM);
  assert.deepEqual(drained.map((e) => e.payload.i), [3, 4, 5]);
});

test("mutation ledger: accept → duplicate / conflict / unknown / retention", () => {
  const ledger = new MutationLedger({ retentionMs: 1000, clock: (() => { let t = 0; return () => ++t * 100; })() });
  const first = ledger.accept("dev1", "m1", "hash-a");
  assert.equal(first.kind, "accepted");
  assert.equal(ledger.accept("dev1", "m1", "hash-a").kind, "duplicate");
  assert.equal(ledger.accept("dev1", "m1", "hash-b").kind, "conflict");
  assert.equal(ledger.settle("dev1", "m1", "committed", { ok: 1 }).status, "committed");

  ledger.accept("dev1", "m2", "hash-x");
  ledger.settle("dev1", "m2", "unknown");
  // Crash ambiguity: same payload may be re-accepted after reconciliation.
  assert.equal(ledger.reacceptUnknown("dev1", "m2", "hash-x").kind, "accepted");
  // Different payload on an unknown record is a conflict, never a re-run.
  assert.equal(ledger.reacceptUnknown("dev1", "m2", "hash-z").kind, "conflict");

  // Retention expiry: aged keys refuse instead of executing as new.
  ledger.accept("dev1", "m3", "hash-c");
  ledger.expire(2000);
  assert.equal(ledger.accept("dev1", "m4", "hash-d").kind, "accepted");
  const stale = ledger.queryForRetry("dev1", "m3", "hash-c");
  assert.equal(stale.kind, "retention_expired");
});

test("every frozen SSE frame type has an explicit continuity class", () => {
  const transport = new Set(["connected", "session_destroyed"]);
  for (const frame of sseFixture.frames) {
    if (transport.has(frame.type)) continue;
    assert.ok(
      isKnownFrameType(frame.type),
      `frame type ${frame.type} is handled by the chat client but missing from SSE_FRAME_CLASSES`,
    );
    assert.ok(["reliable", "coalesced", "ephemeral"].includes(SSE_FRAME_CLASSES[frame.type]));
  }
});

test("unknown frame types degrade to safe ephemeral telemetry", () => {
  const event = normalizeFrame({ type: "future_frame", x: 1 }, { hostEpoch: EPOCH, streamId: STREAM, seq: 1 });
  assert.equal(event.class, "ephemeral");
  assert.equal(event.unknownType, true);
  const known = normalizeFrame({ type: "agent_end" }, { hostEpoch: EPOCH, streamId: STREAM, seq: 2 });
  assert.equal(known.class, "reliable");
  assert.equal(known.unknownType, undefined);
});

// ---------------------------------------------------------------------------
// Language-neutral conformance script (doc 06 slice 1): the SAME script runs
// against the Rust port in crates/ompweb-protocol/tests/conformance.rs.
// ---------------------------------------------------------------------------

const scriptText = readFileSync(new URL("./continuity/conformance-script.txt", import.meta.url), "utf8");

function runConformanceScript(text) {
  let journal = makeJournal();
  let ledger = new MutationLedger({ retentionMs: 1000, clock: (() => { let t = 0; return () => ++t * 100; })() });
  const failures = [];
  let scenarioName = "";
  let pendingPlans = null;
  const seqsOf = (plan) => plan.events?.map((e) => e.cursor.seq) ?? [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const [op, ...args] = line.split(/\s+/);
    try {
      if (op === "scenario") {
        scenarioName = args[0];
        // Each scenario starts from a pristine oracle instance.
        journal = makeJournal();
        ledger = new MutationLedger({ retentionMs: 1000, clock: (() => { let t = 0; return () => ++t * 100; })() });
        pendingPlans = null;
      } else if (op === "append") {
        const [stream, type, cls, payload] = args;
        journal.append(stream, { type, payload: { token: payload }, class: cls });
      } else if (op === "snapshot") {
        journal.snapshot(args[0], { compacted: true }, Number(args[1]));
      } else if (op === "tail_max") {
        journal.setTailMax(Number(args[0]));
      } else if (op === "begin_resume") {
        journal.beginResume(args[0]);
      } else if (op === "drain_tail") {
        journal.drainTail(args[0]);
      } else if (op === "resume") {
        const clientEpoch = args[0];
        const cursors = args[1].split(",").map((pair) => {
          // Stream ids contain colons (session:<id>) — split from the right.
          const i = pair.lastIndexOf(":");
          return { streamId: pair.slice(0, i), seq: Number(pair.slice(i + 1)) };
        });
        pendingPlans = journal.resume({ hostEpoch: clientEpoch, cursors });
      } else if (op === "expect_plan") {
        const [kind, stream, seqList] = args;
        const plan = pendingPlans?.find((p) => p.kind === kind && ("streamId" in p ? p.streamId === stream : stream === "-"));
        assert.ok(plan, `${scenarioName}: expected plan ${kind} for ${stream}, got ${JSON.stringify(pendingPlans?.map((p) => p.kind))}`);
        if (seqList && seqList !== "-") {
          assert.deepEqual(
            seqsOf(plan),
            seqList.split(",").map(Number),
            `${scenarioName}: ${kind} replay seqs`,
          );
        }
      } else if (op === "view") {
        const [stream, seqList] = args;
        assert.deepEqual(
          journal.streamView(stream).map((e) => e.cursor.seq),
          seqList.split(",").map(Number),
          `${scenarioName}: view for ${stream}`,
        );
      } else if (op === "accept") {
        const [device, msgId, hash, expected] = args;
        assert.equal(ledger.accept(device, msgId, hash).kind, expected, `${scenarioName}: accept ${msgId}`);
      } else if (op === "settle") {
        const [device, msgId, status] = args;
        ledger.settle(device, msgId, status);
      } else if (op === "reaccept") {
        const [device, msgId, hash, expected] = args;
        assert.equal(ledger.reacceptUnknown(device, msgId, hash).kind, expected, `${scenarioName}: reaccept ${msgId}`);
      } else if (op === "expire") {
        ledger.expire(Number(args[0]));
      } else {
        throw new Error(`Unknown conformance op: ${op}`);
      }
    } catch (error) {
      failures.push(`[${scenarioName || "?"} / ${line}] ${error.message}`);
    }
  }
  return failures;
}

test("shared conformance script passes on the TypeScript oracle", () => {
  const failures = runConformanceScript(scriptText);
  assert.deepEqual(failures, []);
});

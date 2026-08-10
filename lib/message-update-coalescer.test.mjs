import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
  return import("./message-update-coalescer.ts");
}

/** Manual scheduler: collects flush callbacks so tests control flush timing. */
function manualScheduler() {
  const scheduled = [];
  let cancelled = 0;
  const schedule = (flush) => {
    const entry = { flush, cancelled: false };
    scheduled.push(entry);
    return () => {
      entry.cancelled = true;
      cancelled += 1;
    };
  };
  const fire = () => {
    for (const entry of scheduled.splice(0)) {
      if (!entry.cancelled) entry.flush();
    }
  };
  return { schedule, fire, get cancelledCount() { return cancelled; } };
}

test("buffers message_update and dispatches only the latest on flush", async () => {
  const { createMessageUpdateCoalescer } = await loadSubject();
  const dispatched = [];
  const scheduler = manualScheduler();
  const coalescer = createMessageUpdateCoalescer((e) => dispatched.push(e), scheduler.schedule);

  coalescer.push({ type: "message_update", seq: 1 });
  coalescer.push({ type: "message_update", seq: 2 });
  coalescer.push({ type: "message_update", seq: 3 });
  assert.equal(dispatched.length, 0);

  scheduler.fire();
  assert.deepEqual(dispatched, [{ type: "message_update", seq: 3 }]);
});

test("flushes the pending update before any other event type", async () => {
  const { createMessageUpdateCoalescer } = await loadSubject();
  const dispatched = [];
  const scheduler = manualScheduler();
  const coalescer = createMessageUpdateCoalescer((e) => dispatched.push(e), scheduler.schedule);

  coalescer.push({ type: "message_update", seq: 1 });
  coalescer.push({ type: "tool_execution_start", toolCallId: "t1" });
  assert.deepEqual(dispatched.map((e) => e.type), ["message_update", "tool_execution_start"]);
  assert.equal(dispatched[0].seq, 1);

  // The already-scheduled flush must not re-dispatch the flushed update.
  scheduler.fire();
  assert.equal(dispatched.length, 2);
});

test("message_end supersedes the pending update", async () => {
  const { createMessageUpdateCoalescer } = await loadSubject();
  const dispatched = [];
  const scheduler = manualScheduler();
  const coalescer = createMessageUpdateCoalescer((e) => dispatched.push(e), scheduler.schedule);

  coalescer.push({ type: "message_update", seq: 1 });
  coalescer.push({ type: "message_end", seq: 2 });
  assert.deepEqual(dispatched.map((e) => e.type), ["message_end"]);

  scheduler.fire();
  assert.equal(dispatched.length, 1);
});

test("continues coalescing after a flush", async () => {
  const { createMessageUpdateCoalescer } = await loadSubject();
  const dispatched = [];
  const scheduler = manualScheduler();
  const coalescer = createMessageUpdateCoalescer((e) => dispatched.push(e), scheduler.schedule);

  coalescer.push({ type: "message_update", seq: 1 });
  scheduler.fire();
  coalescer.push({ type: "message_update", seq: 2 });
  scheduler.fire();
  assert.deepEqual(dispatched.map((e) => e.seq), [1, 2]);
});

test("non-update events pass through immediately when nothing is pending", async () => {
  const { createMessageUpdateCoalescer } = await loadSubject();
  const dispatched = [];
  const scheduler = manualScheduler();
  const coalescer = createMessageUpdateCoalescer((e) => dispatched.push(e), scheduler.schedule);

  coalescer.push({ type: "agent_start" });
  coalescer.push({ type: "notice", message: "hi" });
  assert.deepEqual(dispatched.map((e) => e.type), ["agent_start", "notice"]);
});

test("reset drops the pending update and cancels the scheduled flush", async () => {
  const { createMessageUpdateCoalescer } = await loadSubject();
  const dispatched = [];
  const scheduler = manualScheduler();
  const coalescer = createMessageUpdateCoalescer((e) => dispatched.push(e), scheduler.schedule);

  coalescer.push({ type: "message_update", seq: 1 });
  coalescer.reset();
  scheduler.fire();
  assert.equal(dispatched.length, 0);
  assert.equal(scheduler.cancelledCount, 1);
});

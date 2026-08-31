import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createRelaySimulator } = await jiti.import("./relay/simulator.ts");

// 5.0 doc 04 C1 slice 1: routing, quotas, rate shedding and fault injection
// for a payload-confidential blind relay — frames stay opaque bytes end to
// end, and every fault is deterministic through the injected rng/clock.

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function makeCollector() {
  const seen = [];
  return {
    sink: (frame) => seen.push(frame),
    seen,
  };
}

test("routing: client frames reach exactly their host; host frames fan out to clients", () => {
  const relay = createRelaySimulator();
  const hostA = makeCollector();
  const hostB = makeCollector();
  const clientA1 = makeCollector();
  const clientA2 = makeCollector();
  const clientB1 = makeCollector();
  const ha = relay.registerHost("host-a", hostA.sink);
  const hb = relay.registerHost("host-b", hostB.sink);
  const ca1 = relay.connectClient("host-a", clientA1.sink);
  relay.connectClient("host-a", clientA2.sink);
  const cb1 = relay.connectClient("host-b", clientB1.sink);

  // Client → host: only host-a receives.
  ca1.send("frame-from-a1");
  assert.deepEqual(hostA.seen, ["frame-from-a1"]);
  assert.deepEqual(hostB.seen, []);

  // Host → clients: fan-out to every attached client of that host.
  ha.send("push-a");
  hb.send("push-b");
  assert.deepEqual(clientA1.seen, ["push-a"]);
  assert.deepEqual(clientA2.seen, ["push-a"]);
  assert.deepEqual(clientB1.seen, ["push-b"]);
  assert.deepEqual(hostA.seen, ["frame-from-a1"]);
});

test("opaque transport: arbitrary bytes are relayed byte-identically", () => {
  const relay = createRelaySimulator();
  const host = makeCollector();
  const client = makeCollector();
  relay.registerHost("h", host.sink);
  const ep = relay.connectClient("h", client.sink);
  const garbage = "raw\0bytes\xff\xfe not json at all 🔥";
  ep.send(garbage);
  assert.deepEqual(host.seen, [garbage], "the relay must not transform opaque frames");
});

test("quota: a connection over its byte budget is closed, others keep flowing", () => {
  const relay = createRelaySimulator({ maxBytesPerConnection: 100 });
  const host = makeCollector();
  const clientA = makeCollector();
  const clientB = makeCollector();
  relay.registerHost("h", host.sink);
  const epA = relay.connectClient("h", clientA.sink);
  const epB = relay.connectClient("h", clientB.sink);

  epA.send("x".repeat(60));
  assert.deepEqual(host.seen, ["x".repeat(60)]);
  epA.send("x".repeat(60)); // 120 > 100 → the connection is closed
  epB.send("y".repeat(10));

  assert.equal(epA.closed, true);
  assert.equal(epA.closeReason, "quota_exceeded");
  assert.equal(epB.closed, false);
  // The first frame was delivered before the quota hit; the second was shed.
  assert.deepEqual(host.seen, ["x".repeat(60), "y".repeat(10)]);
});

test("rate shedding: frames beyond the per-window budget are dropped", () => {
  let tick = 0;
  const relay = createRelaySimulator({ maxFramesPerSecond: 5 }, { now: () => tick });
  const host = makeCollector();
  const client = makeCollector();
  relay.registerHost("h", host.sink);
  const ep = relay.connectClient("h", client.sink);

  for (let i = 0; i < 8; i++) ep.send(`f${i}`);
  assert.equal(host.seen.length, 5, "5 frames fit the first window");
  tick += 1500; // new window
  ep.send("f8");
  assert.equal(host.seen.length, 6);
  assert.equal(relay.stats().framesDropped, 3);
});

test("faults: deterministic drop, reorder and delayed delivery", () => {
  // drop: seeded rng — every frame whose rng() < 0.5 dies.
  const dropRelay = createRelaySimulator({ dropRate: 0.5 }, { rng: lcg(7) });
  const dropHost = makeCollector();
  const dropClient = makeCollector();
  dropRelay.registerHost("h", dropHost.sink);
  const dropEp = dropRelay.connectClient("h", dropClient.sink);
  for (let i = 0; i < 10; i++) dropEp.send(`d${i}`);
  assert.equal(dropRelay.stats().framesDropped, 5, "seeded rng drops exactly half of 10");
  assert.equal(dropHost.seen.length, 5, "survivors still reach the host, byte-identical");
  assert.equal(dropClient.seen.length, 0);

  // delay + reorder: frames held until advance(), then pair-swapped.
  const reorderRelay = createRelaySimulator({ delayMs: 50, reorderProbability: 1 }, { rng: () => 0.9, now: () => 0 });
  const seen = makeCollector();
  reorderRelay.registerHost("h", seen.sink);
  const ep = reorderRelay.connectClient("h", makeCollector().sink);
  ep.send("one");
  ep.send("two");
  ep.send("three");
  assert.deepEqual(seen.seen, [], "delayed frames are not delivered synchronously");
  reorderRelay.advance(100);
  // rng() = 0.9 < probability 1 → every adjacent pair swaps: one,swaps.
  assert.deepEqual(seen.seen, ["two", "three", "one"], "adjacent pairs swapped by the reorder fault");
});

test("abuse gate: unknown hosts and duplicate registrations are rejected", () => {
  const relay = createRelaySimulator();
  assert.throws(() => relay.connectClient("ghost", () => {}));
  const host = makeCollector();
  relay.registerHost("h", host.sink);
  assert.throws(() => relay.registerHost("h", host.sink));
  assert.equal(relay.stats().connectionsRejected, 2);
});

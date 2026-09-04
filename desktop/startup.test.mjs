import assert from "node:assert/strict";
import test from "node:test";
import { StartupTracker, createHealthProbe } from "./startup.js";

// ---------------------------------------------------------------------------
// StartupTracker: ordering, timing, terminal failure (doc 14 T1.3/T1.4)
// ---------------------------------------------------------------------------

test("tracker advances in order and stamps monotonic timestamps", () => {
  let t = 0;
  const lines = [];
  const tr = new StartupTracker({ now: () => t, log: (l) => lines.push(l) });
  assert.equal(tr.state, "spawning");
  t = 10;
  tr.record("listening");
  t = 25;
  tr.record("assets_warmed");
  t = 40;
  tr.record("shell_mounted");
  t = 55;
  tr.record("session_interactive");
  assert.equal(tr.state, "session_interactive");
  assert.equal(tr.failure, null);
  const r = tr.report();
  assert.deepEqual(r.timestamps, { spawning: 0, listening: 10, assets_warmed: 25, shell_mounted: 40, session_interactive: 55 });
  assert.equal(lines.length, 5);
  assert.match(lines[1], /startup\[\+10ms\] listening/);
});

test("tracker refuses backwards movement and unknown stages", () => {
  const tr = new StartupTracker();
  tr.record("listening");
  assert.throws(() => tr.record("spawning"), /regressed/);
  assert.throws(() => tr.record("bogus"), /unknown/);
});

test("failed is terminal and captures reason from any state", () => {
  const tr = new StartupTracker();
  tr.record("listening");
  tr.fail("server-timeout", { detail: "http-500", attempts: 60 });
  assert.equal(tr.state, "failed");
  assert.equal(tr.failure.reason, "server-timeout");
  assert.throws(() => tr.record("shell_mounted"), /already failed/);
  const r = tr.report();
  assert.equal(r.failure.reason, "server-timeout");
  assert.ok(r.timestamps.failed >= r.timestamps.listening);
});

// ---------------------------------------------------------------------------
// HealthProbe: readiness only when health endpoint answers with the version
// ---------------------------------------------------------------------------

function stubFetch(handler) {
  return async (url, opts = {}) => {
    const result = await handler(url, opts);
    if (result === "abort") {
      await new Promise((_, reject) => {
        opts.signal?.addEventListener("abort", () => reject(new Error("AbortError")));
        opts.signal?.dispatchEvent(new Event("abort"));
      });
    }
    if (result instanceof Error) throw result;
    return {
      ok: result.ok,
      status: result.status,
      json: async () => result.body,
    };
  };
}

test("fast server: ready on the first probe, no retries", async () => {
  let calls = 0;
  const probe = createHealthProbe({
    appUrl: "http://127.0.0.1:9999",
    expectedAppVersion: "5.0.0",
    fetchFn: stubFetch(async (url) => {
      calls += 1;
      assert.match(url, /\/api\/health$/);
      return { ok: true, status: 200, body: { ok: true, app: "5.0.0", ompReady: true, ompVersion: "18.0.10" } };
    }),
    maxAttempts: 3,
    backoffMs: 1,
  });
  const r = await probe.wait();
  assert.equal(r.ready, true);
  assert.equal(r.attempt, 1);
  assert.equal(r.ompVersion, "18.0.10");
  assert.equal(calls, 1);
});

test("slow server: retries until healthy, reports attempt count", async () => {
  let calls = 0;
  const probe = createHealthProbe({
    appUrl: "http://127.0.0.1:9999",
    expectedAppVersion: "5.0.0",
    fetchFn: stubFetch(async () => {
      calls += 1;
      if (calls < 3) return { ok: false, status: 503, body: {} };
      return { ok: true, status: 200, body: { ok: true, app: "5.0.0" } };
    }),
    maxAttempts: 5,
    backoffMs: 1,
  });
  const r = await probe.wait();
  assert.equal(r.ready, true);
  assert.equal(r.attempt, 3);
});


test("any HTTP status (404/500) is NOT ready", async () => {
  for (const status of [404, 500, 200]) {
    const probe = createHealthProbe({
      appUrl: "http://127.0.0.1:9999",
      expectedAppVersion: "5.0.0",
      fetchFn: stubFetch(async () => {
        if (status === 200) return { ok: true, status: 200, body: { ok: false } };
        return { ok: status < 400, status, body: {} };
      }),
      maxAttempts: 1,
      backoffMs: 1,
    });
    const r = await probe.wait();
    assert.equal(r.ready, false);
    assert.equal(r.reason, status === 200 ? "health-not-ok" : `http-${status}`);
  }
});


test("version mismatch stays not-ready (doc 14 S-4 target)", async () => {
  const probe = createHealthProbe({
    appUrl: "http://127.0.0.1:9999",
      expectedAppVersion: "5.0.0",
    fetchFn: stubFetch(async () => ({ ok: true, status: 200, body: { ok: true, app: "3.9.0" } })),
    maxAttempts: 1,
  });
  const r = await probe.wait();
  assert.equal(r.ready, false);
  assert.equal(r.reason, "version-mismatch");
  assert.equal(r.got, "3.9.0");
});

test("unreachable server aborts per-attempt and exhausts with server-timeout", async () => {
  const probe = createHealthProbe({
    appUrl: "http://127.0.0.1:9999",
      expectedAppVersion: "5.0.0",
    fetchFn: stubFetch(async () => { throw new Error("ECONNREFUSED"); }),
    maxAttempts: 3,
    backoffMs: 1,
    timeoutMs: 5,
  });
  const seen = [];
  const r = await probe.wait({ onAttempt: (x) => seen.push(x.reason) });
  assert.equal(r.ready, false);
  assert.equal(r.reason, "unreachable");
  assert.equal(r.attempt, 3);
  assert.deepEqual(seen, ["unreachable", "unreachable", "unreachable"]);
});

test("aborting fetch mid-attempt counts as unreachable, not stuck", async () => {
  const probe = createHealthProbe({
    appUrl: "http://127.0.0.1:9999",
      expectedAppVersion: "5.0.0",
    fetchFn: stubFetch(async () => "abort"),
    maxAttempts: 2,
    backoffMs: 1,
    timeoutMs: 5,
  });
  const r = await probe.wait();
  assert.equal(r.ready, false);
  assert.equal(r.reason, "unreachable");
});

test("onFail fires once when attempts are exhausted", async () => {
  let fails = 0;
  const probe = createHealthProbe({
    appUrl: "http://127.0.0.1:9999",
      expectedAppVersion: "5.0.0",
    fetchFn: stubFetch(async () => ({ ok: false, status: 500, body: {} })),
    maxAttempts: 2,
    backoffMs: 1,
  });
  await probe.wait({ onFail: () => { fails += 1; } });
  assert.equal(fails, 1);
});

test("assets_warmed races listening (splash warm-up may beat the health probe)", () => {
  let t = 0;
  const clock = () => t;
  const tr = new StartupTracker({ now: clock, log: () => {} });
  // Splash path: the server answers warmUp's plain fetch before the health
  // probe succeeds (cold standalone + first omp probe).
  t = 5; tr.record("assets_warmed");
  t = 9; tr.record("listening");
  t = 12; tr.record("shell_mounted");
  t = 15; tr.record("session_interactive");
  assert.equal(tr.state, "session_interactive");
  const r = tr.report();
  assert.ok(r.timestamps.assets_warmed < r.timestamps.listening);
  // Reverse order (slow splash) must also work.
  const tr2 = new StartupTracker({ now: clock, log: () => {} });
  t = 5; tr2.record("listening");
  t = 9; tr2.record("assets_warmed");
  t = 12; tr2.record("shell_mounted");
  t = 15; tr2.record("session_interactive");
  assert.equal(tr2.state, "session_interactive");
});

test("assets_warmed cannot re-enter after shell_mounted", () => {
  const tr = new StartupTracker({ log: () => {} });
  tr.record("listening");
  tr.record("shell_mounted");
  assert.throws(() => tr.record("assets_warmed"), /regressed/);
});

test("the five-stage happy path + failed timeline fits the review contract", () => {
  // Simulates the full T1.3 timeline with a real clock.
  const tr = new StartupTracker({ log: () => {} });
  tr.record("listening");
  tr.record("assets_warmed");
  tr.record("shell_mounted");
  tr.record("session_interactive");
  const r = tr.report();
  assert.equal(r.state, "session_interactive");
  assert.equal(Object.keys(r.timestamps).length, 5);
  // Every stage must appear exactly once, in order.
  assert.deepEqual(Object.keys(r.timestamps), ["spawning", "listening", "assets_warmed", "shell_mounted", "session_interactive"]);
});

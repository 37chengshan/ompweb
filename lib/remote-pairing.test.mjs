import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { PairingService, deviceNameFromUserAgent, isRemoteRequest, DEFAULT_IDLE_EXPIRE_MS } = await jiti.import("./remote-pairing.ts");

function makeStore(initialNow = 1_000_000) {
  let now = initialNow;
  let serial = 0;
  return {
    now: () => now,
    advance(ms) { now += ms; },
    randomToken: () => `tok${String(serial++).padStart(8, "0")}`,
  };
}

test("issue() replaces the previous token; the old one is refused", () => {
  const store = makeStore();
  const service = new PairingService({}, store);
  const first = service.issue();
  const second = service.issue();
  assert.notEqual(first.token, second.token);
  assert.equal(service.accept(first.token, null, false), null, "old token must be invalidated");
  assert.ok(service.accept(second.token, null, false));
});

test("a token is single-use and expires", () => {
  const store = makeStore();
  const service = new PairingService({ tokenTtlMs: 1000 }, store);
  const { token } = service.issue();
  assert.ok(service.accept(token, null, false), "first accept succeeds");
  assert.equal(service.accept(token, null, false), null, "reuse refused");
  const service2 = new PairingService({ tokenTtlMs: 1000 }, store);
  const { token: t2 } = service2.issue();
  store.advance(2000);
  assert.equal(service2.accept(t2, null, false), null, "expired token refused");
});

test("max-device cap evicts the oldest session", () => {
  const store = makeStore();
  const service = new PairingService({ maxDevices: 2 }, store);
  const { token: t1 } = service.issue();
  const d1 = service.accept(t1, "Mozilla/5.0 (Windows NT 10.0)", false);
  const { token: t2 } = service.issue();
  const d2 = service.accept(t2, "Mozilla/5.0 (Macintosh)", false);
  const { token: t3 } = service.issue();
  const d3 = service.accept(t3, "Mozilla/5.0 (X11; Linux)", false);
  assert.ok(d1 && d2 && d3);
  assert.equal(service.getDevice(d1.id), null, "oldest device evicted");
  assert.ok(service.getDevice(d2.id));
  assert.ok(service.getDevice(d3.id));
});

test("offline detection follows the heartbeat window", () => {
  const store = makeStore();
  const service = new PairingService({ offlineAfterMs: 25_000 }, store);
  const { token } = service.issue();
  const device = service.accept(token, null, false);
  assert.ok(device);
  assert.equal(service.isOnline(device), true);
  store.advance(30_000);
  assert.equal(service.isOnline(service.getDevice(device.id)), false);
  store.advance(1);
  assert.equal(service.touch(device.id), true);
  assert.equal(service.isOnline(service.getDevice(device.id)), true);
});

test("idle expiry deletes stale sessions on read", () => {
  const store = makeStore();
  const service = new PairingService({ idleExpireMs: 1000 }, store);
  const { token } = service.issue();
  const device = service.accept(token, null, false);
  assert.ok(device);
  store.advance(5000);
  assert.equal(service.getDevice(device.id), null, "idle device expired");
});

test("stop() revokes everything and clears the token", () => {
  const store = makeStore();
  const service = new PairingService({}, store);
  const { token } = service.issue();
  assert.ok(service.accept(token, null, false));
  service.stop();
  assert.equal(service.listDevices().length, 0);
  assert.equal(service.activeToken(), null);
  const { token: t2 } = service.issue();
  assert.ok(service.accept(t2, null, false), "after stop a fresh token still pairs");
});

test("device names are inferred from the UA, never raw", () => {
  assert.equal(deviceNameFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", false), "Windows PC");
  assert.equal(deviceNameFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", true), "Phone");
  assert.equal(deviceNameFromUserAgent(null, false), "Paired device");
});

test("persistence round-trips an active token and devices atomically", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "omp-pairing-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "pairing.json");
  const store = makeStore();
  const service = new PairingService({}, store, file);
  const { token } = service.issue();

  // Unconsumed token survives a reload.
  const reloaded = new PairingService({}, store, file);
  assert.equal(reloaded.activeToken()?.value, token);

  // Devices survive too, after the token is consumed.
  const device = reloaded.accept(token, "Mozilla/5.0 (Macintosh)", false);
  assert.ok(device);
  const reloaded2 = new PairingService({}, store, file);
  assert.equal(reloaded2.activeToken(), null, "consumed token must not persist");
  assert.equal(reloaded2.getDevice(device.id)?.name, "Mac");
});

test("isRemoteRequest distinguishes loopback from LAN/public hosts", () => {
  assert.equal(isRemoteRequest("127.0.0.1"), false);
  assert.equal(isRemoteRequest("localhost:30178"), false);
  assert.equal(isRemoteRequest("192.168.1.5:30178"), true);
  assert.equal(isRemoteRequest("omp.example.com"), true);
  assert.equal(isRemoteRequest(null), false);
});

test("DEFAULT_IDLE_EXPIRE_MS is seven days", () => {
  assert.equal(DEFAULT_IDLE_EXPIRE_MS, 7 * 24 * 60 * 60 * 1000);
});

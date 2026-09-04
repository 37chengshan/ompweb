import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { healthOf, shouldAutoFix } = await jiti.import("./BackendDiagnostics.tsx");

const base = {
  server: { node: "v24", platform: "darwin", arch: "arm64", uptimeSeconds: 10 },
  omp: { installed: true, path: "/usr/bin/omp", version: "18.0.10" },
  proxy: { config: { mode: "auto" }, effective: "http://127.0.0.1:7890" },
  rpc: { activeSessions: 1 },
  web: { port: "30179", url: "http://127.0.0.1:30179" },
};

test("healthOf: everything green reports ok", () => {
  assert.equal(healthOf(base), "ok");
});

test("healthOf: missing omp binary reports error", () => {
  assert.equal(healthOf({ ...base, omp: { installed: false, path: null, version: null } }), "error");
});

test("healthOf: auto proxy without an effective endpoint warns", () => {
  assert.equal(healthOf({ ...base, proxy: { config: { mode: "auto" }, effective: null } }), "warn");
});

test("healthOf: unavailable rust host binary in rust mode reports error", () => {
  assert.equal(healthOf({ ...base, rustHost: { mode: "workspace", path: "/missing/ompweb-host", available: false } }), "error");
  // Explicit node rollback mode has no rust host — that must not read as error.
  assert.equal(healthOf({ ...base, rustHost: { mode: "node", path: "", available: false } }), "ok");
  // Older payload without the field stays ok.
  assert.equal(healthOf({ ...base }), "ok");
});

test("healthOf: host unavailable/crash in the backend error ring reports error", () => {
  assert.equal(healthOf({ ...base, backendErrors: [{ at: 1, kind: "host_unavailable", detail: "x" }] }), "error");
  assert.equal(healthOf({ ...base, backendErrors: [{ at: 1, kind: "host_crash", detail: "x" }] }), "error");
});

test("healthOf: session-domain failures warn once and error from two", () => {
  const scan = { at: 1, kind: "session_scan_failed", detail: "x" };
  assert.equal(healthOf({ ...base, backendErrors: [scan] }), "warn");
  assert.equal(healthOf({ ...base, backendErrors: [scan, scan] }), "error");
});

test("shouldAutoFix: cooldown gates repeated auto-repair", () => {
  const now = 1_000_000;
  // 从未尝试过（0）→ 允许。
  assert.equal(shouldAutoFix(0, now), true);
  // 刚修过（<5min）→ 禁止（防抖动循环）。
  assert.equal(shouldAutoFix(now - 60_000, now), false);
  // 冷却期已过（≥5min）→ 允许。
  assert.equal(shouldAutoFix(now - 5 * 60_000, now), true);
});

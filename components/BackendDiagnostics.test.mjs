import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { healthOf } = await jiti.import("./BackendDiagnostics.tsx");

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

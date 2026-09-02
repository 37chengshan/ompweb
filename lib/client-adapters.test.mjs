// Route 1 (doc 16): the client adapter contract — React chooses the
// transport by kind through the single factory; unlanded kinds fail closed
// with a deterministic error naming the pending route.
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { AdapterUnavailableError, createOmpwebClient } = await jiti.import("./client/adapters.ts");

test("route 1: legacy-http kind returns the full client surface", () => {
  const client = createOmpwebClient("legacy-http");
  assert.equal(typeof client.agent.sendCommand, "function");
  assert.equal(typeof client.agent.subscribeSessionEvents, "function");
  assert.equal(typeof client.agent.subscribeRunningSessions, "function");
  assert.equal(typeof client.sessions.list, "function");
  assert.equal(typeof client.sessions.getContext, "function");
  assert.equal(typeof client.sessions.rename, "function");
  assert.equal(typeof client.sessions.archive, "function");
  assert.equal(typeof client.sessions.delete, "function");
  assert.equal(typeof client.system.subscribeSessionsChanged, "function");
});

test("route 1: tauri-core kind fails closed until route 18 lands", () => {
  assert.throws(() => createOmpwebClient("tauri-core"), (error) => {
    assert.ok(error instanceof AdapterUnavailableError);
    assert.equal(error.code, "client_runtime_unavailable");
    assert.match(error.message, /路线 18/);
    return true;
  });
});

test("route 1: remote kind fails closed until routes 14/20 land", () => {
  assert.throws(() => createOmpwebClient("remote"), (error) => {
    assert.ok(error instanceof AdapterUnavailableError);
    assert.equal(error.code, "client_runtime_unavailable");
    assert.match(error.message, /路线 14\/20/);
    return true;
  });
});

test("route 1: unknown kinds are rejected, not silently mapped", () => {
  assert.throws(() => createOmpwebClient("electron-native"), /unknown client adapter kind/);
});

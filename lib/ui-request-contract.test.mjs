import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const ui = await jiti.import("./contracts/ui-request.ts");

// 5.0 doc 08: HostUIRequest lifecycle — one terminal outcome wins, method-
// shaped responses are validated, expiry beats a late answer.

function makeRequest(overrides = {}) {
  return { id: "r1", method: "confirm", title: "Run?", message: "sure?", ...overrides };
}

test("a user response settles the request exactly once", () => {
  let state = { request: makeRequest(), outcome: null };
  state = ui.settleUiRequest(state, { status: "resolved", response: { confirmed: true } }, 0);
  assert.deepEqual(state.outcome, { status: "resolved", response: { confirmed: true } });
  // Every later settle (cancel, disconnect, duplicate answer) is a no-op.
  state = ui.settleUiRequest(state, { status: "cancelled" }, 1);
  state = ui.settleUiRequest(state, { status: "disconnected" }, 2);
  state = ui.settleUiRequest(state, { status: "resolved", response: { confirmed: false } }, 3);
  assert.deepEqual(state.outcome, { status: "resolved", response: { confirmed: true } });
});

test("expiry beats a late answer", () => {
  let state = { request: makeRequest({ expiresAt: 1000 }), outcome: null };
  state = ui.expireOverdue(state, 2000);
  assert.deepEqual(state.outcome, { status: "expired" });
  state = ui.settleUiRequest(state, { status: "resolved", response: { confirmed: true } }, 3000);
  assert.deepEqual(state.outcome, { status: "expired" });
});

test("a deadline inside the settle window expires the answer", () => {
  let state = { request: makeRequest({ expiresAt: 1000 }), outcome: null };
  state = ui.settleUiRequest(state, { status: "resolved", response: { confirmed: true } }, 1500);
  assert.deepEqual(state.outcome, { status: "expired" });
});

test("cancel and disconnect are terminal", () => {
  let cancel = { request: makeRequest(), outcome: null };
  cancel = ui.settleUiRequest(cancel, { status: "cancelled" }, 0);
  assert.deepEqual(cancel.outcome, { status: "cancelled" });

  let drop = { request: makeRequest(), outcome: null };
  drop = ui.settleUiRequest(drop, { status: "disconnected" }, 0);
  assert.deepEqual(drop.outcome, { status: "disconnected" });
});

test("method-shaped validation: select values must come from the options", () => {
  const request = { id: "s1", method: "select", title: "Pick", options: ["a", "b"] };
  let state = { request, outcome: null };
  state = ui.settleUiRequest(state, { status: "resolved", response: { value: "not-an-option" } }, 0);
  assert.equal(state.outcome, null, "bogus select value must not settle");
  state = ui.settleUiRequest(state, { status: "resolved", response: { value: "b" } }, 0);
  assert.equal(state.outcome.status, "resolved");

  // confirm requests refuse string values; input requests refuse booleans.
  let confirmState = ui.settleUiRequest({ request: makeRequest(), outcome: null }, { status: "resolved", response: { value: "x" } }, 0);
  assert.equal(confirmState.outcome, null);
  let inputState = ui.settleUiRequest({ request: makeRequest({ method: "input" }), outcome: null }, { status: "resolved", response: { confirmed: true } }, 0);
  assert.equal(inputState.outcome, null);
});

test("the chat hook wires extension_ui_request methods through the contract shape", () => {
  const src = readFileSync(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  for (const method of ["select", "confirm", "input", "editor"]) {
    assert.ok(src.includes(`case "${method}"`), `hook must handle ${method}`);
  }
  assert.match(src, /extension_ui_request/);
});

test("the execution matrix doc covers the client commands and OMP RPC paths", () => {
  const matrix = readFileSync(new URL("../docs/refactor/ompweb-5.0/command-execution-matrix.md", import.meta.url), "utf8");
  for (const name of ["compact", "reload", "name", "session", "copy", "model", "thinking", "tools"]) {
    assert.ok(matrix.includes(name), `matrix missing client command ${name}`);
  }
  for (const label of ["structured_rpc", "client_action", "prompt_local", "tui_only"]) {
    assert.ok(matrix.includes(label), `matrix missing execution class ${label}`);
  }
});

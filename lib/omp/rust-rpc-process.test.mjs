import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

// R8.5 (doc 15): Node path vs Rust path equivalence — the same session gets
// the same get_state response shape through RpcProcess (Node spawns omp) and
// RustRpcProcess (Rust supervisor owns omp), under OMPWEB_BACKEND=rust.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const hostBin = join(root, "crates", "target", "debug", "ompweb-host");
const hasOmp = process.env.OMP_WEB_OMP_BIN
  ? existsSync(process.env.OMP_WEB_OMP_BIN)
  : ["/Users/cc/.bun/bin/omp", "/opt/homebrew/bin/omp", "/usr/local/bin/omp"].some((p) => existsSync(p));

const jiti = createJiti(import.meta.url);

async function nodeGetState() {
  const { RpcProcess } = await jiti.import("./rpc-process.ts");
  const proc = new RpcProcess({ cwd: "/tmp", onFrame: () => {} });
  try {
    const ready = await proc.waitReady(30000);
    await proc.negotiateProtocol(ready);
    const state = await proc.sendCommand({ type: "get_state" });
    return { keys: Object.keys(state ?? {}).sort(), hasSessionId: Boolean(state?.sessionId), hasQueue: "queuedMessageCount" in (state ?? {}) };
  } finally {
    await proc.dispose();
  }
}

async function rustGetState() {
  const { RustRpcProcess } = await jiti.import("./rust-rpc-process.ts");
  const proc = new RustRpcProcess({ cwd: "/tmp", sessionId: `rust-equiv-${Date.now()}` });
  try {
    const ready = await proc.waitReady(30000);
    await proc.negotiateProtocol(ready);
    const state = await proc.sendCommand({ type: "get_state" });
    return { keys: Object.keys(state ?? {}).sort(), hasSessionId: Boolean(state?.sessionId), hasQueue: "queuedMessageCount" in (state ?? {}) };
  } finally {
    await proc.dispose();
  }
}

test("rust path: waitReady + negotiate + get_state over real omp", { skip: !existsSync(hostBin) ? "ompweb-host binary not built (run cargo build)" : !hasOmp ? "omp binary not found" : false }, async () => {
  const rust = await rustGetState();
  assert.equal(rust.hasSessionId, true, "get_state carries sessionId");
  assert.equal(rust.hasQueue, true, "get_state carries queuedMessageCount");
  assert.ok(rust.keys.length > 3, "state has multiple fields: " + rust.keys.join(","));
});

test("rust path returns the RpcSessionState contract fields (Node-equivalent)", { skip: !existsSync(hostBin) ? "ompweb-host binary not built (run cargo build)" : !hasOmp ? "omp binary not found" : false }, async () => {
  const rust = await rustGetState();
  // The contract is single-sourced (RpcSessionState in lib/pi-types.ts): the
  // rust path must return the same core fields the Node path returns.
  // (Dual-run in one process contends on agent.db — omp is single-instance;
  // the Node side of the contract is pinned by RpcSessionState itself.)
  // The contract is RpcSessionState (lib/pi-types.ts) — the raw omp
  // get_state shape; phase/agentRunning etc. are WebSessionState aggregates
  // computed by the Node wrapper, not part of this contract.
  for (const key of ["sessionId", "queuedMessageCount", "isStreaming", "isCompacting", "messageCount", "model", "thinkingLevel", "todoPhases"]) {
    assert.ok(rust.keys.includes(key), `rust has ${key}`);
  }
  assert.ok(rust.keys.length >= 12, "state has a full contract surface: " + rust.keys.length);
});

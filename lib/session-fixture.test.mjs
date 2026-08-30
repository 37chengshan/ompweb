import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { generateSessionJsonl } from "../scripts/lib/session-fixture-gen.mjs";

// Fixture determinism underpins the whole 5.0 baseline (ADR-007): same seed
// must produce byte-identical sessions, or perf numbers and golden hashes
// stop being comparable across machines and waves.

test("chat fixtures are byte-deterministic for a fixed seed", () => {
  const args = {
    messageCount: 100,
    seed: 0x5eed0001,
    cwd: "/Users/cc/code/ompweb",
    title: "chat-s fixture (100 messages)",
  };
  const a = generateSessionJsonl(args);
  const b = generateSessionJsonl(args);
  assert.equal(a.jsonl, b.jsonl);
  assert.equal(
    createHash("sha256").update(a.jsonl).digest("hex"),
    "b732a5ce550e1d13b582ea43a8cc1289cbc12c8a0dcdf4dbb9dc0639bb7a8a15",
    "chat-s fixture hash changed — regenerating baselines is a deliberate visual/perf decision",
  );
});

test("fixture sessions follow the omp v3 layout", () => {
  const { jsonl } = generateSessionJsonl({ messageCount: 60, seed: 7 });
  const lines = jsonl.split("\n").filter((l) => l.trim());
  const title = JSON.parse(lines[0]);
  assert.equal(title.type, "title");
  assert.equal(Buffer.byteLength(lines[0]), 256, "title slot must be exactly 256 bytes");

  const entries = lines.slice(1).map((l) => JSON.parse(l));
  assert.equal(entries[0].type, "session");
  assert.equal(entries[0].version, 3);

  const ids = new Set(entries.map((e) => e.id).filter(Boolean));
  assert.equal(ids.size, entries.filter((e) => e.id).length, "entry ids must be unique");
  for (const e of entries) {
    if (e.type === "message") {
      assert.ok(e.id && e.parentId !== undefined, "message entries need id + parentId");
      assert.ok(e.message && e.message.role);
    }
  }
  // parentId chain must connect to earlier entries (tree, not orphans).
  const roots = entries.filter((e) => e.type === "message" && e.parentId === null);
  assert.ok(roots.length === 0, "messages chain onto model_change/session, none are root");

  const roles = entries.filter((e) => e.type === "message").map((e) => e.message.role);
  assert.ok(roles.includes("user") && roles.includes("assistant") && roles.includes("toolResult"));
});

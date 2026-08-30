import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { scanRepo, totalsOf } from "../scripts/lib/scan-client-api.mjs";

// 5.0 plan W0 gate (docs/refactor/ompweb-5.0/01 Slice 1): the committed direct
// call inventory and the eslint allowlist must mirror the live tree. A drift
// means a new direct /api fetch or EventSource was added (or a legacy one
// removed) — update deliberately via scripts/audit-client-api.mjs.

test("direct client-API inventory matches the live tree", () => {
  const committed = JSON.parse(
    readFileSync(new URL("../docs/refactor/ompweb-5.0/baseline/api-call-inventory.json", import.meta.url), "utf8"),
  );
  const live = scanRepo();
  const liveTotals = totalsOf(live).totals;

  assert.deepEqual(liveTotals, committed.totals, "call totals drifted — re-run scripts/audit-client-api.mjs");

  const committedCounts = new Map(committed.files.map((f) => [f.file, f.calls.length]));
  const problems = [];
  for (const { file, calls } of live) {
    const before = committedCounts.get(file);
    if (before === undefined) problems.push(`unregistered file: ${file}`);
    else if (before !== calls.length)
      problems.push(`${file}: committed ${before} calls vs live ${calls.length}`);
    committedCounts.delete(file);
  }
  for (const leftover of committedCounts.keys())
    problems.push(`committed inventory references missing calls in: ${leftover}`);
  assert.deepEqual(problems, [], "inventory drift — if intentional, run scripts/audit-client-api.mjs");
});

test("eslint allowlist stays in sync with the inventory", () => {
  const allowlist = JSON.parse(readFileSync(new URL("../scripts/client-api-allowlist.json", import.meta.url), "utf8"));
  const inventory = JSON.parse(
    readFileSync(new URL("../docs/refactor/ompweb-5.0/baseline/api-call-inventory.json", import.meta.url), "utf8"),
  );
  const expected = Object.fromEntries(inventory.files.map((f) => [f.file, f.calls.length]));
  assert.deepEqual(allowlist.files, expected, "allowlist drift — run scripts/audit-client-api.mjs --update-allowlist");
});

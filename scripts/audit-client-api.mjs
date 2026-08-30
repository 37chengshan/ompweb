// Generates and verifies the direct client-API call inventory for the 5.0
// refactor baseline (docs/refactor/ompweb-5.0/, doc 01 Slice 1).
//
//   node scripts/audit-client-api.mjs                  → write inventory + allowlist
//   node scripts/audit-client-api.mjs --check          → verify committed files match the tree
//   node scripts/audit-client-api.mjs --update-allowlist → refresh only the allowlist
//
// The committed inventory is the W0 golden record: new direct fetch/EventSource
// calls must go through lib/client adapters, and legacy call sites leave the
// inventory only by deleting code (test lib/api-inventory.test.mjs enforces sync).

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { scanRepo, totalsOf, REPO_ROOT_DIR } from "./lib/scan-client-api.mjs";

const BASELINE_DIR = path.join(REPO_ROOT_DIR, "docs", "refactor", "ompweb-5.0", "baseline");
const INVENTORY_JSON = path.join(BASELINE_DIR, "api-call-inventory.json");
const INVENTORY_MD = path.join(BASELINE_DIR, "api-call-inventory.md");
const ALLOWLIST = path.join(REPO_ROOT_DIR, "scripts", "client-api-allowlist.json");

const check = process.argv.includes("--check");
const updateAllowlistOnly = process.argv.includes("--update-allowlist");

const scanned = scanRepo();
const { totals, domains } = totalsOf(scanned);
const generatedAt = new Date().toISOString();

function inventoryPayload() {
  return { generatedAt, totals, domains, files: scanned };
}

function allowlistPayload() {
  const files = {};
  for (const { file, calls } of scanned) files[file] = calls.length;
  return {
    comment:
      "Legacy direct /api fetch + EventSource call sites (5.0 doc 01 Slice 1). " +
      "Counts are enforced against the live tree by lib/api-inventory.test.mjs — " +
      "regenerate with: node scripts/audit-client-api.mjs --update-allowlist. " +
      "Files leave this list only by migrating to lib/client adapters.",
    files,
  };
}

function writeIfChanged(file, text) {
  const prev = (() => {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return null;
    }
  })();
  if (prev === text) return false;
  writeFileSync(file, text);
  return true;
}

if (check) {
  const expectedInventory = JSON.parse(readFileSync(INVENTORY_JSON, "utf8"));
  const expectedAllowlist = JSON.parse(readFileSync(ALLOWLIST, "utf8"));
  const actualAllowlist = allowlistPayload();
  const errors = [];
  if (JSON.stringify(expectedInventory.totals) !== JSON.stringify(totals)) {
    errors.push(
      `inventory totals drifted: committed ${JSON.stringify(expectedInventory.totals)} vs live ${JSON.stringify(totals)}`,
    );
  }
  const committedCalls = new Map(expectedInventory.files.map((f) => [f.file, f.calls.length]));
  for (const { file, calls } of scanned) {
    const before = committedCalls.get(file);
    if (before === undefined) errors.push(`new direct-API file not in inventory: ${file}`);
    else if (before !== calls.length)
      errors.push(`call count changed in ${file}: committed ${before} vs live ${calls.length}`);
    committedCalls.delete(file);
  }
  for (const leftover of committedCalls.keys())
    errors.push(`inventory entry no longer matches any file (calls deleted?): ${leftover}`);
  if (JSON.stringify(expectedAllowlist.files) !== JSON.stringify(actualAllowlist.files)) {
    errors.push("scripts/client-api-allowlist.json out of sync with the live tree");
  }
  if (errors.length > 0) {
    console.error(
      "api-inventory drift detected — update deliberately (5.0 W0 gate):\n" +
        errors.map((e) => `  - ${e}`).join("\n") +
        "\nIf intentional: node scripts/audit-client-api.mjs && node scripts/audit-client-api.mjs --update-allowlist",
    );
    process.exit(1);
  }
  console.log(`api inventory in sync: ${totals.calls} calls in ${totals.files} files`);
} else {
  mkdirSync(BASELINE_DIR, { recursive: true });
  if (!updateAllowlistOnly) {
    writeIfChanged(INVENTORY_JSON, JSON.stringify(inventoryPayload(), null, 2) + "\n");

    const lines = [
      "# Direct client-API call inventory (W0 baseline)",
      "",
      `Generated: ${generatedAt} · totals: ${totals.calls} calls / ${totals.files} files · ` +
        `http ${totals.http} (read ${totals.read} / write ${totals.write}) · sse ${totals.sse}`,
      "",
      "| domain | calls |",
      "|---|---|",
      ...Object.entries(domains)
        .sort((a, b) => b[1] - a[1])
        .map(([d, n]) => `| ${d} | ${n} |`),
      "",
      "Machine-readable record: `api-call-inventory.json`. Sync gate: `lib/api-inventory.test.mjs`; lint gate: `eslint.config.mjs`.",
    ];
    writeIfChanged(INVENTORY_MD, lines.join("\n") + "\n");
  }
  writeIfChanged(ALLOWLIST, JSON.stringify(allowlistPayload(), null, 2) + "\n");
  console.log(
    `${updateAllowlistOnly ? "allowlist" : "inventory + allowlist"} written: ${totals.calls} calls / ${totals.files} files`,
  );
}

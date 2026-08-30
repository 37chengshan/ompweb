// Error-code contract audit (5.0 W0, doc 13 item 8).
//
//   node scripts/audit-error-codes.mjs           → write lib/contracts/fixtures/error-codes.json
//   node scripts/audit-error-codes.mjs --check   → exit 1 if route codes drifted
//
// `code:` values are wire contract: clients branch on them and locales map
// them. This golden freezes the set emitted by app/api routes; the split into
// localized/unlocalized is computed live from the locale files by the contract
// test, not frozen here.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const goldenPath = path.join(repoRoot, "lib", "contracts", "fixtures", "error-codes.json");

// Only act when invoked as a CLI. The contract test imports collectErrorCodes
// directly — a bare import must never rewrite the golden it is checking.
const invokedAsCli =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

function listRouteFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listRouteFiles(full, out);
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

export function collectErrorCodes() {
  const codes = new Set();
  const routeDir = path.join(repoRoot, "app", "api");
  for (const file of listRouteFiles(routeDir)) {
    const src = readFileSync(file, "utf8");
    for (const match of src.matchAll(/code:\s*"([a-z_0-9]+)"/g)) codes.add(match[1]);
  }
  return [...codes].sort();
}

export function buildErrorCodesPayload() {
  return {
    comment:
      "Golden record of every `code:` emitted by app/api routes (5.0 W0, doc 13 item 8). " +
      "Regenerate deliberately; codes are wire contract — renaming/removing one breaks clients.",
    localizedNote:
      "codes with an `errors.<code>` entry in lib/i18n/locales/en.json; formatApiError renders them localized",
    unlocalizedNote:
      "codes without a locale entry; formatApiError falls back to the server's English `error` text (frozen 4.x behavior)",
    codes: collectErrorCodes(),
  };
}

if (invokedAsCli && process.argv.includes("--check")) {
  const committed = JSON.parse(readFileSync(goldenPath, "utf8"));
  const live = collectErrorCodes();
  const added = live.filter((c) => !committed.codes.includes(c));
  const removed = committed.codes.filter((c) => !live.includes(c));
  if (added.length || removed.length) {
    console.error(
      "error-code contract drift:\n" +
        (added.length ? `  - added: ${added.join(", ")}\n` : "") +
        (removed.length ? `  - removed: ${removed.join(", ")}\n` : "") +
        "If intentional: node scripts/audit-error-codes.mjs",
    );
    process.exit(1);
  }
  console.log(`error codes in sync: ${live.length}`);
} else if (invokedAsCli) {
  mkdirSync(path.dirname(goldenPath), { recursive: true });
  writeFileSync(goldenPath, JSON.stringify(buildErrorCodesPayload(), null, 2) + "\n");
  console.log(`error codes written: ${collectErrorCodes().length}`);
}

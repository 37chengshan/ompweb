// Writes the doc-12 chat fixtures (Chat-S/L/XL) to a target directory and
// prints their sha256 hashes. Deterministic: same seed ⇒ same bytes.
//
//   node scripts/gen-session-fixtures.mjs [--out .baseline-fixtures]
//
// Files land in <out>/sessions/<project-slug>/<session-file>.jsonl, mirroring
// the omp sessions layout so perf/UI harnesses can point PI_CODING_AGENT_DIR
// at the output root directly.

import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { generateSessionJsonl, sessionFileName, projectSlugs } from "./lib/session-fixture-gen.mjs";

const outArg = process.argv.indexOf("--out");
const outRoot = path.resolve(outArg > -1 ? process.argv[outArg + 1] : ".baseline-fixtures");
const sessionsRoot = path.join(outRoot, "sessions");

const CHAT_FIXTURES = [
  { name: "chat-s", messages: 100, seed: 0x5eed0001 },
  { name: "chat-l", messages: 1000, seed: 0x5eed0002 },
  { name: "chat-xl", messages: 5000, seed: 0x5eed0003 },
];

const hashes = {};
for (const fx of CHAT_FIXTURES) {
  const { jsonl } = generateSessionJsonl({
    messageCount: fx.messages,
    seed: fx.seed,
    cwd: "/Users/cc/code/ompweb",
    title: `${fx.name} fixture (${fx.messages} messages)`,
  });
  const dir = path.join(sessionsRoot, projectSlugs()[0]);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, sessionFileName(fx.seed));
  writeFileSync(file, jsonl);
  hashes[fx.name] = {
    messages: fx.messages,
    bytes: Buffer.byteLength(jsonl),
    sha256: createHash("sha256").update(jsonl).digest("hex"),
    file: path.relative(outRoot, file),
  };
}

console.log(JSON.stringify(hashes, null, 2));

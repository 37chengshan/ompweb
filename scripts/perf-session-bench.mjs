// 4.x performance baseline harness (5.0 W0, doc 13 item 6 / doc 12).
//
//   node scripts/perf-session-bench.mjs [--runs 12] [--out docs/.../perf-baseline.json]
//
// Builds the doc-12 fixtures (Sessions-L 1k sessions + Chat-S/L/XL) in a temp
// agent dir, then measures the read-side hot paths that the Rust Host (doc 06)
// must later match: listAllSessions (cold + warm), per-session context load,
// and raw JSONL parse throughput. Reports p50/p95/mean ms; results are the
// machine-tagged baseline evidence for the freeze in ADR-007.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createJiti } from "jiti";
import { generateSessionJsonl, sessionFileName, projectSlugs } from "./lib/session-fixture-gen.mjs";

const jiti = createJiti(import.meta.url);

const repoRoot = path.resolve(import.meta.dirname, "..");
const runsArg = process.argv.indexOf("--runs");
const RUNS = runsArg > -1 ? Number(process.argv[runsArg + 1]) : 12;
const outArg = process.argv.indexOf("--out");
const OUT = outArg > -1 ? path.resolve(process.argv[outArg + 1]) : path.join(
  repoRoot,
  "docs",
  "refactor",
  "ompweb-5.0",
  "baseline",
  "perf-baseline.json",
);

function percentile(samples, p) {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function stats(samples) {
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return {
    runs: samples.length,
    p50: round(percentile(samples, 50)),
    p95: round(percentile(samples, 95)),
    mean: round(mean),
    min: round(Math.min(...samples)),
    max: round(Math.max(...samples)),
  };
}
function round(n) {
  return Math.round(n * 100) / 100;
}

// --- setup: temp agent dir with fixtures -------------------------------------
const agentDir = mkdtempSync(path.join(tmpdir(), "ompweb-perf-"));
// Clean up even when a bench throws mid-run.
process.on("exit", () => {
  try {
    rmSync(agentDir, { recursive: true, force: true });
  } catch {}
});
process.env.PI_CODING_AGENT_DIR = agentDir;
const sessionsRoot = path.join(agentDir, "sessions");

const setupStart = performance.now();
const slugs = projectSlugs();
const SESSION_COUNT = 1000;
const chatFiles = {};
for (let i = 0; i < SESSION_COUNT; i++) {
  const slug = slugs[i % slugs.length];
  const messages = 8 + (i % 33);
  const { jsonl } = generateSessionJsonl({
    messageCount: messages,
    seed: 0x1000 + i,
    cwd: `/Users/cc/work/project-${i % slugs.length}`,
  });
  const dir = path.join(sessionsRoot, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, sessionFileName(0x1000 + i)), jsonl);
}
for (const [name, seed, messages] of [
  ["chat-s", 0x5eed0001, 100],
  ["chat-l", 0x5eed0002, 1000],
  ["chat-xl", 0x5eed0003, 5000],
]) {
  const { jsonl } = generateSessionJsonl({
    messageCount: messages,
    seed,
    cwd: "/Users/cc/code/ompweb",
    title: `${name} fixture (${messages} messages)`,
  });
  const dir = path.join(sessionsRoot, slugs[0]);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, sessionFileName(seed));
  writeFileSync(file, jsonl);
  chatFiles[name] = file;
}
const setupMs = round(performance.now() - setupStart);

// --- benches (env set before the first paths.ts call; jiti resolves TS) -------
const {
  listAllSessions,
  invalidateSessionListCache,
  getSessionEntries,
  buildSessionContext,
} = await jiti.import("../lib/session-reader.ts");
const { invalidateSessionFileListCache } = await jiti.import("../lib/omp/session-files.ts");

const results = {};

const coldSamples = [];
for (let i = 0; i < RUNS; i++) {
  invalidateSessionListCache();
  invalidateSessionFileListCache();
  const t = performance.now();
  const sessions = await listAllSessions();
  coldSamples.push(performance.now() - t);
  if (i === 0) results.listAllSessions_count = sessions.length;
}
results.listAllSessions_cold = stats(coldSamples);

const warmSamples = [];
for (let i = 0; i < RUNS * 2; i++) {
  const t = performance.now();
  await listAllSessions();
  warmSamples.push(performance.now() - t);
}
results.listAllSessions_warm = stats(warmSamples);

for (const name of ["chat-s", "chat-l", "chat-xl"]) {
  const filePath = chatFiles[name];
  const coldSamples = [];
  const warmSamples = [];
  let messageCount = 0;
  // Cold = full re-parse: invalidateSessionListCache() clears the list cache,
  // the sessions-root walk cache AND the __ompSessionEntriesCache entry cache.
  for (let i = 0; i < RUNS; i++) {
    invalidateSessionListCache();
    const t = performance.now();
    const ctx = buildSessionContext(getSessionEntries(filePath));
    coldSamples.push(performance.now() - t);
    if (ctx.messages.length === 0) {
      throw new Error(
        `${name}: buildSessionContext returned 0 messages — the fixture no longer parses as a valid omp session; refusing to record a meaningless baseline`,
      );
    }
    messageCount = ctx.messages.length;
  }
  // Warm pass: the entries cache (size+mtime keyed) serves every run.
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    const ctx = buildSessionContext(getSessionEntries(filePath));
    warmSamples.push(performance.now() - t);
    if (ctx.messages.length === 0) throw new Error(`${name}: warm pass returned 0 messages`);
  }
  results[`contextLoad_${name}_cold`] = { ...stats(coldSamples), messages: messageCount, bytes: statSync(filePath).size };
  results[`contextLoad_${name}_warm`] = stats(warmSamples);
}

// Raw JSONL parse throughput on chat-l (line split + JSON.parse).
{
  const filePath = chatFiles["chat-l"];
  const buf = readFileSync(filePath, "utf8");
  const t = performance.now();
  let count = 0;
  for (const line of buf.split("\n")) {
    if (line.trim()) {
      JSON.parse(line);
      count++;
    }
  }
  const ms = performance.now() - t;
  results.rawJsonlParse = {
    ms: round(ms),
    lines: count,
    bytes: Buffer.byteLength(buf),
    mbPerSecond: round(Buffer.byteLength(buf) / 1e6 / (ms / 1000)),
  };
}

// --- report -------------------------------------------------------------------
const machine = {
  platform: os.platform(),
  arch: os.arch(),
  release: os.release(),
  cpuModel: os.cpus()[0]?.model ?? "unknown",
  totalMemGb: round(os.totalmem() / 1e9),
  nodeVersion: process.version,
};

const payload = {
  generatedAt: new Date().toISOString(),
  note: "4.x W0 baseline (pre-freeze). Same-machine comparisons only; see ADR-007 for budgets and rules.",
  machine,
  setup: { fixture: "Sessions-L(1000)+Chat-S/L/XL", setupMs },
  results,
  fixtureHashes: Object.fromEntries(
    Object.entries(chatFiles).map(([k, f]) => [k, createHash("sha256").update(readFileSync(f)).digest("hex")]),
  ),
};

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");

console.log(`machine: ${machine.platform}/${machine.arch} ${machine.cpuModel}, node ${machine.nodeVersion}`);
console.log(`fixture setup: ${setupMs} ms`);
for (const [k, v] of Object.entries(results)) {
  if (typeof v !== "object") console.log(`${k}: ${v}`);
  else if ("p50" in v) console.log(`${k}: p50 ${v.p50}ms · p95 ${v.p95}ms · mean ${v.mean}ms${v.messages ? ` (${v.messages} msgs)` : ""}`);
  else console.log(`${k}: ${JSON.stringify(v)}`);
}
console.log(`written: ${path.relative(repoRoot, OUT)}`);
rmSync(agentDir, { recursive: true, force: true });

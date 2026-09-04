import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// R6 exit gate (doc 15 / v4 R6): the Rust journal shadow must replay real
// session JSONL into SQLite with full parity — every parseable line lands in
// the journal, malformed lines are counted (never silent), and the DB stays
// bounded. The binary is built by `cargo build`; the test skips when absent
// so plain npm test stays green in environments without a Rust toolchain.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hostBin = join(root, "crates", "target", "debug", "ompweb-host");

function buildFixture() {
  // Reuse the deterministic fixture generator (same seed/hash as the
  // perf baseline) for a realistic session shape.
  const dir = join(tmpdir(), `omp-shadow-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  const sessionsRoot = join(dir, "sessions");
  mkdirSync(sessionsRoot, { recursive: true });
  execFileSync("node", [join(root, "scripts", "gen-session-fixtures.mjs"), "--out", dir], { stdio: "ignore" });
  return join(sessionsRoot, "Users-cc-code-ompweb");
}

test("rust journal shadow replays session jsonl with parity", { skip: !existsSync(hostBin) ? "ompweb-host binary not built (run cargo build)" : false }, () => {
  const sessionsRoot = buildFixture();
  const db = join(tmpdir(), `omp-shadow-${process.pid}.db`);
  rmSync(db, { force: true });

  const output = execFileSync(hostBin, ["--journal-shadow", sessionsRoot, db], { encoding: "utf8" });
  const stats = JSON.parse(output.trim());
  assert.equal(stats.status, "ok");

  // Node-side ground truth: every non-empty line is a valid JSONL entry.
  const files = ["20260115T100000_00005eed0001-4a0d-4f5e-9c1b-0b7865431eef.jsonl",
    "20260115T110000_00005eed0002-4a0d-4f5e-9c1b-0b7865433dde.jsonl",
    "20260115T120000_00005eed0003-4a0d-4f5e-9c1b-0b7865435ccd.jsonl"];
  let expectedLines = 0;
  for (const f of files) {
    const text = readFileSync(join(sessionsRoot, f), "utf8");
    expectedLines += text.split("\n").filter((l) => l.trim().length > 0).length;
  }
  assert.equal(stats.files, 3);
  assert.equal(stats.streams, 3);
  assert.equal(stats.events, expectedLines);
  assert.equal(stats.lines, expectedLines);
  assert.equal(stats.skipped, 0);
  // Bounded growth: the DB must be far smaller than the raw JSONL payload.
  const rawBytes = files.reduce((acc, f) => acc + statSync(join(sessionsRoot, f)).size, 0);
  assert.ok(stats.db_bytes < rawBytes / 2, `db ${stats.db_bytes} vs raw ${rawBytes}`);
});

test("rust journal shadow counts malformed lines, never silently drops them", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : false }, () => {
  const dir = join(tmpdir(), `omp-shadow-bad-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  const sessionsRoot = join(dir, "sessions");
  mkdirSync(sessionsRoot, { recursive: true });
  const file = join(sessionsRoot, "bad.jsonl");
  const lines = [
    '{"type":"message","id":"ok-1","message":{"role":"user","content":"hi"}}',
    "this is not json",
    '{"type":"message","id":"ok-2","message":{"role":"assistant","content":"yo"}}',
  ];
  writeFileSync(file, lines.join("\n") + "\n");
  const db = join(dir, "shadow.db");
  const output = execFileSync(hostBin, ["--journal-shadow", sessionsRoot, db], { encoding: "utf8" });
  const stats = JSON.parse(output.trim());
  assert.equal(stats.events, 2);
  assert.equal(stats.skipped, 1);
});

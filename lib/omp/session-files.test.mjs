import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isOmpSessionFileName, scanSessionInfo } = await jiti.import("./session-files.ts");

test("session file name rule accepts both omp timestamp forms", () => {
  assert.equal(isOmpSessionFileName("2026-08-27T16-58-53-862Z_01a04429-0426-71ee-9345-c66edc32e851.jsonl"), true);
  assert.equal(isOmpSessionFileName("2026-08-27T16-58-53Z_01a04429.jsonl"), true);
  assert.equal(isOmpSessionFileName("20260103T030000_00000000002a-4a0d-4f5e-9c1b-000000051336.jsonl"), true);
});

test("session file name rule rejects subagent transcripts and sidecars", () => {
  assert.equal(isOmpSessionFileName("CodeQualityReview.jsonl"), false);
  assert.equal(isOmpSessionFileName("sec-review-eval.jsonl"), false);
  assert.equal(isOmpSessionFileName("10.bash.log"), false);
  assert.equal(isOmpSessionFileName("2026-08-27.txt"), false);
  assert.equal(isOmpSessionFileName("2026-08-27T16-58-53Z_.jsonl"), false);
});

test("scanSessionInfo injects the first message as title for empty title slots", () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-web-title-"));
  try {
    const file = join(dir, "2026-08-27T16-58-53Z_01a04429.jsonl");
    writeFileSync(file, '{"type":"title","v":1,"title":"","updatedAt":"2026-08-27T16:58:53Z","pad":"   "}\n{"type":"session","version":3,"id":"01a04429","timestamp":"2026-08-27T16:58:53Z","cwd":"/p"}\n{"type":"message","id":"m1","parentId":null,"message":{"role":"user","content":[{"type":"text","text":"hello blocks"}]}}\n');
    const info = scanSessionInfo(file, false);
    assert.ok(info);
    assert.equal(info.title, "hello blocks");
    assert.equal(info.firstMessage, "hello blocks");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanSessionInfo extends the head window to find the first message", () => {
  const dir = mkdtempSync(join(tmpdir(), "omp-web-extend-"));
  try {
    const file = join(dir, "2026-08-27T16-58-53Z_01a04430.jsonl");
    const init = '{"type":"session_init","id":"s1","parentId":null,"systemPrompt":"' + "x".repeat(12000) + '"}';
    writeFileSync(file, '{"type":"session","version":3,"id":"01a04430","timestamp":"2026-08-27T16:58:53Z","cwd":"/p"}\n' + init + '\n{"type":"message","id":"m1","parentId":null,"message":{"role":"user","content":"first after init"}}\n');
    const info = scanSessionInfo(file, false);
    assert.ok(info);
    assert.equal(info.firstMessage, "first after init");
    assert.equal(info.title, "first after init");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

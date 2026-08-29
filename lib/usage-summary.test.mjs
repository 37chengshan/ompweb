import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { sessionFileTime, parseUsageSummaryLine, computeUsageSummary } = await jiti.import("./usage-summary.ts");

function iso(offsetMs) {
  return new Date(Date.now() - offsetMs).toISOString().replace(/[:.]/g, (ch) => (ch === ":" ? "-" : "-"));
}

test("sessionFileTime parses the leading ISO timestamp with dashes", () => {
  const t = sessionFileTime("2026-08-02T16-12-56-776Z_019fc33f-f648-7000-8382-d922af393c50.jsonl");
  assert.equal(t, Date.parse("2026-08-02T16:12:56.776Z"));
  assert.equal(sessionFileTime("not-a-session.txt"), null);
});

test("parseUsageSummaryLine extracts input+output and rejects non-usage lines", () => {
  const line = JSON.stringify({
    type: "message",
    timestamp: "2026-08-02T16:12:56.776Z",
    message: { role: "assistant", usage: { input: 100, output: 25, cacheRead: 999 } },
  });
  const parsed = parseUsageSummaryLine(line);
  assert.deepEqual(parsed, { input: 100, output: 25, at: Date.parse("2026-08-02T16:12:56.776Z") });
  assert.equal(parseUsageSummaryLine('{"type":"session","version":3}'), null);
  assert.equal(parseUsageSummaryLine('{"type":"message","timestamp":"2026-08-02T16:12:56.776Z","message":{"role":"user","content":"hi"}}'), null);
  assert.equal(parseUsageSummaryLine("not json"), null);
});

test("computeUsageSummary buckets today/week/month/total and skips old files", () => {
  // Anchor to local noon: dayStart is local midnight, so a run right after
  // midnight would see now-2h land on "yesterday" and empty the today bucket.
  const now = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();
  const hour = 60 * 60 * 1000;
  const todayFile = { path: "/tmp/x-1.jsonl", fileTime: now - hour };
  const weekFile = { path: "/tmp/x-2.jsonl", fileTime: now - 3 * 24 * hour };
  const monthFile = { path: "/tmp/x-3.jsonl", fileTime: now - 20 * 24 * hour };
  const oldFile = { path: "/tmp/x-4.jsonl", fileTime: now - 100 * 24 * hour };

  const lines = {
    [todayFile.path]: [
      JSON.stringify({ type: "message", timestamp: new Date(now - 30 * 60 * 1000).toISOString(), message: { usage: { input: 100, output: 20 } } }),
      JSON.stringify({ type: "message", timestamp: new Date(now - 2 * hour).toISOString(), message: { usage: { input: 10, output: 5 } } }),
    ].join("\n") + "\n",
    [weekFile.path]: JSON.stringify({ type: "message", timestamp: new Date(now - 3 * 24 * hour).toISOString(), message: { usage: { input: 50, output: 10 } } }) + "\n",
    [monthFile.path]: JSON.stringify({ type: "message", timestamp: new Date(now - 20 * 24 * hour).toISOString(), message: { usage: { input: 200, output: 0 } } }) + "\n",
    [oldFile.path]: JSON.stringify({ type: "message", timestamp: new Date(now - 100 * 24 * hour).toISOString(), message: { usage: { input: 9999, output: 9999 } } }) + "\n",
  };

  // computeUsageSummary reads from disk by path — write real temp files.
  const dir = mkdtempSync(join(tmpdir(), "omp-usage-summary-"));
  try {
    for (const file of [todayFile, weekFile, monthFile, oldFile]) {
      writeFileSync(file.path.replace("/tmp/x", join(dir, "x")), lines[file.path]);
      file.path = file.path.replace("/tmp/x", join(dir, "x"));
    }
    const summary = computeUsageSummary([todayFile, weekFile, monthFile, oldFile], now);
    // today: 100+20 + 10+5 = 135; week adds 50+10 = 195; month adds 200 = 395; total = 395 (old skipped).
    assert.equal(summary.today, 135);
    assert.equal(summary.week, 195);
    assert.equal(summary.month, 395);
    assert.equal(summary.total, 395);
    assert.equal(summary.scannedFiles, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

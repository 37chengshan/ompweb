import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

const { extractSubagentHistory, readCompletionArtifact, readSubagentTranscriptPage, resolveSubagentArtifact, siblingDirForSession, MAX_SUBAGENT_COMPLETION_BYTES } =
  await jiti.import("./subagent-history.ts");

function makeSessionFixture() {
  const dir = mkdtempSync(join(tmpdir(), "ompweb-subagent-history-"));
  const sessionFile = join(dir, "2026-08-01T00-00-00_abc123.jsonl");
  const lines = [
    JSON.stringify({ type: "session", version: 3, id: "parent-session", timestamp: "2026-08-01T00:00:00.000Z", cwd: "C:\\work" }),
    JSON.stringify({
      type: "message",
      id: "e1",
      parentId: null,
      timestamp: "2026-08-01T00:00:01.000Z",
      message: {
        role: "toolResult",
        toolCallId: "tc1",
        toolName: "task",
        content: [],
        details: {
          projectAgentsDir: "C:\\work\\.omp\\agents",
          progress: [
            {
              index: 0,
              id: "ScoutAgent",
              agent: "scout",
              agentSource: "bundled",
              status: "running",
              task: "Map the surface",
              assignment: "Inspect files",
              tokens: 1200,
              cost: 0.012,
              durationMs: 65000,
              requests: 3,
              toolCount: 9,
              resolvedModel: "provider/gpt-x",
              modelRole: "smol",
            },
          ],
          results: [
            {
              index: 0,
              id: "ScoutAgent",
              agent: "scout",
              agentSource: "bundled",
              task: "Map the surface",
              exitCode: 0,
              tokens: 999,
              durationMs: 60000,
              requests: 3,
              toolCount: 9,
              resolvedModel: "provider/gpt-x",
              modelRole: "smol",
              structuredOutput: { status: "valid", mode: "permissive" },
              outputPath: "C:\\work\\artifacts\\ScoutAgent.md",
              usage: { cost: { input: 0.4, output: 0.1, cacheRead: 0, cacheWrite: 0, total: 0.5 } },
            },
          ],
          async: { state: "completed", jobId: "ScoutAgent", type: "task" },
        },
      },
    }),
    JSON.stringify({
      type: "message",
      id: "e2",
      parentId: null,
      timestamp: "2026-08-01T00:00:02.000Z",
      message: {
        role: "toolResult",
        toolCallId: "tc2",
        toolName: "task",
        content: [],
        details: {
          results: [
            {
              index: 1,
              id: "WorkerOne",
              agent: "worker",
              agentSource: "bundled",
              task: "Write the code",
              exitCode: 1,
              error: "Test failed",
              tokens: 500,
            },
          ],
          async: { state: "failed", jobId: "WorkerOne", type: "task" },
        },
      },
    }),
  ];
  writeFileSync(sessionFile, lines.join("\n") + "\n");

  // Sibling artifacts dir with one transcript file.
  const artifactsDir = siblingDirForSession(sessionFile);
  mkdirSync(artifactsDir, { recursive: true });
  const transcript = [
    JSON.stringify({ type: "session", version: 3, id: "sub-session", timestamp: "2026-08-01T00:00:00.000Z", cwd: "C:\\work" }),
    JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-08-01T00:00:01.000Z", message: { role: "user", content: "Map the surface" } }),
    JSON.stringify({ type: "message", id: "m2", parentId: "m1", timestamp: "2026-08-01T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } }),
  ];
  writeFileSync(join(artifactsDir, "ScoutAgent.jsonl"), transcript.join("\n") + "\n");

  return { dir, sessionFile, artifactsDir };
}

test("extracts subagent roster from task toolResults with settled results winning", () => {
  const { dir, sessionFile } = makeSessionFixture();
  try {
    const roster = extractSubagentHistory(sessionFile);
    assert.equal(roster.length, 2);

    const scout = roster.find((entry) => entry.id === "ScoutAgent");
    assert.ok(scout);
    assert.equal(scout.agent, "scout");
    assert.equal(scout.agentSource, "bundled");
    // Settled result overrides the mid-run progress snapshot.
    assert.equal(scout.status, "completed");
    assert.equal(scout.tokens, 999);
    // Settled cost rides usage.cost.total (top-level cost is absent)
    assert.equal(scout.cost, 0.5);
    assert.equal(scout.durationMs, 60000);
    assert.equal(scout.task, "Map the surface");
    assert.equal(scout.transcriptAvailable, true);
    assert.equal(scout.sessionFile, join(dir, "2026-08-01T00-00-00_abc123", "ScoutAgent.jsonl"));
    assert.equal(scout.result?.structuredOutput?.status, "valid");

    const worker = roster.find((entry) => entry.id === "WorkerOne");
    assert.ok(worker);
    assert.equal(worker.status, "failed");
    assert.equal(worker.result?.error, "Test failed");
    assert.equal(worker.transcriptAvailable, false);
    // Both spawns were async (details.async present).
    assert.equal(scout.detached, true);
    assert.equal(worker.detached, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("keeps async-only spawns (empty results) as started entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "ompweb-subagent-history-"));
  const sessionFile = join(dir, "sess.jsonl");
  try {
    const lines = [
      JSON.stringify({ type: "session", version: 3, id: "p", timestamp: "2026-08-01T00:00:00.000Z", cwd: "C:\\work" }),
      JSON.stringify({
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2026-08-01T00:00:01.000Z",
        message: {
          role: "toolResult",
          toolCallId: "tc1",
          toolName: "task",
          content: [],
          details: { async: { state: "running", jobId: "AsyncJob", type: "task" } },
        },
      }),
    ];
    writeFileSync(sessionFile, lines.join("\n") + "\n");
    const roster = extractSubagentHistory(sessionFile);
    assert.equal(roster.length, 1);
    assert.equal(roster[0].id, "AsyncJob");
    assert.equal(roster[0].status, "started");
    assert.equal(roster[0].transcriptAvailable, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pages subagent transcripts byte-wise with UI messages", () => {
  const { dir, sessionFile } = makeSessionFixture();
  try {
    const transcriptFile = join(siblingDirForSession(sessionFile), "ScoutAgent.jsonl");
    const page1 = readSubagentTranscriptPage(transcriptFile, 0);
    assert.equal(page1.reset, false);
    assert.equal(page1.messages.length, 2);
    assert.equal(page1.messages[0].role, "user");
    assert.equal(page1.messages[1].role, "assistant");
    assert.ok(page1.nextByte > 0);

    // Continue from the end: nothing new.
    const page2 = readSubagentTranscriptPage(transcriptFile, page1.nextByte);
    assert.equal(page2.messages.length, 0);
    assert.equal(page2.nextByte, page1.nextByte);

    // Past EOF resets to the start.
    const page3 = readSubagentTranscriptPage(transcriptFile, 999999);
    assert.equal(page3.reset, true);
    assert.equal(page3.messages.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("byte-window paging survives non-ASCII content before the offset", () => {
  const { dir, sessionFile } = makeSessionFixture();
  try {
    const transcriptFile = join(siblingDirForSession(sessionFile), "ScoutAgent.jsonl");
    // First entry carries multi-byte UTF-8 so byte offsets and UTF-16 string
    // indices diverge (the regression that .slice(startByte) reintroduced).
    const entry1 = JSON.stringify({
      type: "message",
      id: "e1",
      parentId: null,
      timestamp: "2026-08-01T00:00:00.000Z",
      message: { role: "user", content: "質問：マルチバイトのテキストです" },
    });
    const entry2 = JSON.stringify({
      type: "message",
      id: "e2",
      parentId: null,
      timestamp: "2026-08-01T00:00:01.000Z",
      message: { role: "assistant", content: "plain ascii follow-up" },
    });
    writeFileSync(transcriptFile, `${entry1}\n${entry2}\n`);

    // Continue from the exact byte length of entry1's line: only entry2 may
    // come back. A UTF-16 slice would start mid-line and drop it.
    const fromByte = Buffer.byteLength(`${entry1}\n`, "utf8");
    const page = readSubagentTranscriptPage(transcriptFile, fromByte);
    assert.equal(page.messages.length, 1);
    assert.equal(page.messages[0].role, "assistant");
    assert.equal(page.nextByte, fromByte + Buffer.byteLength(`${entry2}\n`, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("page without a trailing newline still advances (no infinite paging)", () => {
  const { dir, sessionFile } = makeSessionFixture();
  try {
    const transcriptFile = join(siblingDirForSession(sessionFile), "ScoutAgent.jsonl");
    // No trailing newline: the last line is partial until the file grows.
    writeFileSync(transcriptFile, `{"type":"message","id":"e1","parentId":null,"timestamp":"2026-08-01T00:00:00.000Z","message":{"role":"user","content":"a"}}
{"type":"message","id":"e2","parentId":null,"timestamp":"2026-08-01T00:00:01.000Z","message":{"role":"assistant","content":"b"}}`);
    const page1 = readSubagentTranscriptPage(transcriptFile, 0);
    // Only the complete first line parses; the partial tail is skipped so
    // the next page makes progress instead of looping on the same offset.
    assert.equal(page1.messages.length, 1);
    assert.ok(page1.nextByte > 0);
    const page2 = readSubagentTranscriptPage(transcriptFile, page1.nextByte);
    assert.equal(page2.nextByte, page1.nextByte);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing transcript file yields an empty page", () => {
  const dir = mkdtempSync(join(tmpdir(), "ompweb-subagent-history-"));
  try {
    const page = readSubagentTranscriptPage(join(dir, "missing.jsonl"), 0);
    assert.equal(page.messages.length, 0);
    assert.equal(page.nextByte, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test("completion reads keep complete trailing multibyte characters", () => {
  const dir = mkdtempSync(join(tmpdir(), "ompweb-subagent-completion-"));
  const sessionFile = join(dir, "sess.jsonl");
  const artifactsDir = siblingDirForSession(sessionFile);
  mkdirSync(artifactsDir, { recursive: true });
  try {
    writeFileSync(join(artifactsDir, "Scout.md"), "hello");
    assert.equal(readCompletionArtifact(resolveSubagentArtifact(sessionFile, "Scout", ".md"))?.completion, "hello");
    writeFileSync(join(artifactsDir, "Scout.md"), "oké");
    assert.equal(readCompletionArtifact(resolveSubagentArtifact(sessionFile, "Scout", ".md"))?.completion, "oké");
    writeFileSync(join(artifactsDir, "Scout.md"), "done😀");
    assert.equal(readCompletionArtifact(resolveSubagentArtifact(sessionFile, "Scout", ".md"))?.completion, "done😀");
    // Missing file -> null; empty file -> null.
    assert.equal(readCompletionArtifact(resolveSubagentArtifact(sessionFile, "Nope", ".md")), null);
    writeFileSync(join(artifactsDir, "Scout.md"), "");
    assert.equal(readCompletionArtifact(resolveSubagentArtifact(sessionFile, "Scout", ".md")), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("completion caps materialized bytes without splitting a codepoint", () => {
  const dir = mkdtempSync(join(tmpdir(), "ompweb-subagent-completion-"));
  const sessionFile = join(dir, "sess.jsonl");
  const artifactsDir = siblingDirForSession(sessionFile);
  mkdirSync(artifactsDir, { recursive: true });
  try {
    // A file slightly over the cap ending with a 4-byte emoji: the read is
    // capped mid-emoji, and the partial sequence must be dropped, not shown.
    const prefix = "x".repeat(MAX_SUBAGENT_COMPLETION_BYTES);
    writeFileSync(join(artifactsDir, "Big.md"), prefix + "😀tail");
    const result = readCompletionArtifact(resolveSubagentArtifact(sessionFile, "Big", ".md"));
    assert.equal(result?.truncated, true);
    assert.ok(result?.completion);
    assert.ok(result.completion.length <= MAX_SUBAGENT_COMPLETION_BYTES);
    assert.equal(result.completion.includes("�"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


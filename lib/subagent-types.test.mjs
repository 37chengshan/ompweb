import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

const {
  parseSubagentProgress,
  parseSubagentSnapshot,
  parseSubagentActivityEvent,
} = await jiti.import("./subagent-types.ts");

test("parseSubagentProgress copies telemetry and retry state defensively", () => {
  const progress = parseSubagentProgress({
    index: 1,
    id: "Scout",
    agent: "scout",
    agentSource: "bundled",
    status: "running",
    currentTool: "read",
    lastIntent: "Inspect foo.ts",
    tokens: 1234,
    cost: 0.004,
    contextTokens: 8000,
    contextWindow: 32000,
    resolvedModel: "provider/gpt-x:high",
    resolvedModelIsFallback: true,
    retryState: { attempt: 2, maxAttempts: 5, delayMs: 1000, errorMessage: "429", startedAtMs: 1 },
  });
  assert.equal(progress?.currentTool, "read");
  assert.equal(progress?.lastIntent, "Inspect foo.ts");
  assert.equal(progress?.tokens, 1234);
  assert.equal(progress?.cost, 0.004);
  assert.equal(progress?.contextWindow, 32000);
  assert.equal(progress?.retryState?.attempt, 2);
  assert.equal(progress?.resolvedModelIsFallback, true);
  // Garbage fields are ignored, not fatal.
  assert.equal(parseSubagentProgress({ id: "x", tokens: "nope" })?.tokens, undefined);
  assert.equal(parseSubagentProgress(null), undefined);
  assert.equal(parseSubagentProgress({}), undefined);
});

test("parseSubagentSnapshot maps registry statuses and carries progress", () => {
  const snapshot = parseSubagentSnapshot({
    id: "Scout",
    index: 0,
    agent: "scout",
    agentSource: "user",
    status: "running",
    task: "Map",
    sessionFile: "C:\\work\\artifacts\\Scout.jsonl",
    lastUpdate: 123,
    progress: { id: "Scout", status: "running", tokens: 10 },
  });
  assert.equal(snapshot?.id, "Scout");
  assert.equal(snapshot?.status, "started");
  assert.equal(snapshot?.agentSource, "user");
  assert.equal(snapshot?.progress?.tokens, 10);
  assert.equal(snapshot?.sessionFile, "C:\\work\\artifacts\\Scout.jsonl");
  assert.equal(snapshot?.lastUpdate, 123);
  // Terminal registry statuses pass through.
  assert.equal(parseSubagentSnapshot({ id: "a", agent: "b", status: "completed" })?.status, "completed");
  assert.equal(parseSubagentSnapshot({ id: "a" }), undefined);
});

test("parseSubagentActivityEvent extracts tools, text, and notices", () => {
  const tool = parseSubagentActivityEvent({ id: "s", event: { type: "tool_execution_start", toolName: "read", intent: "Inspect foo.ts", args: { path: "foo.ts" } } });
  assert.equal(tool?.kind, "tool");
  assert.match(tool?.label ?? "", /read/);

  const text = parseSubagentActivityEvent({ id: "s", event: { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done working" }] } } });
  assert.equal(text?.kind, "text");
  assert.match(text?.label ?? "", /done working/);

  const notice = parseSubagentActivityEvent({ id: "s", event: { type: "notice", message: "tool updated" } });
  assert.equal(notice?.kind, "notice");

  assert.equal(parseSubagentActivityEvent({ id: "s", event: { type: "message_update" } }), null);
  assert.equal(parseSubagentActivityEvent({}), null);
});

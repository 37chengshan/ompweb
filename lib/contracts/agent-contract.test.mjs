import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import { collectErrorCodes } from "../../scripts/audit-error-codes.mjs";

const jiti = createJiti(import.meta.url);
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const readJson = (rel) => JSON.parse(read(rel));

// 5.0 W0 (doc 13 item 8): freeze the Agent/Session wire contract before the
// client facade (Slice 2) moves any call site. Fixtures are the reference;
// sources are the live behavior.

function extractHandleAgentEventCases() {
  const src = read("../../hooks/useAgentSession.ts");
  const start = src.indexOf("const handleAgentEvent = useCallback");
  assert.ok(start > -1, "handleAgentEvent not found");
  const switchAt = src.indexOf("switch (event.type) {", start);
  assert.ok(switchAt > -1, "event.type switch not found");
  let depth = 0;
  let i = src.indexOf("{", switchAt);
  const begin = i;
  while (i < src.length) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
    i++;
  }
  const body = src.slice(begin, i + 1);
  return [...body.matchAll(/case\s+"([^"]+)":/g)].map((m) => m[1]).sort();
}

test("SSE fixture frame types match the chat client's handled frames exactly", () => {
  const fixtureTypes = readJson("../../lib/contracts/fixtures/sse-frames.json")
    .frames.map((f) => f.type)
    .filter((t) => !["connected", "session_destroyed"].includes(t))
    .sort();
  assert.deepEqual(extractHandleAgentEventCases(), fixtureTypes);
});

test("error codes emitted by routes stay frozen in the golden", () => {
  const golden = readJson("../../lib/contracts/fixtures/error-codes.json");
  const live = collectErrorCodes();
  const added = live.filter((c) => !golden.codes.includes(c));
  const removed = golden.codes.filter((c) => !live.includes(c));
  assert.deepEqual(
    { added, removed },
    { added: [], removed: [] },
    "error-code contract drift — if intentional: node scripts/audit-error-codes.mjs",
  );
});

test("route error codes localize consistently across all three locales", () => {
  const golden = readJson("../../lib/contracts/fixtures/error-codes.json");
  const locales = Object.fromEntries(
    ["en", "zh-CN", "ja"].map((loc) => [
      loc,
      Object.keys(JSON.parse(read(`../../lib/i18n/locales/${loc}.json`)))
        .filter((k) => k.startsWith("errors."))
        .map((k) => k.slice("errors.".length)),
    ]),
  );
  // formatApiError localizes `errors.<code>` when present; the localized set
  // must exist in every locale so no language silently falls back to English.
  for (const code of golden.codes) {
    const present = locales.en.includes(code);
    for (const loc of ["zh-CN", "ja"]) {
      assert.equal(
        locales[loc].includes(code),
        present,
        `errors.${code} localized inconsistently (en vs ${loc})`,
      );
    }
  }
  // Locale error key sets must be identical across languages (a key existing
  // in en but not zh-CN/ja would silently fall back to English there).
  const enSet = [...locales.en].sort();
  assert.deepEqual([...locales["zh-CN"]].sort(), enSet, "zh-CN errors.* key set drifted from en");
  assert.deepEqual([...locales.ja].sort(), enSet, "ja errors.* key set drifted from en");
});

test("HTTP envelope shape is frozen in the agent routes", () => {
  const route = read("../../app/api/agent/[id]/route.ts");
  const agentClient = read("../../lib/agent-client.ts");
  assert.match(route, /success: true/);
  assert.match(agentClient, /success\?: boolean/);
  assert.match(agentClient, /body\.error/);
  assert.match(agentClient, /formatApiError/);
});

test("toolCall field normalization contract (file format → ToolCallContent)", async () => {
  const { normalizeToolCalls } = await jiti.import("../../lib/normalize.ts");
  const fileFormat = {
    role: "assistant",
    content: [{ type: "toolCall", id: "c1", name: "grep", arguments: { pattern: "x" } }],
  };
  assert.deepEqual(normalizeToolCalls(fileFormat).content[0], {
    type: "toolCall",
    toolCallId: "c1",
    toolName: "grep",
    input: { pattern: "x" },
  });

  const alreadyNormalized = {
    role: "assistant",
    content: [{ type: "toolCall", toolCallId: "c2", toolName: "bash", input: { command: "ls" } }],
  };
  assert.deepEqual(normalizeToolCalls(alreadyNormalized).content[0].toolCallId, "c2");

  const userMsg = { role: "user", content: "plain" };
  assert.equal(normalizeToolCalls(userMsg), userMsg, "non-assistant messages pass through untouched");
});

test("session fixture keeps entryIds parallel to messages (fork/navigate invariant)", () => {
  const fx = readJson("../../lib/contracts/fixtures/session-info.json");
  assert.equal(fx.sessionContext.entryIds.length, fx.sessionContext.messages.length);
  assert.ok(fx.sessionInfo.projectRoot && fx.sessionInfo.projectKey);
  assert.ok(fx.httpEnvelope.success.success === true);
  assert.ok(typeof fx.httpEnvelope.failure.code === "string");
});

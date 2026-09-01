import assert from "node:assert/strict";
import test from "node:test";
import { buildChatGroups, computeWindow, estimateGroupHeight, GroupHeightCache, VIRTUAL_OVERSCAN } from "./chat-groups.ts";

const isAnchor = (m) => m?.role === "user";

function messages(roles) {
  return roles.map((role, i) => ({ id: String(i), role, content: role === "user" ? "q" : "a".repeat(40) }));
}

// ---------------------------------------------------------------------------
// buildChatGroups
// ---------------------------------------------------------------------------

test("leading non-anchor messages become singleton groups", () => {
  const msgs = messages(["custom", "toolResult", "user", "assistant"]);
  const groups = buildChatGroups(msgs, isAnchor);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0], { startIdx: 0, endIdx: 1, userIdx: 0, finalAssistantIdx: -1, processIndices: [], tailIndices: [] });
  assert.deepEqual(groups[1], { startIdx: 1, endIdx: 2, userIdx: 1, finalAssistantIdx: -1, processIndices: [], tailIndices: [] });
  assert.equal(groups[2].startIdx, 2);
  assert.equal(groups[2].endIdx, 4);
  assert.equal(groups[2].userIdx, 2);
  assert.equal(groups[2].finalAssistantIdx, 3);
});

test("anchor group splits process/tail around the final assistant", () => {
  const msgs = messages(["user", "assistant", "assistant", "assistant", "user", "assistant"]);
  const groups = buildChatGroups(msgs, isAnchor);
  assert.equal(groups.length, 2);
  const g = groups[0];
  assert.equal(g.userIdx, 0);
  assert.equal(g.finalAssistantIdx, 3);
  assert.deepEqual(g.processIndices, [1, 2]);
  assert.deepEqual(g.tailIndices, []);
  const g2 = groups[1];
  assert.equal(g2.finalAssistantIdx, 5);
  assert.deepEqual(g2.processIndices, []);
  assert.deepEqual(g2.tailIndices, []);
});

test("group without assistant keeps all followers as process", () => {
  const msgs = messages(["user", "toolResult", "custom"]);
  const groups = buildChatGroups(msgs, isAnchor);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].finalAssistantIdx, -1);
  assert.deepEqual(groups[0].processIndices, [1, 2]);
});

test("6000-message fixture builds index quickly and groups stay bounded", () => {
  const roles = [];
  for (let i = 0; i < 6000; i++) roles.push(i % 6 === 0 ? "user" : i % 6 === 1 ? "assistant" : "toolResult");
  const msgs = messages(roles);
  const start = performance.now();
  const groups = buildChatGroups(msgs, isAnchor);
  const elapsed = performance.now() - start;
  // 1000 user anchors → ~1000 groups (singletons + anchors).
  assert.ok(groups.length >= 900 && groups.length <= 1100, `groups=${groups.length}`);
  // Index pass must be fast: no JSX, no allocation blowup.
  assert.ok(elapsed < 200, `elapsed=${elapsed}ms`);
});

// ---------------------------------------------------------------------------
// GroupHeightCache + computeWindow
// ---------------------------------------------------------------------------

function sampleLayout(groupCount, heightEach) {
  const msgs = Array.from({ length: groupCount * 2 }, (_, i) => ({ id: String(i), role: i % 2 === 0 ? "user" : "assistant", content: "x" }));
  const groups = buildChatGroups(msgs, isAnchor);
  const cache = new GroupHeightCache(groups, msgs, () => heightEach);
  return { groups, cache };
}

test("cache prefix sums and binary search locate the right group", () => {
  const { cache } = sampleLayout(10, 100);
  assert.equal(cache.totalHeight, 1000);
  const at = cache.indexAtOffset(250);
  assert.equal(at.groupIdx, 2);
  assert.equal(at.offsetInGroup, 50);
  assert.equal(cache.offsetOf(2), 200);
});

test("measurement replaces estimates and shifts offsets", () => {
  const { cache } = sampleLayout(5, 100);
  assert.equal(cache.totalHeight, 500);
  const delta = cache.measure(1, 150);
  assert.equal(delta, 50);
  assert.equal(cache.totalHeight, 550);
  assert.equal(cache.offsetOf(2), 250);
  // Idempotent re-measure.
  assert.equal(cache.measure(1, 150), 0);
  // Invalid heights ignored.
  assert.equal(cache.measure(1, -5), 0);
});

test("window covers viewport with overscan and recycles both sides", () => {
  const { cache } = sampleLayout(100, 100);
  const win = computeWindow(cache, 3000, 800, VIRTUAL_OVERSCAN);
  // Viewport [3000, 3800] → groups 30..38, plus 3 overscan each side.
  assert.equal(win.startGroup, 27);
  assert.ok(win.endGroup >= 39 && win.endGroup <= 42, `endGroup=${win.endGroup}`);
  assert.equal(win.topPad, 2700);
  assert.equal(win.bottomPad, cache.totalHeight - cache.offsetOf(win.endGroup));
});

test("window at the very top/bottom clamps correctly", () => {
  const { cache } = sampleLayout(50, 100);
  const top = computeWindow(cache, 0, 800, 3);
  assert.equal(top.startGroup, 0);
  assert.equal(top.topPad, 0);
  const bottom = computeWindow(cache, 4900, 800, 3);
  assert.equal(bottom.endGroup, 50);
  assert.equal(bottom.bottomPad, 0);
});

test("scroll beyond total clamps to the last group", () => {
  const { cache } = sampleLayout(10, 100);
  const win = computeWindow(cache, 99999, 800, 3);
  assert.equal(win.endGroup, 10);
  assert.equal(win.startGroup, 6);
  assert.equal(win.bottomPad, 0);
});

test("measure bumps revision so window consumers re-derive", () => {
  const { cache } = sampleLayout(5, 100);
  const r0 = cache.revision;
  assert.equal(cache.measure(1, 150), 50);
  assert.equal(cache.revision, r0 + 1);
  // Idempotent measure does NOT bump.
  assert.equal(cache.measure(1, 150), 0);
  assert.equal(cache.revision, r0 + 1);
});

test("measure marks the group as measured, estimates stay unmeasured", () => {
  const { cache } = sampleLayout(5, 100);
  for (let i = 0; i < 5; i++) assert.equal(cache.isMeasured(i), false);
  cache.measure(2, 220);
  assert.equal(cache.isMeasured(2), true);
  assert.equal(cache.isMeasured(1), false);
});

test("seedMeasured bulk-writes heights, marks measured, single revision bump", () => {
  const { cache } = sampleLayout(5, 100);
  const r0 = cache.revision;
  cache.seedMeasured(new Map([[1, 150], [3, 300]]));
  assert.equal(cache.revision, r0 + 1);
  assert.equal(cache.height(1), 150);
  assert.equal(cache.height(3), 300);
  assert.equal(cache.isMeasured(1), true);
  assert.equal(cache.isMeasured(3), true);
  assert.equal(cache.isMeasured(0), false);
  // Offsets and total reflect the seeded heights (prefix rebuilt once).
  assert.equal(cache.totalHeight, 500 - 100 + 150 - 100 + 300);
  assert.equal(cache.offsetOf(2), 250);
});

test("seedMeasured skips invalid values and no-ops on empty input", () => {
  const { cache } = sampleLayout(3, 100);
  const r0 = cache.revision;
  cache.seedMeasured(new Map([[0, -5], [1, Number.NaN], [2, Infinity]]));
  assert.equal(cache.revision, r0);
  assert.equal(cache.isMeasured(0), false);
  assert.equal(cache.isMeasured(1), false);
  assert.equal(cache.isMeasured(2), false);
  assert.equal(cache.totalHeight, 300);
  cache.seedMeasured(new Map());
  assert.equal(cache.revision, r0);
});

test("estimate is finite and positive for typical groups", () => {
  const msgs = messages(["user", "assistant", "assistant", "user", "toolResult"]);
  const groups = buildChatGroups(msgs, isAnchor);
  for (const g of groups) {
    const h = estimateGroupHeight(g, msgs);
    assert.ok(Number.isFinite(h) && h > 0, `height=${h}`);
  }
});

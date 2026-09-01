import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./ChatMinimap.tsx", import.meta.url), "utf8");
const chatWindowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const globalsSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("minimap nodes navigate through the ChatWindow re-anchor callback", () => {
  assert.match(source, /onNavigateGroup\?\.\(node\.groupIndex\)/);
  assert.match(source, /data-minimap-node=\{node\.groupIndex\}/);
  assert.match(source, /event\.stopPropagation\(\)/);
  // The one-shot + convergent re-anchor lives in ChatWindow, not the minimap:
  // node clicks must go through scrollToGroupForIndex so the viewport lands
  // on the cached group and re-centers after measurements settle.
  assert.match(chatWindowSource, /const scrollToGroupForIndex = useCallback/);
  assert.match(chatWindowSource, /onNavigateGroup=\{scrollToGroupForIndex\}/);
  assert.match(chatWindowSource, /pendingAnchorRef\.current = \{ kind: "bottom" \}/);
  assert.match(chatWindowSource, /kind: "group"; groupIndex/);
});

test("minimap thumb is the auto-scaling scrollbar (min height + thumb math)", () => {
  assert.match(source, /computeThumb/);
  assert.match(source, /MIN_THUMB_HEIGHT = 24/);
  assert.match(source, /thumbTopToScrollTop/);
});

test("minimap nodes stay stable via min-gap merging (no global re-sampling)", () => {
  assert.match(source, /mergeNodesByMinGap/);
  assert.doesNotMatch(source, /MAX_NODES/);
  assert.match(source, /NODE_RAIL_REFERENCE_HEIGHT = 600/);
  assert.match(source, /reported whole-right-rail rearrangement/);
});

test("tooltip opens leftward so the right-edge rail never clips it", () => {
  assert.match(source, /right: "calc\(100% \+ 8px\)"/);
  assert.doesNotMatch(source, /left: 40/);
});

test("desktop chat hides the native scrollbar on all engines", () => {
  assert.match(chatWindowSource, /chat-scroll-view/);
  assert.match(globalsSource, /\.chat-scroll-view::\-webkit\-scrollbar/);
});

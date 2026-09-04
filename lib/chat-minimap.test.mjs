import assert from "node:assert/strict";
import test from "node:test";
import { computeThumb, mergeNodesByMinGap, thumbTopToScrollTop } from "./chat-minimap.ts";

function node(topRatio) {
  return { topRatio, heightRatio: 0.01, groupIndex: Math.round(topRatio * 100) };
}

function ratios(nodes) {
  return nodes.map((n) => n.topRatio);
}

// ---------------------------------------------------------------------------
// mergeNodesByMinGap
// ---------------------------------------------------------------------------

test("merge keeps first and last node and enforces the minimum gap", () => {
  const nodes = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(node);
  const merged = mergeNodesByMinGap(nodes, 0.15);
  assert.equal(merged[0].topRatio, 0);
  assert.equal(merged[merged.length - 1].topRatio, 0.9);
  for (let i = 1; i < merged.length; i++) {
    assert.ok(merged[i].topRatio - merged[i - 1].topRatio >= 0.15 - 1e-9);
  }
  assert.deepEqual(ratios(merged), [0, 0.2, 0.4, 0.6, 0.9]);
});

test("tail node always present, replacing the previous kept node when too close", () => {
  const nodes = [0, 0.5, 0.51, 0.52].map(node);
  const merged = mergeNodesByMinGap(nodes, 0.15);
  assert.equal(merged[merged.length - 1].topRatio, 0.52);
  assert.deepEqual(ratios(merged), [0, 0.52]);
});

test("appending a tail node never re-picks the early node set", () => {
  const base = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map(node);
  const before = mergeNodesByMinGap(base, 0.15);
  const after = mergeNodesByMinGap([...base, node(0.95)], 0.15);
  const close = (a, b) => Math.abs(a - b) < 1e-9;
  for (const r of before.slice(0, -1).map((n) => n.topRatio)) {
    assert.ok(after.some((n) => close(n.topRatio, r)), `lost node ${r}`);
  }
  assert.ok(close(after[after.length - 1].topRatio, 0.95), `tail=${after[after.length - 1].topRatio}`);
});

test("merge handles empty and single-node input", () => {
  assert.deepEqual(mergeNodesByMinGap([], 0.1), []);
  const one = [node(0.5)];
  assert.deepEqual(mergeNodesByMinGap(one, 0.1), one);
});

// ---------------------------------------------------------------------------
// computeThumb
// ---------------------------------------------------------------------------

test("thumb height is proportional to the viewport share", () => {
  const t = computeThumb({ scrollTop: 250, clientHeight: 800, scrollHeight: 4000, minThumbHeight: 24 });
  assert.equal(t.height, 160); // 800²/4000
  assert.equal(t.top, 50); // 250/3200 * (800-160)
});

test("thumb clamps to the minimum height on very long content", () => {
  const t = computeThumb({ scrollTop: 0, clientHeight: 800, scrollHeight: 40000, minThumbHeight: 24 });
  assert.equal(t.height, 24);
  assert.equal(t.top, 0);
  const bottom = computeThumb({ scrollTop: 39200, clientHeight: 800, scrollHeight: 40000, minThumbHeight: 24 });
  assert.equal(bottom.top, 776); // travel = 800 - 24
});

test("thumb covers the rail when content fits", () => {
  const t = computeThumb({ scrollTop: 0, clientHeight: 800, scrollHeight: 500, minThumbHeight: 24 });
  assert.deepEqual(t, { top: 0, height: 800 });
});

// ---------------------------------------------------------------------------
// thumbTopToScrollTop
// ---------------------------------------------------------------------------

test("thumb position round-trips to the scroll offset", () => {
  const scrollable = 3200;
  const thumb = computeThumb({ scrollTop: 250, clientHeight: 800, scrollHeight: 4000, minThumbHeight: 24 });
  const back = thumbTopToScrollTop({ thumbTop: thumb.top, railHeight: 800, thumbHeight: thumb.height, scrollable });
  assert.equal(back, 250);
});

test("thumb mapping clamps to the scrollable range", () => {
  const out = thumbTopToScrollTop({ thumbTop: 99999, railHeight: 800, thumbHeight: 160, scrollable: 3200 });
  assert.equal(out, 3200);
  const neg = thumbTopToScrollTop({ thumbTop: -5, railHeight: 800, thumbHeight: 160, scrollable: 3200 });
  assert.equal(neg, 0);
  const none = thumbTopToScrollTop({ thumbTop: 10, railHeight: 800, thumbHeight: 800, scrollable: 0 });
  assert.equal(none, 0);
});

/**
 * Chat minimap geometry: positional nodes + auto-scaling thumb. Pure
 * functions, no React — unit-tested in chat-minimap.test.mjs.
 *
 * Node positions live in the GroupHeightCache coordinate space (cache
 * offsets / cache total); the thumb lives in real DOM scroll space. The two
 * spaces coincide once mounted groups are measured (cache total == real
 * scrollHeight), which the ChatWindow height-seeding keeps true in practice.
 */

/** One node on the minimap rail: geometric data only. */
export interface MinimapNode {
  /** 0–1 position of the group top within the total scroll height. */
  topRatio: number;
  /** 0–1 height share of the group. */
  heightRatio: number;
  /** Message-group index this node represents. */
  groupIndex: number;
}

/** Minimum spacing between kept nodes, as a fraction of the rail height. */
export const MINIMAP_MIN_GAP_PX = 5;

/**
 * Stable down-sampling of nodes by minimum gap. Keeps the first node, then
 * every node at least `minGapRatio` after the previous kept one, and ALWAYS
 * keeps the last node so the tail stays reachable (replacing the previous
 * kept node when the tail would violate the gap). Deterministic and
 * independent of the raw node count: unmoved content keeps the same node
 * set; appended groups only merge tail nodes gradually — no global
 * re-sampling, so nodes never visibly vanish/rearrange on scroll or append.
 */
export function mergeNodesByMinGap<T extends MinimapNode>(nodes: T[], minGapRatio: number): T[] {
  if (nodes.length <= 1) return nodes.slice();
  const kept: T[] = [nodes[0]];
  let lastTop = nodes[0].topRatio;
  for (let i = 1; i < nodes.length - 1; i++) {
    if (nodes[i].topRatio - lastTop < minGapRatio) continue;
    kept.push(nodes[i]);
    lastTop = nodes[i].topRatio;
  }
  const last = nodes[nodes.length - 1];
  if (last.topRatio - lastTop >= minGapRatio) kept.push(last);
  else if (kept.length > 1) kept[kept.length - 1] = last;
  else kept[0] = last;
  return kept;
}

export interface ThumbInput {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  minThumbHeight: number;
}

export interface ThumbGeometry {
  top: number;
  height: number;
}

/**
 * Viewport indicator ("scrollbar thumb") in rail pixels. Height is
 * proportional to the viewport share of the content, clamped to a minimum so
 * the thumb stays visible on very long transcripts; top maps scrollTop
 * linearly over the thumb travel range (railHeight − thumbHeight).
 */
export function computeThumb({ scrollTop, clientHeight, scrollHeight, minThumbHeight }: ThumbInput): ThumbGeometry {
  const scrollable = scrollHeight - clientHeight;
  if (scrollable <= 0 || clientHeight <= 0) return { top: 0, height: clientHeight };
  const height = Math.max((clientHeight * clientHeight) / scrollHeight, minThumbHeight);
  const travel = Math.max(1, clientHeight - height);
  return { top: (scrollTop / scrollable) * travel, height };
}

/** Inverse of computeThumb: the scroll offset that puts the thumb at `thumbTop`. */
export function thumbTopToScrollTop(input: { thumbTop: number; railHeight: number; thumbHeight: number; scrollable: number }): number {
  const { thumbTop, railHeight, thumbHeight, scrollable } = input;
  if (scrollable <= 0) return 0;
  const travel = Math.max(1, railHeight - thumbHeight);
  return Math.max(0, Math.min(scrollable, (thumbTop / travel) * scrollable));
}

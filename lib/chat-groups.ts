/**
 * Chat transcript virtualization (doc 14 T2.1/T2.2): message-group indexing
 * + scroll-window rendering + dynamic group-height cache.
 *
 * The transcript previously built JSX for EVERY loaded message and sliced
 * the rendered array (O(n) JSX construction, visibleCount only ever grew).
 * Here the group structure is computed once per message change (O(n) index
 * pass, no JSX), and only groups intersecting the scroll window are built.
 * Groups above/below the window are recycled as the viewport moves; the
 * scrollbar's full height comes from spacer elements fed by the height
 * cache (measured groups + estimates for unmeasured ones).
 *
 * Pure logic + injectable estimate so node:test can drive every path.
 */

export interface ChatGroup {
  /** Inclusive message range [startIdx, endIdx). */
  startIdx: number;
  endIdx: number;
  /** Anchor message index (the user message that opens the group). */
  userIdx: number;
  /** Index of the group's final assistant answer, or -1 when none. */
  finalAssistantIdx: number;
  /** Message indices strictly between userIdx and finalAssistantIdx. */
  processIndices: number[];
  /** Message indices after finalAssistantIdx (tail of the group). */
  tailIndices: number[];
}

export interface GroupEstimator {
  (group: ChatGroup, messages: unknown[]): number;
}

/** Default per-group estimate used before the group is measured. */
export function estimateGroupHeight(group: ChatGroup, messages: unknown[]): number {
  let textChars = 0;
  let images = 0;
  for (let i = group.startIdx; i < group.endIdx; i++) {
    const msg = messages[i] as { content?: unknown } | undefined;
      const content = msg?.content;
    if (typeof content === "string") {
      textChars += content.length;
    } else if (Array.isArray(content)) {
      for (const block of content as Array<{ type?: string; text?: string }>) {
        if (block.type === "text") {
          const length = typeof block.text === "string" ? block.text.length : 0;
          textChars += Number.isFinite(length) ? length : 0;
        }
        else if (block.type === "image") images += 1;
      }
    }
  }
  const count = group.endIdx - group.startIdx;
  const estimate = count * 52 + (textChars / 55) * 19 + images * 220 + 24;
  return Number.isFinite(estimate) && estimate >= 0 ? estimate : count * 52 + 24;
}

/**
 * Build the message-group index. Anchors are the user messages; every
 * message before the first anchor forms its own singleton group. O(n) pass,
 * no JSX — the expensive per-group render plan stays out of it.
 */
export function buildChatGroups(
  messages: unknown[],
  isGroupAnchor: (msg: unknown) => boolean,
): ChatGroup[] {
  const groups: ChatGroup[] = [];
  let i = 0;
  // Leading non-anchor messages (session metadata etc.) become singletons.
  while (i < messages.length && !isGroupAnchor(messages[i])) {
    groups.push({ startIdx: i, endIdx: i + 1, userIdx: i, finalAssistantIdx: -1, processIndices: [], tailIndices: [] });
    i += 1;
  }
  while (i < messages.length) {
    const userIdx = i;
    const startIdx = i;
    i += 1;
    while (i < messages.length && !isGroupAnchor(messages[i])) i += 1;
    const endIdx = i;
    // Final assistant answer = last assistant message with displayable
    // content in the group (mirrors findFinalAssistantIndex semantics at the
    // index level; the render plan itself stays in the component).
    let finalAssistantIdx = -1;
    for (let j = endIdx - 1; j >= userIdx; j--) {
      const role = (messages[j] as { role?: string })?.role;
      if (role === "assistant") { finalAssistantIdx = j; break; }
    }
    const processIndices: number[] = [];
    for (let j = userIdx + 1; j < (finalAssistantIdx === -1 ? endIdx : finalAssistantIdx); j++) {
      processIndices.push(j);
    }
    const tailIndices: number[] = [];
    for (let j = Math.max(userIdx + 1, finalAssistantIdx + 1); j < endIdx; j++) {
      tailIndices.push(j);
    }
    groups.push({ startIdx, endIdx, userIdx, finalAssistantIdx, processIndices, tailIndices });
  }
  return groups;
}

export class GroupHeightCache {
  private _heights: number[];
  private _measured: boolean[];
  private _prefix: number[];
  private _estimator: GroupEstimator;
  private _messages: unknown[];
  /** Bumped on every measurement write: consumers re-derive windows that
   * depend on prefix sums (a changed height shifts which group sits at any
   * scroll offset). */
  revision = 0;

  constructor(groups: ChatGroup[], messages: unknown[], estimator: GroupEstimator = estimateGroupHeight) {
    this._estimator = estimator;
    this._messages = messages;
    this._heights = groups.map((g) => {
      const estimate = estimator(g, messages);
      return Number.isFinite(estimate) && estimate >= 0 ? estimate : 52 + 24;
    });
    this._measured = new Array<boolean>(groups.length).fill(false);
    this._prefix = new Array<number>(groups.length + 1).fill(0);
    this._rebuildPrefix();
  }

  get totalHeight(): number {
    return this._prefix[this._prefix.length - 1];
  }

  get count(): number {
    return this._heights.length;
  }

  height(groupIdx: number): number {
    return this._heights[groupIdx];
  }

  /** Whether the height for a group came from a real measurement (or seed),
   *  not an estimate. Consumers use this to persist measured heights across
   *  cache rebuilds (seeding) instead of falling back to estimates. */
  isMeasured(groupIdx: number): boolean {
    return this._measured[groupIdx] === true;
  }

  /** Offset of a group's top edge (sum of heights before it). */
  offsetOf(groupIdx: number): number {
    return this._prefix[groupIdx];
  }

  /** Replace an estimate with a measured height; returns the delta, 0 if unchanged. */
  measure(groupIdx: number, height: number): number {
    if (groupIdx < 0 || groupIdx >= this._heights.length || !Number.isFinite(height) || height < 0) return 0;
    const delta = height - this._heights[groupIdx];
    if (Math.abs(delta) < 0.5) return 0;
    this._heights[groupIdx] = height;
    this._measured[groupIdx] = true;
    this._rebuildPrefix();
    this.revision += 1;
    return delta;
  }

  /** Bulk-write measured heights (e.g. seeded from a previous cache instance).
   *  Invalid values are skipped. Single prefix rebuild + one revision bump,
   *  unlike N individual measure() calls (O(N×G) prefix rebuilds). */
  seedMeasured(heights: ReadonlyMap<number, number>): void {
    if (heights.size === 0) return;
    let wrote = false;
    for (const [groupIdx, height] of heights) {
      if (groupIdx < 0 || groupIdx >= this._heights.length || !Number.isFinite(height) || height < 0) continue;
      this._heights[groupIdx] = height;
      this._measured[groupIdx] = true;
      wrote = true;
    }
    if (!wrote) return;
    this._rebuildPrefix();
    this.revision += 1;
  }

  /** Group containing the given scroll offset (binary search). */
  indexAtOffset(offset: number): { groupIdx: number; offsetInGroup: number } {
    if (this._heights.length === 0) return { groupIdx: 0, offsetInGroup: 0 };
    const prefix = this._prefix;
    let lo = 0;
    let hi = prefix.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (prefix[mid + 1] <= offset) lo = mid + 1;
      else hi = mid;
    }
    const groupIdx = Math.min(lo, this._heights.length - 1);
    return { groupIdx, offsetInGroup: offset - prefix[groupIdx] };
  }

  private _rebuildPrefix(): void {
    const n = this._heights.length;
    let acc = 0;
    for (let i = 0; i < n; i++) {
      this._prefix[i] = acc;
      const height = this._heights[i];
      acc += Number.isFinite(height) && height >= 0 ? height : 0;
    }
    this._prefix[n] = acc;
  }
}

export interface VirtualWindow {
  startGroup: number;
  endGroup: number; // exclusive
  topPad: number;
  bottomPad: number;
}

/**
 * Compute the group window intersecting [scrollTop, scrollTop + viewport],
 * with overscan on both sides (recycling groups above/below as the viewport
 * moves — the visibleCount window from the old implementation never shrank).
 */
export function computeWindow(
  cache: GroupHeightCache,
  scrollTop: number,
  viewportHeight: number,
  overscan = 3,
): VirtualWindow {
  const total = cache.totalHeight;
  const clamped = Math.max(0, Math.min(scrollTop, Math.max(0, total - 1)));
  const { groupIdx } = cache.indexAtOffset(clamped);
  const bottomOffset = Math.min(total, clamped + Math.max(viewportHeight, 0));
  const atBottom = clamped + Math.max(viewportHeight, 0) >= total - 1;
  const { groupIdx: endIdx } = cache.indexAtOffset(Math.max(clamped, bottomOffset - 1));
  const startGroup = Math.max(0, groupIdx - overscan);
  // At the real bottom, always include the final group. A zero-height or
  // still-settling prefix entry can make indexAtOffset under-report the end
  // index; leaving a large bottom spacer mounted then shows a blank viewport
  // even though the scrollTop is already at scrollHeight - clientHeight.
  const endGroup = atBottom ? cache.count : Math.min(cache.count, endIdx + 1 + overscan);
  return {
    startGroup,
    endGroup,
    topPad: cache.offsetOf(startGroup),
    bottomPad: Math.max(0, total - cache.offsetOf(endGroup)),
  };
}

/** Default overscan (groups rendered above/below the viewport). */
export const VIRTUAL_OVERSCAN = 3;

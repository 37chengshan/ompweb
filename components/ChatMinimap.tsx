"use client";

import { memo, useEffect, useRef, useState, useCallback, useMemo, RefObject } from "react";
import type { AgentMessage } from "@/lib/types";
import type { ChatGroup } from "@/lib/chat-groups";
import type { GroupHeightCache } from "@/lib/chat-groups";
import { computeThumb, mergeNodesByMinGap, thumbTopToScrollTop, MINIMAP_MIN_GAP_PX } from "@/lib/chat-minimap";

interface Props {
  messages: AgentMessage[];
  scrollContainer: RefObject<HTMLDivElement | null>;
  /** Message-group index (doc 14 T2.3): node positions come from the height
   *  cache, not DOM measurement — the transcript is virtualized, so only
   *  window-visible messages have DOM nodes. */
  groups: ChatGroup[];
  layout: GroupHeightCache;
  /** Bumped whenever measured heights land. The memo must re-derive nodes
   *  from it: the cache object keeps its identity, so a plain layout dep
   *  would freeze node geometry at the estimate stage forever. */
  layoutRevision: number;
  /** Node click → ChatWindow centers the group and re-anchors the viewport
   *  after the next measurement batch lands (one-shot correction). */
  onNavigateGroup?: (groupIndex: number) => void;
}

const MINIMAP_WIDTH = 36;
/** Minimum thumb height so the scrollbar stays visible on long transcripts. */
const MIN_THUMB_HEIGHT = 24;
// Node coordinates are intentionally based on a stable rail reference. The
// rail's measured height can change by a few pixels as the composer/theme
// settles; using it as a merge threshold made the visible node set change
// during navigation. A fixed reference keeps the semantic node identity and
// spacing stable while the thumb continues to follow the real scroll area.
const NODE_RAIL_REFERENCE_HEIGHT = 600;
/** Active-node highlight lock after a node click (upstream pi-web parity). */
const NAVIGATION_ACTIVE_LOCK_MS = 1600;
/** Rail height fallback until geometry is measured (first visible frame). */
const FALLBACK_RAIL_HEIGHT = 600;

function getMessagePreview(msg: AgentMessage | Partial<AgentMessage>): string {
  if (msg.role === "user") {
    if (typeof msg.content === "string") return msg.content.trim();
    const text = (msg.content as Array<{ type?: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join(" ")
      .trim();
    return text;
  }
  if (msg.role === "assistant") {
    const blocks = (msg.content as Array<{ type?: string; text?: string }>).filter((b) => b.type === "text");
    if (blocks.length === 0) return "";
    return blocks.map((b) => b.text ?? "").join(" ").trim();
  }
  return "";
}

function getNodeColor(msg: AgentMessage | Partial<AgentMessage>): { bg: string; border: string } {
  if (msg.role === "user") {
    return { bg: "color-mix(in srgb, var(--accent) 18%, transparent)", border: "color-mix(in srgb, var(--accent) 70%, transparent)" };
  }
  return { bg: "color-mix(in srgb, var(--text-dim) 12%, transparent)", border: "color-mix(in srgb, var(--text-dim) 50%, transparent)" };
}

function hasTextContent(msg: AgentMessage | Partial<AgentMessage>): boolean {
  if (msg.role === "user") return true;
  if (msg.role === "assistant") {
    const blocks = (msg.content as Array<{ type?: string; text?: string }>).filter((b) => b.type === "text");
    return blocks.some((b) => (b.text ?? "").trim().length > 0);
  }
  return false;
}

interface NodeInfo {
  topRatio: number;   // 0–1 within total scroll height (cache coordinate space)
  heightRatio: number;
  msg: AgentMessage | Partial<AgentMessage>;
  /** Index within the merged (rendered) node list. */
  index: number;
  groupIndex: number;
}

export const ChatMinimap = memo(function ChatMinimap({ messages, scrollContainer, groups, layout, layoutRevision, onNavigateGroup }: Props) {
  const [visible, setVisible] = useState(false);
  // Auto-scaling scrollbar thumb in rail pixels (computeThumb).
  const [thumb, setThumb] = useState({ top: 0, height: 0 });
  const [minimapHovered, setMinimapHovered] = useState(false);
  const [mouseYRatio, setMouseYRatio] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const dragListenersRef = useRef<{ onMove: (ev: MouseEvent) => void; onUp: () => void } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseMoveRafRef = useRef<number | null>(null);
  const pendingMouseYRef = useRef<number | null>(null);
  // Mirror of the thumb state so drag handlers never read a stale closure.
  const thumbRef = useRef(thumb);
  thumbRef.current = thumb;
  // Lock the active highlight for a moment after a node click so the node the
  // user clicked stays highlighted until the navigation settles.
  const activeLockRef = useRef<{ index: number; until: number } | null>(null);
  // Raw (pre-merge) node list + groupIndex → merged-index map, kept in refs so
  // the scroll handler can sync the active node without re-rendering nodes.
  const rawNodesRef = useRef<NodeInfo[]>([]);
  const mergedIndexByGroupRef = useRef(new Map<number, number>());

  // --- 节点 = 组（每组取首个可展示 user/assistant 消息），位置来自高度
  // 缓存（T2.3）：O(groups) 派生，无 DOM 读取。缓存空间与真实滚动空间在
  // 挂载组实测后重合（ChatWindow 高度播种保证稳态一致）。超过最小像素
  // 间距的节点按稳定规则合并（mergeNodesByMinGap），内容不变时节点集合
  // 不变——滚动/追加不再让节点消失或重排。---
  const nodes = useMemo<NodeInfo[]>(() => {
    const total = layout.totalHeight;
    if (total <= 0) return [];
    const raw: NodeInfo[] = [];
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g];
      let msg: AgentMessage | null = null;
      for (let i = group.startIdx; i < group.endIdx; i++) {
        const candidate = messages[i];
        if ((candidate.role === "user" || candidate.role === "assistant") && hasTextContent(candidate)) {
          msg = candidate;
          break;
        }
      }
      if (!msg) continue;
      raw.push({
        topRatio: layout.offsetOf(g) / total,
        heightRatio: Math.max(layout.height(g) / total, 0.001),
        msg,
        index: raw.length,
        groupIndex: g,
      });
    }
    rawNodesRef.current = raw;
    if (raw.length <= 1) {
      mergedIndexByGroupRef.current = new Map(raw.map((n, i) => [n.groupIndex, i]));
      return raw;
    }
    const merged = mergeNodesByMinGap(raw, MINIMAP_MIN_GAP_PX / NODE_RAIL_REFERENCE_HEIGHT).map((node, i) => ({ ...node, index: i }));
    mergedIndexByGroupRef.current = new Map(merged.map((n, i) => [n.groupIndex, i]));
    return merged;
  // Do not depend on layoutRevision or measured rail geometry here.
  // ResizeObserver measurements replace estimates in GroupHeightCache after a
  // minimap node click; re-deriving ratios at that moment is the source of the
  // reported whole-right-rail rearrangement. ChatWindow still uses the live
  // cache for accurate scrolling, while this rail remains a stable semantic
  // index until the message/group structure itself changes.
  }, [groups, layout, messages]);

  const nodeColors = useMemo(() => nodes.map((node) => getNodeColor(node.msg)), [nodes]);
  const nodePreviews = useMemo(() => nodes.map((node) => getMessagePreview(node.msg)), [nodes]);

  // --- 当前位置：active 节点 + thumb（无 DOM 节点读取）---
  const syncActiveNode = useCallback((scrollEl: HTMLDivElement) => {
    const lock = activeLockRef.current;
    if (lock && Date.now() < lock.until) {
      setActiveIndex(lock.index);
      return;
    }
    activeLockRef.current = null;
    const raw = rawNodesRef.current;
    if (raw.length === 0) {
      setActiveIndex(null);
      return;
    }
    // 阅读焦点 = 视口 30% 处（上游 pi-web 同款）；取原始节点列表中
    // 距离焦点最近的组（merged 索引经 groupIndex 映射）。
    const total = layout.totalHeight;
    const focus = scrollEl.scrollTop + scrollEl.clientHeight * 0.3;
    let best = raw[0];
    let bestDist = Math.abs(best.topRatio * total - focus);
    for (let i = 1; i < raw.length; i++) {
      const dist = Math.abs(raw[i].topRatio * total - focus);
      if (dist < bestDist) {
        bestDist = dist;
        best = raw[i];
      }
    }
    setActiveIndex(mergedIndexByGroupRef.current.get(best.groupIndex) ?? null);
  }, [layout]);

  const updateScroll = useCallback(() => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const totalH = scrollEl.scrollHeight;
    const clientH = scrollEl.clientHeight;
    const scrollable = totalH - clientH;
    setVisible(scrollable > 20);
    setThumb((prev) => {
      const next = computeThumb({ scrollTop: scrollEl.scrollTop, clientHeight: clientH, scrollHeight: totalH, minThumbHeight: MIN_THUMB_HEIGHT });
      return prev.top === next.top && prev.height === next.height ? prev : next;
    });
    syncActiveNode(scrollEl);
  }, [scrollContainer, syncActiveNode]);

  const scrollRafRef = useRef<number | null>(null);
  const flushScroll = useCallback(() => {
    scrollRafRef.current = null;
    updateScroll();
  }, [updateScroll]);
  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    const onScroll = () => {
      if (scrollRafRef.current === null) {
        scrollRafRef.current = requestAnimationFrame(flushScroll);
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [scrollContainer, flushScroll]);

  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    const syncLayout = () => updateScroll();
    const ro = new ResizeObserver(syncLayout);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    const onResize = () => syncLayout();
    window.addEventListener("resize", onResize);
    syncLayout();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [scrollContainer, updateScroll]);

  // New messages / measured group heights shift the layout — resync ratios.
  useEffect(() => {
    const t = setTimeout(updateScroll, 50);
    return () => clearTimeout(t);
  }, [nodes, layoutRevision, messages.length, updateScroll]);

  useEffect(() => () => {
    if (mouseMoveRafRef.current !== null) {
      cancelAnimationFrame(mouseMoveRafRef.current);
      mouseMoveRafRef.current = null;
    }
  }, []);

  // --- 拖拽 thumb（滚动条逻辑）---
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!visible) return;
    const el = scrollContainer.current;
    if (!el) return;
    draggingRef.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    const railHeight = rect.height;
    const t = thumbRef.current;
    const clickY = e.clientY - rect.top;
    // 抓取点在 thumb 内则保持相对偏移，否则把 thumb 中心移到点击处。
    const grabOffset = clickY - t.top;
    const insideThumb = grabOffset >= 0 && grabOffset <= t.height;
    const offset = insideThumb ? grabOffset : t.height / 2;
    const applyPointer = (clientY: number) => {
      const scrollable = el.scrollHeight - el.clientHeight;
      if (scrollable <= 0) return;
      const current = thumbRef.current;
      const thumbTop = Math.max(0, Math.min(railHeight - current.height, clientY - rect.top - offset));
      el.scrollTop = thumbTopToScrollTop({ thumbTop, railHeight, thumbHeight: current.height, scrollable });
      // 程序化滚动不保证触发原生 scroll 事件；主动派发让 ChatWindow 的
      // onScroll 同步虚拟窗口 state（虚拟化依赖 state 决定挂载哪些组）。
      el.dispatchEvent(new Event("scroll"));
      updateScroll();
    };
    applyPointer(e.clientY);
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      applyPointer(ev.clientY);
    };
    const onUp = () => {
      draggingRef.current = false;
      dragListenersRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onUp, { once: true });
    dragListenersRef.current = { onMove, onUp };
  }, [visible, scrollContainer, updateScroll]);

  useEffect(() => () => {
    const listeners = dragListenersRef.current;
    if (listeners) {
      window.removeEventListener("mousemove", listeners.onMove);
      window.removeEventListener("mouseup", listeners.onUp);
      window.removeEventListener("blur", listeners.onUp);
      dragListenersRef.current = null;
    }
    draggingRef.current = false;
  }, []);

  const flushMouseMove = useCallback(() => {
    mouseMoveRafRef.current = null;
    if (pendingMouseYRef.current !== null) {
      setMouseYRatio(pendingMouseYRef.current);
      pendingMouseYRef.current = null;
    }
  }, []);
  const handleMinimapMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pendingMouseYRef.current = (e.clientY - rect.top) / rect.height;
    if (mouseMoveRafRef.current === null) {
      mouseMoveRafRef.current = requestAnimationFrame(flushMouseMove);
    }
  }, [flushMouseMove]);

  if (!visible) return null;

  // 最近节点（悬停时只渲染这一个 tooltip——T2.3，删除全节点碰撞处理）。
  const nearestIndex = mouseYRatio !== null && nodes.length > 0
    ? nodes.reduce((best, node) => {
        return Math.abs(node.topRatio - mouseYRatio) < Math.abs(nodes[best].topRatio - mouseYRatio) ? node.index : best;
      }, 0)
    : null;

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setMinimapHovered(true)}
      onMouseLeave={() => { setMinimapHovered(false); setMouseYRatio(null); }}
      onMouseMove={handleMinimapMouseMove}
      style={{
        width: MINIMAP_WIDTH,
        flexShrink: 0,
        position: "absolute",
        top: 0,
        bottom: 0,
        right: 0,
        cursor: draggingRef.current ? "grabbing" : "grab",
        userSelect: "none",
        borderLeft: "1px solid var(--border)",
        background: "var(--bg-panel)",
        overflow: "visible",
      }}
    >
      {/* Auto-scaling scrollbar thumb (viewport indicator) */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          transform: `translate3d(-50%, ${thumb.top}px, 0)`,
          width: 12,
          top: 0,
          height: thumb.height,
          minHeight: MIN_THUMB_HEIGHT,
          borderRadius: 6,
          background: "color-mix(in srgb, var(--text-dim) 28%, transparent)",
          border: "1px solid color-mix(in srgb, var(--text-dim) 45%, transparent)",
          pointerEvents: "none",
          zIndex: 1,
          willChange: "transform",
        }}
      />

      {/* Message nodes (min-gap merged, tail always present) */}
      {nodes.map((node) => {
        const color = nodeColors[node.index] ?? getNodeColor(node.msg);
        const isNearest = minimapHovered && nearestIndex === node.index;
        const isActive = activeIndex === node.index;
        const isUser = node.msg.role === "user";
        const dotTop = node.topRatio * 100;

        return (
          <div
            key={node.groupIndex}
            data-minimap-node={node.groupIndex}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              activeLockRef.current = { index: node.index, until: Date.now() + NAVIGATION_ACTIVE_LOCK_MS };
              setActiveIndex(node.index);
              onNavigateGroup?.(node.groupIndex);
            }}
            style={{
              position: "absolute",
              top: `${dotTop}%`,
              transform: "translateY(-50%)",
              left: 0,
              right: 0,
              height: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              zIndex: 2,
            }}
          >
            {/* Dot */}
            <div
              style={{
                width: isUser ? 8 : 6,
                height: isUser ? 8 : 6,
                borderRadius: isUser ? 2 : "50%",
                background: isActive ? color.border : color.bg,
                border: `1.5px solid ${color.border}`,
                boxShadow: isActive ? "0 0 0 2px var(--bg-panel)" : "none",
                flexShrink: 0,
                transition: "transform var(--dur-fast) var(--ease-out-warm)",
                transform: isNearest ? "scale(1.6)" : "scale(1)",
              }}
            />
          </div>
        );
      })}

      {/* Center line */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          bottom: 0,
          width: 1,
          background: "var(--border)",
          transform: "translateX(-50%)",
          zIndex: 0,
        }}
      />

      {/* Tooltip: only the node nearest the cursor (T2.3). Opens to the LEFT
          of the rail — the rail sits at the chat column's right edge, so a
          rightward tooltip would be clipped (left:40 was that bug). */}
      {minimapHovered && nearestIndex !== null && nodes[nearestIndex] && (() => {
        const node = nodes[nearestIndex];
        const preview = nodePreviews[nearestIndex] ?? getMessagePreview(node.msg);
        if (!preview) return null;
        const color = nodeColors[nearestIndex] ?? getNodeColor(node.msg);
        const railHeight = containerRef.current?.clientHeight ?? FALLBACK_RAIL_HEIGHT;
        const tooltipTop = Math.max(2, Math.min(
          railHeight - 30,
          node.topRatio * railHeight - 11,
        ));
        return (
          <div
            key="minimap-tooltip"
            style={{
              position: "absolute",
              left: "auto",
              right: "calc(100% + 8px)",
              top: tooltipTop,
              zIndex: 5,
              maxWidth: 280,
              padding: "6px 10px",
              borderRadius: "var(--radius-control)",
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow-pop)",
              transition: "top var(--dur-fast) var(--ease-out-warm), opacity var(--dur-fast) var(--ease-out-warm)",
              fontSize: 11,
              lineHeight: 1.45,
              color: "var(--text-muted)",
              whiteSpace: "pre-wrap",
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 4,
              WebkitBoxOrient: "vertical",
              pointerEvents: "none",
            }}
          >
            <span style={{ color: color.border, fontWeight: 600, marginRight: 6 }}>
              {node.msg.role === "user" ? "Q" : "A"}
            </span>
            {preview}
          </div>
        );
      })()}
    </div>
  );
});

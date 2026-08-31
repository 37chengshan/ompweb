"use client";

import { memo, useEffect, useRef, useState, useCallback, useMemo, RefObject } from "react";
import type { AgentMessage } from "@/lib/types";
import type { ChatGroup } from "@/lib/chat-groups";
import type { GroupHeightCache } from "@/lib/chat-groups";

interface Props {
  messages: AgentMessage[];
  scrollContainer: RefObject<HTMLDivElement | null>;
  /** Message-group index (doc 14 T2.3): node positions come from the height
   *  cache, not DOM measurement — the transcript is virtualized, so only
   *  window-visible messages have DOM nodes. */
  groups: ChatGroup[];
  layout: GroupHeightCache;
}

const MINIMAP_WIDTH = 36;
/** Render cap (doc 14 T2.3): sample when the group count exceeds this. */
const MAX_NODES = 200;

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
  topRatio: number;   // 0–1 within total scroll height
  heightRatio: number;
  msg: AgentMessage | Partial<AgentMessage>;
  index: number;
}

export const ChatMinimap = memo(function ChatMinimap({ messages, scrollContainer, groups, layout }: Props) {
  const [visible, setVisible] = useState(false);
  const [scrollRatio, setScrollRatio] = useState(0);
  const [viewportRatio, setViewportRatio] = useState(1);
  const [minimapHovered, setMinimapHovered] = useState(false);
  const [mouseYRatio, setMouseYRatio] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const dragListenersRef = useRef<{ onMove: (ev: MouseEvent) => void; onUp: () => void } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseMoveRafRef = useRef<number | null>(null);
  const pendingMouseYRef = useRef<number | null>(null);

  // --- 节点 = 组（每组取首个可展示 user/assistant 消息），位置来自高度
  // 缓存（T2.3）：O(groups) 派生，无 DOM 读取；超过上限按像素均匀抽样。---
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
      });
    }
    if (raw.length <= MAX_NODES) return raw;
    const step = raw.length / MAX_NODES;
    const sampled: NodeInfo[] = [];
    for (let i = 0; i < raw.length; i += step) {
      const node = raw[Math.floor(i)];
      sampled.push({ ...node, index: sampled.length });
    }
    return sampled;
  }, [groups, layout, messages]);

  const nodeColors = useMemo(() => nodes.map((node) => getNodeColor(node.msg)), [nodes]);
  const nodePreviews = useMemo(() => nodes.map((node) => getMessagePreview(node.msg)), [nodes]);

  // --- 视口比例（无 DOM 节点读取）---
  const updateScroll = useCallback(() => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const totalH = scrollEl.scrollHeight;
    const clientH = scrollEl.clientHeight;
    const scrollable = totalH - clientH;
    setVisible(scrollable > 20);
    if (scrollable <= 0) {
      setScrollRatio(0);
      setViewportRatio(1);
    } else {
      setScrollRatio(scrollEl.scrollTop / scrollable);
      setViewportRatio(clientH / totalH);
    }
  }, [scrollContainer]);

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
    syncLayout();
    return () => ro.disconnect();
  }, [scrollContainer, updateScroll]);

  // New messages / measured group heights shift the layout — resync ratios.
  useEffect(() => {
    const t = setTimeout(updateScroll, 50);
    return () => clearTimeout(t);
  }, [nodes, updateScroll]);

  useEffect(() => () => {
    if (mouseMoveRafRef.current !== null) {
      cancelAnimationFrame(mouseMoveRafRef.current);
      mouseMoveRafRef.current = null;
    }
  }, []);

  const scrollToMinimapRatio = useCallback((viewportTopRatio: number) => {
    const el = scrollContainer.current;
    if (!el) return;
    const scrollable = el.scrollHeight - el.clientHeight;
    if (scrollable <= 0) return;
    const clamped = Math.max(0, Math.min(1 - viewportRatio, viewportTopRatio));
    el.scrollTop = (clamped / (1 - viewportRatio)) * scrollable;
  }, [scrollContainer, viewportRatio]);

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

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!visible) return;

    draggingRef.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickRatio = (e.clientY - rect.top) / rect.height;
    const grabOffset = clickRatio - scrollRatio * (1 - viewportRatio);
    const insideBox = grabOffset >= 0 && grabOffset <= viewportRatio;
    const offset = insideBox ? grabOffset : viewportRatio / 2;

    scrollToMinimapRatio(clickRatio - offset);

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const r = (ev.clientY - rect.top) / rect.height;
      scrollToMinimapRatio(r - offset);
    };
    const onUp = () => {
      draggingRef.current = false;
      dragListenersRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    dragListenersRef.current = { onMove, onUp };
  }, [visible, viewportRatio, scrollRatio, scrollToMinimapRatio]);

  useEffect(() => () => {
    const listeners = dragListenersRef.current;
    if (listeners) {
      window.removeEventListener("mousemove", listeners.onMove);
      window.removeEventListener("mouseup", listeners.onUp);
      dragListenersRef.current = null;
    }
    draggingRef.current = false;
  }, []);

  if (!visible) return null;

  const viewportBoxTop = scrollRatio * (1 - viewportRatio) * 100;
  const viewportBoxHeight = viewportRatio * 100;

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
        position: "relative",
        cursor: "default",
        userSelect: "none",
        borderLeft: "1px solid var(--border)",
        background: "var(--bg-panel)",
        overflow: "visible",
      }}
    >
      {/* Viewport indicator */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: `${viewportBoxTop}%`,
          height: `${viewportBoxHeight}%`,
          background: "color-mix(in srgb, var(--text-dim) 10%, transparent)",
          borderTop: "1px solid color-mix(in srgb, var(--text-dim) 20%, transparent)",
          borderBottom: "1px solid color-mix(in srgb, var(--text-dim) 20%, transparent)",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      {/* Message nodes (sampled ≤ MAX_NODES) */}
      {nodes.map((node) => {
        const color = nodeColors[node.index] ?? getNodeColor(node.msg);
        const isNearest = minimapHovered && nearestIndex === node.index;
        const isUser = node.msg.role === "user";
        const dotTop = node.topRatio * 100;

        return (
          <div
            key={node.index}
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
                background: color.bg,
                border: `1.5px solid ${color.border}`,
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

      {/* Tooltip: only the node nearest the cursor (T2.3) */}
      {minimapHovered && nearestIndex !== null && nodes[nearestIndex] && (() => {
        const node = nodes[nearestIndex];
        const preview = nodePreviews[nearestIndex] ?? getMessagePreview(node.msg);
        if (!preview) return null;
        const color = nodeColors[nearestIndex] ?? getNodeColor(node.msg);
        const tooltipTop = Math.max(2, Math.min(
          containerRef.current ? containerRef.current.clientHeight - 30 : 200,
          node.topRatio * (containerRef.current?.clientHeight ?? 600) - 11,
        ));
        return (
          <div
            key={`tt-${node.index}`}
            style={{
              position: "absolute",
              left: 40,
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

"use client";

import type { ResizeHandleKind } from "@/hooks/useResizableDialog";
import { GripVertical } from "lucide-react";

/** Drag handles along the dialog's right/bottom edges + corner.  The narrow
 *  edge remains easy to grab, while the small visible grip teaches the resize
 *  affordance without adding another toolbar button. */
export function ResizeHandles({ onPointerDown, onPointerMove, onPointerUp, isResizing = false }: {
  onPointerDown: (kind: ResizeHandleKind) => (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  isResizing?: boolean;
}) {
  const handle = (kind: ResizeHandleKind) => ({
    onPointerDown: onPointerDown(kind),
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onLostPointerCapture: onPointerUp,
    "data-resize": kind,
  });
  return (
    <>
      {/* Right edge */}
      <div
        {...handle("right")}
        title="拖拽调整设置窗口宽度"
        aria-label="拖拽调整设置窗口宽度"
        style={{
          position: "absolute", top: 0, right: 0, bottom: 0, width: 14,
          cursor: "ew-resize", touchAction: "none", zIndex: 20,
          background: isResizing ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
        }}
      >
        <span aria-hidden="true" style={{ position: "absolute", top: "50%", right: 2, display: "inline-flex", transform: "translateY(-50%)", color: "var(--text-dim)", opacity: isResizing ? 0.9 : 0.6, pointerEvents: "none", transition: "opacity var(--dur-fast) var(--ease-out-warm)" }}>
          <GripVertical size={16} strokeWidth={2} />
        </span>
      </div>
      {/* Bottom edge */}
      <div
        {...handle("bottom")}
        title="拖拽调整设置窗口高度"
        aria-label="拖拽调整设置窗口高度"
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0, height: 7,
          cursor: "ns-resize", touchAction: "none", zIndex: 20,
        }}
      />
      {/* Bottom-right corner */}
      <div
        {...handle("corner")}
        title="拖拽调整设置窗口大小"
        aria-label="拖拽调整设置窗口大小"
        style={{
          position: "absolute", right: 0, bottom: 0, width: 18, height: 18,
          cursor: "nwse-resize", touchAction: "none", zIndex: 21,
        }}
      />
    </>
  );
}

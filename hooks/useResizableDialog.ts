// Resizable dialog hook: width/height state (persisted), pointer-driven drag
// handles for the right edge, bottom edge, and bottom-right corner. Kept
// framework-light and testable: the math is pure, only pointer wiring is DOM.

import { useCallback, useEffect, useRef, useState } from "react";

export interface DialogSize {
  width: number;
  height: number;
}

const STORAGE_KEY = "omp-settings-dialog-size";
/** Lower bound so content never collapses below usable form rows. */
export const MIN_DIALOG_WIDTH = 560;
export const MIN_DIALOG_HEIGHT = 400;

function clampSize(width: number, height: number, viewport: { w: number; h: number }): DialogSize {
  return {
    width: Math.min(Math.max(width, MIN_DIALOG_WIDTH), viewport.w - 16),
    height: Math.min(Math.max(height, MIN_DIALOG_HEIGHT), viewport.h - 16),
  };
}

function loadInitial(view: { w: number; h: number }): DialogSize {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { width?: unknown; height?: unknown };
      if (typeof parsed.width === "number" && typeof parsed.height === "number") {
        return clampSize(parsed.width, parsed.height, view);
      }
    }
  } catch {
    // Missing/corrupt storage → defaults below.
  }
  // Defaults mirror the pre-resize dialog: 940px wide, 82vh tall.
  return { width: Math.min(940, view.w - 16), height: Math.min(Math.round(view.h * 0.82), view.h - 16) };
}

export type ResizeHandleKind = "right" | "bottom" | "corner";

export function useResizableDialog() {
  const [size, setSize] = useState<DialogSize>(() => {
    if (typeof window === "undefined") return { width: 940, height: 600 };
    return loadInitial({ w: window.innerWidth, h: window.innerHeight });
  });
  const dragRef = useRef<{ kind: ResizeHandleKind; startX: number; startY: number; startSize: DialogSize } | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  // Persist on drag end only: writing localStorage on every pointermove (the
  // effect below used to fire per state change) stalls low-end drags on the
  // synchronous storage write. The last committed size is written by onUp.
  const latestSizeRef = useRef(size);
  latestSizeRef.current = size;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const persist = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(latestSizeRef.current));
      } catch {
        // Private mode: resizing still works for the session, just not persisted.
      }
    };
    // A drag that never fires pointerup (blur/alt-tab) still lands via the
    // visibility change, matching the previous per-change persistence cadence.
    window.addEventListener("pointerup", persist);
    window.addEventListener("pointercancel", persist);
    document.addEventListener("visibilitychange", persist);
    return () => {
      window.removeEventListener("pointerup", persist);
      window.removeEventListener("pointercancel", persist);
      document.removeEventListener("visibilitychange", persist);
    };
  }, []);

  const onPointerDown = useCallback((kind: ResizeHandleKind) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { kind, startX: e.clientX, startY: e.clientY, startSize: size };
    setIsResizing(true);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture?.(e.pointerId);
  }, [size]);

  const applyPointerMove = useCallback((clientX: number, clientY: number) => {
    const drag = dragRef.current;
    if (!drag || typeof window === "undefined") return;
    const dx = clientX - drag.startX;
    const dy = clientY - drag.startY;
    const next = { ...drag.startSize };
    if (drag.kind === "right" || drag.kind === "corner") next.width = drag.startSize.width + dx;
    if (drag.kind === "bottom" || drag.kind === "corner") next.height = drag.startSize.height + dy;
    setSize(clampSize(next.width, next.height, { w: window.innerWidth, h: window.innerHeight }));
  }, []);

  const finishResize = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onMove = (e: PointerEvent) => {
      applyPointerMove(e.clientX, e.clientY);
    };
    const onUp = () => finishResize();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [applyPointerMove, finishResize]);

  // The capture handlers provide the primary path. The window listeners
  // above remain as a fallback if a portal repaint drops pointer capture.
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    applyPointerMove(e.clientX, e.clientY);
  }, [applyPointerMove]);
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture?.(e.pointerId)) target.releasePointerCapture?.(e.pointerId);
    finishResize();
  }, [finishResize]);

  return { size, isResizing, onPointerDown, onPointerMove, onPointerUp };
}

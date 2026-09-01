"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BOOT_SKELETON_READY_EVENT,
  type BootSkeletonDismissOptions,
  getPendingBootSkeletonDismissal,
} from "@/lib/boot-skeleton";

/**
 * The boot overlay lives in the React tree so React remains the sole owner of
 * its DOM node. AppShell (and the small standalone routes) signal dismissal
 * through lib/boot-skeleton.ts; they must never remove this body child with a
 * native DOM call, because the root layout may still reconcile around it.
 */
export function BootSkeleton() {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);
  const removeTimerRef = useRef<number | null>(null);

  const dismiss = useCallback((options?: BootSkeletonDismissOptions) => {
    if (removeTimerRef.current !== null) {
      window.clearTimeout(removeTimerRef.current);
      removeTimerRef.current = null;
    }

    if (!options?.fade) {
      setFading(false);
      setVisible(false);
      return;
    }

    setFading(true);
    removeTimerRef.current = window.setTimeout(() => {
      removeTimerRef.current = null;
      setVisible(false);
    }, 170);
  }, []);

  useEffect(() => {
    const onReady = (event: Event) => {
      dismiss((event as CustomEvent<BootSkeletonDismissOptions>).detail);
    };
    window.addEventListener(BOOT_SKELETON_READY_EVENT, onReady);

    // An AppShell effect can signal readiness before this component's passive
    // effect has subscribed during a fast hydration. Retain that signal so
    // the overlay cannot get stuck in that ordering.
    const pending = getPendingBootSkeletonDismissal();
    if (pending) dismiss(pending);

    return () => {
      window.removeEventListener(BOOT_SKELETON_READY_EVENT, onReady);
      if (removeTimerRef.current !== null) window.clearTimeout(removeTimerRef.current);
    };
  }, [dismiss]);

  if (!visible) return null;

  return (
    <div
      id="boot-skeleton"
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "var(--bg, #faf9f6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-dim, #8a867e)",
        fontSize: 13,
        fontFamily: "system-ui, sans-serif",
        opacity: fading ? 0 : 1,
        pointerEvents: fading ? "none" : "auto",
        transition: "opacity var(--dur-fast, 150ms) var(--ease-out-warm, ease-out)",
      }}
    >
      正在启动…
    </div>
  );
}

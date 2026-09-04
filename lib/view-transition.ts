"use client";

/**
 * Executes a state update with a native View Transition when supported.
 * Falls back to an immediate synchronous callback if the browser does not
 * support View Transitions, if the user requested reduced motion, or if
 * master animations are disabled.
 */
export function transitionView(updateCallback: () => void | Promise<void>): void {
  if (typeof document === "undefined") {
    void updateCallback();
    return;
  }

  const reduceMotion = typeof window !== "undefined"
    && window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animationsDisabled = document.documentElement.getAttribute("data-animations") === "false";

  const supportsViewTransition = typeof document.startViewTransition === "function";

  if (!supportsViewTransition || reduceMotion || animationsDisabled) {
    void updateCallback();
    return;
  }

  try {
    document.startViewTransition(() => {
      return updateCallback();
    });
  } catch {
    // If startViewTransition throws synchronously in an exotic runtime, degrade gracefully.
    void updateCallback();
  }
}

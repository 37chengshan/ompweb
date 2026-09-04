"use client";

import { useEffect, useState } from "react";
import { useMotionPrefs } from "./useMotionPrefs";

/** Tracks the OS "reduce motion" preference or app-level animation disabled;
 *  used to disable SMIL animations that CSS `prefers-reduced-motion` rules cannot stop. */
export function usePrefersReducedMotion(): boolean {
  const [osReduced, setOsReduced] = useState(false);
  const { motionPrefs } = useMotionPrefs();

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setOsReduced(mql.matches);
    const onChange = (event: MediaQueryListEvent) => setOsReduced(event.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return osReduced || !motionPrefs.enabled;
}

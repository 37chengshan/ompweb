"use client";

import { useEffect, useState, useRef } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

interface Props {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  formatter?: (val: number) => string;
}

export function CountUpNumber({
  value,
  duration = 750,
  decimals = 0,
  prefix = "",
  suffix = "",
  formatter,
}: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const [displayValue, setDisplayValue] = useState(reducedMotion ? value : 0);
  const prevValRef = useRef(reducedMotion ? value : 0);
  const startTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (reducedMotion) {
      setDisplayValue(value);
      prevValRef.current = value;
      return;
    }

    const startVal = prevValRef.current;
    const endVal = value;
    startTimeRef.current = null;

    const animate = (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const progress = Math.min((timestamp - startTimeRef.current) / duration, 1);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = startVal + (endVal - startVal) * ease;
      setDisplayValue(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayValue(endVal);
        prevValRef.current = endVal;
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      prevValRef.current = endVal;
    };
  }, [value, duration, reducedMotion]);

  if (formatter) {
    return <>{prefix}{formatter(displayValue)}{suffix}</>;
  }

  const formatted = decimals > 0
    ? displayValue.toFixed(decimals)
    : Math.round(displayValue).toLocaleString();

  return <>{prefix}{formatted}{suffix}</>;
}

"use client";

import { useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

export interface StackSegment {
  label: string;
  value: number;
  color: string;
}

interface Props {
  segments: StackSegment[];
  height?: number;
  valueFormatter?: (val: number) => string;
}

export function SvgStackedBarChart({
  segments,
  height = 16,
  valueFormatter = (v) => v.toLocaleString(),
}: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const total = segments.reduce((acc, seg) => acc + (seg.value > 0 ? seg.value : 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
      {/* Stacked bar rail */}
      <div
        style={{
          display: "flex",
          width: "100%",
          height,
          borderRadius: height / 2,
          overflow: "hidden",
          background: "var(--border)",
          boxShadow: "inset 0 1px 2px rgba(0,0,0,0.1)",
        }}
      >
        {segments.map((seg, idx) => {
          if (seg.value <= 0 || total <= 0) return null;
          const pct = (seg.value / total) * 100;
          const isHovered = hoveredIndex === idx;

          return (
            <div
              key={idx}
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
              style={{
                width: `${pct}%`,
                height: "100%",
                background: seg.color,
                transition: reducedMotion
                  ? "none"
                  : "width 0.6s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease, filter 0.2s ease",
                opacity: hoveredIndex !== null && !isHovered ? 0.5 : 1,
                cursor: "pointer",
                filter: isHovered ? "brightness(1.15)" : "none",
              }}
              title={`${seg.label}: ${valueFormatter(seg.value)} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>

      {/* Segment legend below */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        {segments.map((seg, idx) => {
          const pct = total > 0 ? ((seg.value / total) * 100).toFixed(1) : "0";
          const isHovered = hoveredIndex === idx;

          return (
            <div
              key={idx}
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                cursor: "pointer",
                opacity: hoveredIndex !== null && !isHovered ? 0.45 : 1,
                transition: "opacity var(--dur-fast) var(--ease-out-warm)",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: seg.color,
                  flexShrink: 0,
                }}
              />
              <span style={{ color: "var(--text-muted)" }}>{seg.label}:</span>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text)" }}>
                {valueFormatter(seg.value)}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)" }}>
                ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

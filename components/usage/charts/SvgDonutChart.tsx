"use client";

import { useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

export interface DonutItem {
  label: string;
  value: number;
  color: string;
  sublabel?: string;
  count?: number;
}

interface Props {
  items: DonutItem[];
  size?: number;
  thickness?: number;
  title?: string;
  centerTitle?: string;
  valueFormatter?: (val: number) => string;
}

const DEFAULT_PALETTE = [
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#f97316", // Orange
  "#6366f1", // Indigo
];

export function SvgDonutChart({
  items,
  size = 180,
  thickness = 24,
  title,
  centerTitle,
  valueFormatter = (v) => v.toLocaleString(),
}: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const total = items.reduce((acc, item) => acc + (item.value > 0 ? item.value : 0), 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  let accumulatedPercent = 0;
  const slices = items.map((item, idx) => {
    const fraction = total > 0 ? Math.max(0, item.value) / total : 0;
    const strokeDasharray = `${fraction * circumference} ${circumference}`;
    const strokeDashoffset = -accumulatedPercent * circumference;
    accumulatedPercent += fraction;

    const color = item.color || DEFAULT_PALETTE[idx % DEFAULT_PALETTE.length];
    return {
      ...item,
      fraction,
      percent: Math.round(fraction * 1000) / 10,
      strokeDasharray,
      strokeDashoffset,
      color,
    };
  });

  const activeItem = hoveredIndex !== null ? slices[hoveredIndex] : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: "16px",
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      {title && (
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {title}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap", justifyContent: "center" }}>
        <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            style={{ transform: "rotate(-90deg)", overflow: "visible" }}
          >
            {/* Background empty ring */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="var(--border)"
              strokeWidth={thickness}
              opacity={0.3}
            />

            {slices.map((slice, idx) => {
              if (slice.fraction <= 0) return null;
              const isHovered = hoveredIndex === idx;
              return (
                <circle
                  key={idx}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={isHovered ? thickness + 4 : thickness}
                  strokeDasharray={slice.strokeDasharray}
                  strokeDashoffset={slice.strokeDashoffset}
                  style={{
                    cursor: "pointer",
                    transition: reducedMotion
                      ? "none"
                      : "stroke-width 0.2s ease, opacity 0.2s ease, filter 0.2s ease",
                    opacity: hoveredIndex !== null && !isHovered ? 0.45 : 1,
                    filter: isHovered ? `drop-shadow(0 0 8px ${slice.color}66)` : "none",
                  }}
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                />
              );
            })}
          </svg>

          {/* Center text readout */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              padding: 10,
              textAlign: "center",
            }}
          >
            <span style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {activeItem ? activeItem.label : (centerTitle ?? "Total")}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 16,
                fontWeight: 700,
                color: "var(--text)",
                marginTop: 2,
              }}
            >
              {activeItem ? valueFormatter(activeItem.value) : valueFormatter(total)}
            </span>
            {activeItem && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: activeItem.color, fontWeight: 600, marginTop: 1 }}>
                {activeItem.percent}%
              </span>
            )}
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 160 }}>
          {slices.map((slice, idx) => {
            const isHovered = hoveredIndex === idx;
            return (
              <div
                key={idx}
                onMouseEnter={() => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex(null)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "4px 8px",
                  borderRadius: "var(--radius-control)",
                  background: isHovered ? "var(--bg-hover)" : "transparent",
                  cursor: "pointer",
                  transition: "background var(--dur-fast) var(--ease-out-warm)",
                  opacity: hoveredIndex !== null && !isHovered ? 0.45 : 1,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: slice.color,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={slice.label}
                  >
                    {slice.label}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "var(--text)" }}>
                    {valueFormatter(slice.value)}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", minWidth: 32, textAlign: "right" }}>
                    {slice.percent}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

"use client";

import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

interface Props {
  fraction: number; // 0 to 1
  size?: number;
  strokeWidth?: number;
  label?: string;
  sublabel?: string;
  detail?: string;
  status?: string;
}

export function SvgGaugeRing({
  fraction,
  size = 130,
  strokeWidth = 9,
  label,
  sublabel,
  detail,
  status,
}: Props) {
  const reducedMotion = usePrefersReducedMotion();
  const clampedFraction = Math.max(0, Math.min(1, fraction));
  const percent = Math.round(clampedFraction * 100);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // Offset: 0 is empty, circumference is full
  const strokeDashoffset = circumference - clampedFraction * circumference;

  // Determine color based on threshold & status
  let ringColor = "var(--accent)";
  let ringGlow = "rgba(217, 107, 79, 0.25)";
  if (percent >= 95 || status === "exhausted") {
    ringColor = "#ef4444";
    ringGlow = "rgba(239, 68, 68, 0.35)";
  } else if (percent >= 80 || status === "warning") {
    ringColor = "#f97316";
    ringGlow = "rgba(249, 115, 22, 0.25)";
  } else if (percent >= 60) {
    ringColor = "#f59e0b";
    ringGlow = "rgba(245, 158, 11, 0.2)";
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px 12px",
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
        minWidth: 160,
        position: "relative",
      }}
    >
      <div style={{ position: "relative", width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ transform: "rotate(-90deg)", overflow: "visible" }}
        >
          {/* Background track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--border)"
            strokeWidth={strokeWidth}
            opacity={0.6}
          />
          {/* Progress stroke */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            style={{
              transition: reducedMotion ? "none" : "stroke-dashoffset 0.8s cubic-bezier(0.16, 1, 0.3, 1), stroke 0.3s ease",
              filter: `drop-shadow(0 0 6px ${ringGlow})`,
            }}
          />
        </svg>

        {/* Center percent readout */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: size > 110 ? 24 : 18,
              fontWeight: 700,
              color: "var(--text)",
              letterSpacing: "-0.02em",
            }}
          >
            {percent}%
          </span>
          {sublabel && (
            <span
              style={{
                fontSize: 10,
                color: "var(--text-dim)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginTop: 2,
              }}
            >
              {sublabel}
            </span>
          )}
        </div>
      </div>

      {label && (
        <div
          style={{
            marginTop: 10,
            fontSize: 12,
            fontWeight: 600,
            color: "var(--text)",
            textAlign: "center",
          }}
        >
          {label}
        </div>
      )}

      {detail && (
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--text-muted)",
            textAlign: "center",
          }}
        >
          {detail}
        </div>
      )}
    </div>
  );
}

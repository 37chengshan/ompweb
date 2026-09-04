"use client";

export function OmpBouncingLetter() {
  return (
    <span
      className="omp-letters-inline"
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 1,
        userSelect: "none",
        flexShrink: 0,
        lineHeight: 1,
        fontFamily: "var(--font-mono)",
        fontWeight: 800,
        fontSize: 13.5,
      }}
    >

      <span
        className="omp-solo-o"
        style={{
          color: "var(--omp-o, var(--accent))",
        }}
      >
        o
      </span>
      <span
        className="omp-solo-m"
        style={{
          color: "var(--omp-m, #F59E0B)",
        }}
      >
        m
      </span>
      <span
        className="omp-solo-p"
        style={{
          color: "var(--omp-p, #38BDF8)",
        }}
      >
        p
      </span>
    </span>
  );
}







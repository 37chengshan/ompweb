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
      <style>{`
        @keyframes omp-solo-jump-o {
          0% { transform: translateY(0) scale(1, 1); }
          5% { transform: translateY(1.5px) scale(1.18, 0.82); }
          15% { transform: translateY(-7px) scale(0.88, 1.2); }
          25% { transform: translateY(0.8px) scale(1.08, 0.92); }
          30%, 100% { transform: translateY(0) scale(1, 1); }
        }
        @keyframes omp-solo-jump-m {
          0%, 33.3% { transform: translateY(0) scale(1, 1); }
          38.3% { transform: translateY(1.5px) scale(1.18, 0.82); }
          48.3% { transform: translateY(-7px) scale(0.88, 1.2); }
          58.3% { transform: translateY(0.8px) scale(1.08, 0.92); }
          63.3%, 100% { transform: translateY(0) scale(1, 1); }
        }
        @keyframes omp-solo-jump-p {
          0%, 66.6% { transform: translateY(0) scale(1, 1); }
          71.6% { transform: translateY(1.5px) scale(1.18, 0.82); }
          81.6% { transform: translateY(-7px) scale(0.88, 1.2); }
          91.6% { transform: translateY(0.8px) scale(1.08, 0.92); }
          96.6%, 100% { transform: translateY(0) scale(1, 1); }
        }
        .omp-solo-o {
          display: inline-block;
          transform-origin: bottom center;
          animation: omp-solo-jump-o 1.5s cubic-bezier(0.34, 1.35, 0.64, 1) infinite !important;
        }
        .omp-solo-m {
          display: inline-block;
          transform-origin: bottom center;
          animation: omp-solo-jump-m 1.5s cubic-bezier(0.34, 1.35, 0.64, 1) infinite !important;
        }
        .omp-solo-p {
          display: inline-block;
          transform-origin: bottom center;
          animation: omp-solo-jump-p 1.5s cubic-bezier(0.34, 1.35, 0.64, 1) infinite !important;
        }
        html[data-animations="false"] .omp-solo-o,
        html[data-animations="false"] .omp-solo-m,
        html[data-animations="false"] .omp-solo-p,
        html[data-animation-omp="false"] .omp-solo-o,
        html[data-animation-omp="false"] .omp-solo-m,
        html[data-animation-omp="false"] .omp-solo-p {
          animation: none !important;
          transform: none !important;
        }
      `}</style>
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







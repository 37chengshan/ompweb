"use client";

import { useEffect } from "react";

// Global error boundary — this must NOT import from @/lib/* because the error
// may be caused by a module loading failure. Use inline minimal styles and
// hardcoded English text (this is the absolute fallback).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global application error:", error);
  }, [error]);

  return (
    <html>
      <body>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "2rem",
            gap: "1rem",
            fontFamily: "system-ui, -apple-system, sans-serif",
            textAlign: "center",
            color: "#2B2823",
            background: "#FAF9F6",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1.5rem", fontWeight: 600, fontFamily: "Georgia, 'Songti SC', serif" }}>
            Something went wrong
          </h2>
          <p style={{ margin: 0, color: "#69635A", maxWidth: "28rem", fontSize: "0.875rem", lineHeight: 1.6 }}>
            An unexpected error occurred. Try reloading the page.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "0.5rem",
              padding: "0.5rem 1.5rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              border: "none",
              borderRadius: "8px",
              background: "#B03E22",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

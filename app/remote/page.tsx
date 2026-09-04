"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, LoaderCircle, Smartphone, XCircle } from "lucide-react";
import { translateForLocale, useI18n } from "@/lib/i18n";
import { removeBootSkeleton } from "@/lib/boot-skeleton";

type PairState = "pairing" | "paired" | "failed" | "network-error";

function RemotePairContent() {
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const [state, setState] = useState<PairState>("pairing");
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const started = useRef(false);

  // The document's language preference is restored before React hydrates,
  // while server rendering always starts in English. Keep the first client
  // render aligned with that server snapshot, then switch to the preferred
  // locale after mount without rebuilding the route for a text mismatch.
  const pairText = useCallback(
    (key: string, vars?: Record<string, string>) =>
      hydrated ? t(key, vars) : translateForLocale("en", key, vars),
    [hydrated, t],
  );

  const attemptPair = useCallback(() => {
    setState("pairing");
    const token = searchParams.get("token");
    const isMobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent);
    void fetch("/api/pair/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "omp-web-remote" },
      body: JSON.stringify({ token, mobile: isMobile }),
    })
      .then((res) => (res.ok ? res.json() as Promise<{ device: { name: string } }> : null))
      .then((body) => {
        if (!body) {
          setState("failed");
          return;
        }
        setDeviceName(body.device.name);
        setState("paired");
      })
      .catch(() => setState("network-error"));
  }, [searchParams]);

  useEffect(() => {
    // This route renders without AppShell, so the pre-hydration boot
    // skeleton (app/layout.tsx) would cover the pairing page forever.
    removeBootSkeleton();
    setHydrated(true);
    if (started.current) return;
    started.current = true;
    attemptPair();
  }, [attemptPair]);

  const base = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 24,
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Smartphone size={28} strokeWidth={1.8} style={{ color: "var(--accent)" }} aria-hidden="true" />
        <span style={{ fontSize: 18, fontWeight: 600 }}>{pairText("remote.pairingTitle")}</span>
      </div>

      {state === "pairing" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 14 }}>
          <LoaderCircle size={18} className="spin" aria-hidden="true" />
          {pairText("remote.pairingInProgress")}
        </div>
      )}

      {state === "paired" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <CheckCircle2 size={40} strokeWidth={1.6} style={{ color: "var(--status-ok, #2e9e5b)" }} aria-hidden="true" />
          <span style={{ fontSize: 15, fontWeight: 500 }}>{pairText("remote.pairedSuccess", { device: deviceName ?? "?" })}</span>
          <a
            href={base}
            style={{ padding: "10px 18px", borderRadius: "var(--radius-control)", background: "var(--accent)", color: "var(--bg)", textDecoration: "none", fontSize: 14, fontWeight: 600 }}
          >
            {pairText("remote.openApp")}
          </a>
        </div>
      )}

      {(state === "failed" || state === "network-error") && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <XCircle size={40} strokeWidth={1.6} style={{ color: "var(--status-error)" }} aria-hidden="true" />
          <span style={{ fontSize: 14, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.5 }}>
            {state === "network-error" ? pairText("remote.networkError") : pairText("remote.pairingFailed")}
          </span>
          <button
            type="button"
            onClick={attemptPair}
            style={{ padding: "9px 16px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg-panel)", color: "var(--text)", cursor: "pointer", fontSize: 13 }}
          >
            {pairText("remote.retry")}
          </button>
        </div>
      )}
    </main>
  );
}

export default function RemotePairPage() {
  return (
    <Suspense>
      <RemotePairContent />
    </Suspense>
  );
}

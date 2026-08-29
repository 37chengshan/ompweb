"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, LoaderCircle, Smartphone, XCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type PairState = "pairing" | "paired" | "failed";

function RemotePairContent() {
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const [state, setState] = useState<PairState>("pairing");
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = searchParams.get("token");
    const isMobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    headers["X-Requested-With"] = "omp-web-remote";
    void fetch("/api/pair/accept", {
      method: "POST",
      headers,
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
      .catch(() => setState("failed"));
  }, [searchParams]);

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
        <span style={{ fontSize: 18, fontWeight: 600 }}>{t("remote.pairingTitle")}</span>
      </div>

      {state === "pairing" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 14 }}>
          <LoaderCircle size={18} className="spin" aria-hidden="true" />
          {t("remote.pairingInProgress")}
        </div>
      )}

      {state === "paired" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <CheckCircle2 size={40} strokeWidth={1.6} style={{ color: "var(--status-ok, #2e9e5b)" }} aria-hidden="true" />
          <span style={{ fontSize: 15, fontWeight: 500 }}>{t("remote.pairedSuccess", { device: deviceName ?? "?" })}</span>
          <a
            href={base}
            style={{ padding: "10px 18px", borderRadius: "var(--radius-control)", background: "var(--accent)", color: "var(--bg)", textDecoration: "none", fontSize: 14, fontWeight: 600 }}
          >
            {t("remote.openApp")}
          </a>
        </div>
      )}

      {state === "failed" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <XCircle size={40} strokeWidth={1.6} style={{ color: "var(--status-error)" }} aria-hidden="true" />
          <span style={{ fontSize: 14, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.5 }}>{t("remote.pairingFailed")}</span>
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

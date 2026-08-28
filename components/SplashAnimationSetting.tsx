"use client";

import { useEffect, useState, useCallback } from "react";
import { useI18n } from "@/lib/i18n";

interface SplashPickerApi {
  isDesktop?: boolean;
  getSplashPref?: () => Promise<string>;
  setSplashPref?: (mode: string) => Promise<string>;
}

const MODES = ["always", "once", "off"] as const;
type SplashMode = (typeof MODES)[number];

/** Launch splash animation preference (desktop only): play every launch,
 *  only the first launch, or never. Persisted by the Electron main process. */
export function SplashAnimationSetting() {
  const { t } = useI18n();
  const [api] = useState<SplashPickerApi>(() =>
    typeof window !== "undefined" ? (window as Window & { piDesktop?: SplashPickerApi }).piDesktop ?? {} : {},
  );
  const [mode, setMode] = useState<SplashMode | null>(null);

  useEffect(() => {
    if (!api.getSplashPref) return;
    let cancelled = false;
    void api.getSplashPref().then((m) => {
      if (!cancelled && (MODES as readonly string[]).includes(m)) setMode(m as SplashMode);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [api]);

  const select = useCallback((next: SplashMode) => {
    setMode(next);
    if (api.setSplashPref) void api.setSplashPref(next).catch(() => {});
  }, [api]);

  if (!api.isDesktop) return null;

  return (
    <div style={{ marginTop: 12, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
      <h4 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px", color: "var(--text)" }}>{t("settingsConfig.splashAnimation")}</h4>
      <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--text-muted)" }}>{t("settingsConfig.splashAnimationDesc")}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 520 }}>
        {MODES.map((m) => (
          <label key={m} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text)", cursor: "pointer" }}>
            <input
              type="radio"
              name="splash-mode"
              checked={mode === m}
              onChange={() => select(m)}
              style={{ accentColor: "var(--accent)" }}
            />
            {t(`settingsConfig.splashMode${m.charAt(0).toUpperCase()}${m.slice(1)}`)}
          </label>
        ))}
      </div>
    </div>
  );
}

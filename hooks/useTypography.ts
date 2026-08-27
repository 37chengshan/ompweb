"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

export type FontPreset = "sans" | "serif" | "mono";

export interface FontPresetOption {
  id: FontPreset;
  name: string;
  nameKey: string;
  fontFamily: string;
  description: string;
}

export const FONT_PRESETS: FontPresetOption[] = [
  {
    id: "sans",
    name: "现代黑体",
    nameKey: "typography.sans",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif",
    description: "现代利落，结构清晰，高屏幕易读性",
  },
  {
    id: "serif",
    name: "人文宋体",
    nameKey: "typography.serif",
    fontFamily: "var(--font-serif), 'Songti SC', 'Source Serif 4', 'Noto Serif SC', Georgia, serif",
    description: "典雅温润，具有人文手帐与书卷质感",
  },
  {
    id: "mono",
    name: "极客等宽",
    nameKey: "typography.mono",
    fontFamily: "var(--font-mono), 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",
    description: "经典终端与代码风格，字符等距规整",
  },
];

export interface TypographyConfig {
  fontPreset: FontPreset;
  chatFontSize: number; // in px
}

const STORAGE_KEY = "omp-typography-config";
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const DEFAULT_CONFIG: TypographyConfig = {
  fontPreset: "sans",
  chatFontSize: 14,
};

let cachedConfig: TypographyConfig = DEFAULT_CONFIG;
let hasInitialized = false;

function getClientSnapshot(): TypographyConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  if (!hasInitialized) {
    hasInitialized = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        cachedConfig = {
          fontPreset: parsed.fontPreset || "sans",
          chatFontSize: Number(parsed.chatFontSize) || 14,
        };
      }
    } catch {}
  }
  return cachedConfig;
}

function getServerSnapshot(): TypographyConfig {
  return DEFAULT_CONFIG;
}

function applyTypographyToDom(config: TypographyConfig) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const preset = FONT_PRESETS.find((p) => p.id === config.fontPreset) ?? FONT_PRESETS[0];

  root.style.setProperty("--app-font-family", preset.fontFamily);
  root.style.setProperty("--chat-font-size", `${config.chatFontSize}px`);
  root.style.setProperty("--chat-line-height", `${Math.round(config.chatFontSize * 1.65)}px`);
  root.setAttribute("data-font-preset", config.fontPreset);
}

export function useTypography() {
  const config = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

  useEffect(() => {
    applyTypographyToDom(config);
  }, [config]);

  const updateTypography = useCallback((updated: Partial<TypographyConfig>) => {
    cachedConfig = { ...cachedConfig, ...updated };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedConfig));
    } catch {}
    applyTypographyToDom(cachedConfig);
    listeners.forEach((cb) => cb());
  }, []);

  const setFontPreset = useCallback((preset: FontPreset) => {
    updateTypography({ fontPreset: preset });
  }, [updateTypography]);

  const setChatFontSize = useCallback((size: number) => {
    updateTypography({ chatFontSize: size });
  }, [updateTypography]);

  return {
    config,
    fontPreset: config.fontPreset,
    chatFontSize: config.chatFontSize,
    setFontPreset,
    setChatFontSize,
    updateTypography,
  };
}

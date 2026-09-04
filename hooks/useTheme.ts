"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export type ThemePreference =
  | "system"
  | "light"
  | "nord"
  | "oatmeal"
  | "matcha"
  | "oled"
  | "dark"
  | "sepia"
  | "dracula"
  | "pine"
  | "navy"
  | "aurora-flow"
  | "dawn-flow"
  | "cosmic-flow"
  | "ocean-flow"
  | "sakura-flow"
  | "bamboo-flow"
  | "codex"
  | "custom";

export type Theme = "light" | "dark";

export interface CustomThemeConfig {
  accent: string;
  bg: string;
  panel?: string;
  text?: string;
  ompO?: string;
  ompM?: string;
  ompP?: string;
  mode: "static" | "flow";
  isDark: boolean;
}

export interface ThemeOption {
  id: ThemePreference;
  name: string;
  nameKey: string;
  isDark: boolean;
  color: string;
  accent: string;
  border: string;
  category: "static" | "flowing" | "system" | "custom";
}

export const THEME_OPTIONS: ThemeOption[] = [
  // ── 1. 静态经典色盘 (11 款高质感护眼预设) ──────────────────────────
  { id: "light", name: "暖阳手帐", nameKey: "theme.light", isDark: false, color: "#FAF9F6", accent: "#B03E22", border: "#E2DDD2", category: "static" },
  { id: "nord", name: "极地雪原", nameKey: "theme.nord", isDark: true, color: "#2E3440", accent: "#88C0D0", border: "#434C5E", category: "static" },
  { id: "oatmeal", name: "燕麦拿铁", nameKey: "theme.oatmeal", isDark: false, color: "#F7F4EE", accent: "#965A38", border: "#D8D2C4", category: "static" },
  { id: "matcha", name: "京都抹茶", nameKey: "theme.matcha", isDark: false, color: "#F3F6F3", accent: "#2D6A4F", border: "#CAD6C8", category: "static" },
  { id: "oled", name: "极夜黑曜", nameKey: "theme.oled", isDark: true, color: "#000000", accent: "#38BDF8", border: "#242424", category: "static" },
  { id: "codex", name: "极简黑白 (Codex)", nameKey: "theme.codex", isDark: true, color: "#000000", accent: "#FFFFFF", border: "#27272A", category: "static" },
  { id: "dark", name: "暗夜余烬", nameKey: "theme.dark", isDark: true, color: "#1B1916", accent: "#E07B54", border: "#38322B", category: "static" },
  { id: "sepia", name: "大英古籍", nameKey: "theme.sepia", isDark: false, color: "#F5EEDC", accent: "#8C4820", border: "#D5BE99", category: "static" },
  { id: "dracula", name: "德古拉之夜", nameKey: "theme.dracula", isDark: true, color: "#282A36", accent: "#BD93F9", border: "#44475A", category: "static" },
  { id: "pine", name: "松林深翠", nameKey: "theme.pine", isDark: true, color: "#121B17", accent: "#52B788", border: "#2C4037", category: "static" },
  { id: "navy", name: "远山黛蓝", nameKey: "theme.navy", isDark: true, color: "#0F172A", accent: "#60A5FA", border: "#334155", category: "static" },

  // ── 2. 多色柔光流动预设 (6 款柔和弥散极光) ──────────────────────
  { id: "aurora-flow", name: "极光幻境", nameKey: "theme.auroraFlow", isDark: true, color: "#0c1417", accent: "#34d399", border: "#50b4a0", category: "flowing" },
  { id: "dawn-flow", name: "晨曦微光", nameKey: "theme.dawnFlow", isDark: true, color: "#16101a", accent: "#f472b6", border: "#f472b6", category: "flowing" },
  { id: "cosmic-flow", name: "深空星云", nameKey: "theme.cosmicFlow", isDark: true, color: "#090b16", accent: "#818cf8", border: "#818cf8", category: "flowing" },
  { id: "ocean-flow", name: "深海幽光", nameKey: "theme.oceanFlow", isDark: true, color: "#071318", accent: "#38bdf8", border: "#38bdf8", category: "flowing" },
  { id: "sakura-flow", name: "樱落暮雪", nameKey: "theme.sakuraFlow", isDark: true, color: "#171114", accent: "#fb7185", border: "#fda4af", category: "flowing" },
  { id: "bamboo-flow", name: "竹林雨霁", nameKey: "theme.bambooFlow", isDark: true, color: "#0c1612", accent: "#10b981", border: "#a7f3d0", category: "flowing" },

  // ── 3. 跟随系统 ──────────────────────────────────────────────
  { id: "system", name: "跟随系统", nameKey: "theme.system", isDark: false, color: "#777777", accent: "#B03E22", border: "#999999", category: "system" },
];

const VALID_THEMES = new Set<string>([
  "system", "light", "nord", "oatmeal", "matcha", "oled", "codex", "dark", "sepia", "dracula", "pine", "navy",
  "aurora-flow", "dawn-flow", "cosmic-flow", "ocean-flow", "sakura-flow", "bamboo-flow", "custom"
]);

const CUSTOM_STORAGE_KEY = "omp-custom-theme";
const STORAGE_KEY = "omp-theme";
const listeners = new Set<() => void>();

let cachedCustomTheme: CustomThemeConfig = {
  accent: "#38BDF8",
  bg: "#0B0F19",
  mode: "flow",
  isDark: true,
};
let customThemeInitialized = false;

export function getCustomTheme(): CustomThemeConfig {
  if (typeof window === "undefined") return cachedCustomTheme;
  if (!customThemeInitialized) {
    customThemeInitialized = true;
    try {
      const saved = localStorage.getItem(CUSTOM_STORAGE_KEY);
      if (saved) cachedCustomTheme = JSON.parse(saved);
    } catch {}
  }
  return cachedCustomTheme;
}

export function saveCustomTheme(config: CustomThemeConfig): void {
  cachedCustomTheme = config;
  try {
    localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(config));
    if (typeof document !== "undefined") {
      applyCustomStyles(config);
    }
    listeners.forEach((cb) => cb());
  } catch {}
}

function applyCustomStyles(config: CustomThemeConfig) {
  const root = document.documentElement;
  root.style.setProperty("--accent", config.accent);
  root.style.setProperty("--accent-strong", config.accent);
  root.style.setProperty("--accent-hover", config.accent);
  root.style.setProperty("--bg", config.bg);
  root.style.setProperty("--bg-panel", config.panel || (config.isDark ? "color-mix(in srgb, var(--bg) 82%, white 4%)" : "color-mix(in srgb, var(--bg) 86%, black 3%)"));
  root.style.setProperty("--border", config.isDark ? "color-mix(in srgb, var(--bg) 76%, white 12%)" : "color-mix(in srgb, var(--bg) 76%, black 10%)");
  root.style.setProperty("--text", config.text || (config.isDark ? "#EBE6DC" : "#2B2823"));
  root.style.setProperty("--text-muted", config.isDark ? "#A39B8E" : "#69635A");
  root.style.setProperty("--omp-o", config.ompO || config.accent);
  root.style.setProperty("--omp-m", config.ompM || `color-mix(in srgb, ${config.accent} 65%, #F59E0B)`);
  root.style.setProperty("--omp-p", config.ompP || `color-mix(in srgb, ${config.accent} 65%, #38BDF8)`);
  root.classList.toggle("dark", config.isDark);
  root.setAttribute("data-theme", "custom");
  root.setAttribute("data-custom-mode", config.mode);

  if (config.mode === "flow") {
    root.classList.add("theme-flow-active");
    document.body.style.background = `linear-gradient(-45deg, ${config.bg}, color-mix(in srgb, ${config.accent} 25%, ${config.bg}), ${config.bg})`;
    document.body.style.backgroundSize = "400% 400%";
    document.body.style.animation = "omp-mesh-flow 15s ease infinite";
  } else {
    root.classList.remove("theme-flow-active");
    document.body.style.background = "";
    document.body.style.animation = "";
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function storedPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value && VALID_THEMES.has(value) ? (value as ThemePreference) : "system";
  } catch {
    return "system";
  }
}

export function isDarkTheme(preference: ThemePreference, prefersDark = false): boolean {
  if (preference === "system") return prefersDark;
  if (preference === "custom") {
    return getCustomTheme().isDark;
  }
  return preference === "dark"
    || preference === "oled"
    || preference === "codex"
    || preference === "nord"
    || preference === "dracula"
    || preference === "pine"
    || preference === "navy"
    || preference === "aurora-flow"
    || preference === "dawn-flow"
    || preference === "cosmic-flow"
    || preference === "ocean-flow"
    || preference === "sakura-flow"
    || preference === "bamboo-flow";
}

export function resolveTheme(preference: ThemePreference, prefersDark = false): Theme {
  return isDarkTheme(preference, prefersDark) ? "dark" : "light";
}

export function nextThemePreference(preference: ThemePreference): ThemePreference {
  if (preference === "light") return "dark";
  if (preference === "dark") return "system";
  if (preference === "system") return "light";
  return isDarkTheme(preference) ? "light" : "dark";
}

function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  // Clear any inline custom variables when switching to preset
  if (preference !== "custom") {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-strong");
    root.style.removeProperty("--accent-hover");
    root.style.removeProperty("--bg");
    root.style.removeProperty("--bg-panel");
    root.style.removeProperty("--border");
    root.style.removeProperty("--text");
    root.style.removeProperty("--text-muted");
    root.style.removeProperty("--omp-o");
    root.style.removeProperty("--omp-m");
    root.style.removeProperty("--omp-p");
    root.removeAttribute("data-custom-mode");
    root.classList.remove("theme-flow-active");
    document.body.style.background = "";
    document.body.style.animation = "";
  }

  if (preference === "custom") {
    applyCustomStyles(getCustomTheme());
    try {
      localStorage.setItem(STORAGE_KEY, "custom");
    } catch {}
    listeners.forEach((cb) => cb());
    return;
  }

  const isDark = isDarkTheme(preference, window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", isDark);

  if (preference === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", preference);
  }

  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {}
  listeners.forEach((cb) => cb());
}

function getServerSnapshot(): ThemePreference {
  return "system";
}

type ToggleOrigin = { x: number; y: number };
function motionDurationMs(variable: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  if (raw.endsWith("ms")) {
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : fallback;
  }
  if (raw.endsWith("s")) {
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value * 1000 : fallback;
  }
  return fallback;
}

export function useTheme() {
  const preference = useSyncExternalStore(subscribe, storedPreference, getServerSnapshot);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
    applyTheme(storedPreference());
  }, []);
  const prefersDark = hydrated && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = resolveTheme(preference, prefersDark);

  useEffect(() => {
    if (!hydrated) return;
    applyTheme(preference);
  }, [preference, hydrated]);

  useEffect(() => {
    if (preference !== "system" || typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      document.documentElement.classList.toggle("dark", media.matches);
      listeners.forEach((cb) => cb());
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const setTheme = useCallback((next: ThemePreference, origin?: ToggleOrigin) => {
    const apply = () => applyTheme(next);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const supportsVT = typeof document.startViewTransition === "function";
    if (!supportsVT || reduceMotion) {
      apply();
      return;
    }

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    document.documentElement.classList.add("theme-transition");
    const cleanup = () => document.documentElement.classList.remove("theme-transition");
    const transition = document.startViewTransition(apply);
    transition.ready.then(() => {
      const styles = getComputedStyle(document.documentElement);
      const animation = document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] }, {
        duration: motionDurationMs("--dur-theme", 450),
        easing: styles.getPropertyValue("--ease-out-warm").trim() || "ease-out",
        pseudoElement: "::view-transition-new(root)",
      });
      animation.finished.then(cleanup).catch(cleanup);
    }).catch(cleanup);
    transition.finished?.then(cleanup).catch(cleanup);
  }, []);

  const toggleTheme = useCallback((origin?: ToggleOrigin) => setTheme(nextThemePreference(preference), origin), [preference, setTheme]);

  return { theme, preference, isDark: theme === "dark", setTheme, toggleTheme };
}

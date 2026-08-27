"use client";

import { useEffect, useRef, useState } from "react";
import { Palette, Check, Sparkles, Sliders, Moon, Sun, Waves, Type, Minus, Plus } from "lucide-react";
import {
  useTheme,
  THEME_OPTIONS,
  type ThemePreference,
  type CustomThemeConfig,
  getCustomTheme,
  saveCustomTheme,
} from "@/hooks/useTheme";
import { useMotionPrefs } from "@/hooks/useMotionPrefs";
import { useTypography, FONT_PRESETS, type FontPreset } from "@/hooks/useTypography";
import { useI18n } from "@/lib/i18n";

export function ThemePicker() {
  const { preference, setTheme } = useTheme();
  const { motionPrefs, setMotionPrefs } = useMotionPrefs();
  const { fontPreset, chatFontSize, setFontPreset, setChatFontSize } = useTypography();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"static" | "flowing" | "custom" | "motion" | "typography">("static");
  const [customConfig, setCustomConfig] = useState<CustomThemeConfig>(getCustomTheme());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const currentOption = THEME_OPTIONS.find((opt) => opt.id === preference) ?? THEME_OPTIONS[0];

  const staticThemes = THEME_OPTIONS.filter((opt) => opt.category === "static" || opt.category === "system");
  const flowingThemes = THEME_OPTIONS.filter((opt) => opt.category === "flowing");

  const presetAccents = [
    "#B03E22", // Terracotta
    "#38BDF8", // Sky Blue
    "#FF2A85", // Neon Pink
    "#10B981", // Emerald
    "#8B5CF6", // Violet
    "#F59E0B", // Amber
    "#EC4899", // Rose
    "#06B6D4", // Cyan
  ];

  const handleCustomChange = (updated: Partial<CustomThemeConfig>) => {
    const next = { ...customConfig, ...updated };
    setCustomConfig(next);
    saveCustomTheme(next);
    setTheme("custom");
  };

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        title={t("appShell.switchTheme") || "主题与字体外观"}
        aria-label={t("appShell.switchTheme") || "主题与字体外观"}
        aria-expanded={open}
        className="shell-toolbar-btn ui-focus-ring"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "0 6px",
          height: 28,
          borderRadius: 6,
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: preference === "custom" ? customConfig.accent : currentOption.accent,
            boxShadow: `0 0 0 1.5px ${currentOption.border}`,
            flexShrink: 0,
          }}
        />
        <Palette size={15} strokeWidth={1.8} aria-hidden="true" style={{ color: "var(--text-muted)" }} />
      </button>

      {open && (
        <div
          className="dropdown-surface animate-scale-in"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 650,
            width: 320,
            padding: 8,
            borderRadius: "var(--radius-card)",
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-pop)",
          }}
        >
          {/* Header Title */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "4px 6px 8px",
              borderBottom: "1px solid var(--border)",
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
              {t("appShell.themePalette") || "视觉中心 · 主题与排版"}
            </span>
            <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
              {preference.toUpperCase()} · {chatFontSize}px
            </span>
          </div>

          {/* Category Navigation Tabs */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1.05fr 1.05fr 1.05fr 1.05fr",
              gap: 2.5,
              padding: 2,
              borderRadius: 8,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              marginBottom: 8,
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab("static")}
              style={{
                padding: "4px 0",
                fontSize: 10.5,
                fontWeight: 600,
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                background: activeTab === "static" ? "var(--bg-selected)" : "transparent",
                color: activeTab === "static" ? "var(--text)" : "var(--text-muted)",
              }}
            >
              静态
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("flowing")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                padding: "4px 0",
                fontSize: 10.5,
                fontWeight: 600,
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                background: activeTab === "flowing" ? "var(--bg-selected)" : "transparent",
                color: activeTab === "flowing" ? "var(--accent)" : "var(--text-muted)",
              }}
            >
              <Waves size={11} />
              <span>流动</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("custom")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                padding: "4px 0",
                fontSize: 10.5,
                fontWeight: 600,
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                background: activeTab === "custom" ? "var(--bg-selected)" : "transparent",
                color: activeTab === "custom" ? "var(--text)" : "var(--text-muted)",
              }}
            >
              <Sliders size={11} />
              <span>调色</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("motion")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                padding: "4px 0",
                fontSize: 10.5,
                fontWeight: 600,
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                background: activeTab === "motion" ? "var(--bg-selected)" : "transparent",
                color: activeTab === "motion" ? "var(--accent)" : "var(--text-muted)",
              }}
            >
              <Sparkles size={11} />
              <span>动效</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("typography")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                padding: "4px 0",
                fontSize: 10.5,
                fontWeight: 600,
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                background: activeTab === "typography" ? "var(--bg-selected)" : "transparent",
                color: activeTab === "typography" ? "var(--text)" : "var(--text-muted)",
              }}
            >
              <Type size={11} />
              <span>字体</span>
            </button>
          </div>

          {/* 1. Static Presets */}
          {activeTab === "static" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 260, overflowY: "auto" }}>
              {staticThemes.map((opt) => {
                const active = preference === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setTheme(opt.id, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                      setOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "6px 8px",
                      borderRadius: 6,
                      fontSize: 12,
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      background: active ? "var(--bg-selected)" : "transparent",
                      color: active ? "var(--text)" : "var(--text-muted)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: "50%",
                          backgroundColor: opt.color,
                          boxShadow: `0 0 0 1.5px ${opt.accent}`,
                          flexShrink: 0,
                        }}
                      />
                      <span>{t(opt.nameKey) || opt.name}</span>
                    </div>
                    {active && <Check size={14} strokeWidth={2.2} style={{ color: "var(--accent)" }} />}
                  </button>
                );
              })}
            </div>
          )}

          {/* 2. Flowing Animated Gradients */}
          {activeTab === "flowing" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 11, color: "var(--text-dim)", padding: "2px 6px" }}>
                动态流动渐变光效 · 呼吸流转
              </div>
              {flowingThemes.map((opt) => {
                const active = preference === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      setTheme(opt.id, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                      setOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "7px 10px",
                      borderRadius: 8,
                      fontSize: 12,
                      border: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
                      cursor: "pointer",
                      textAlign: "left",
                      background: active ? "color-mix(in srgb, var(--accent) 14%, var(--bg))" : "var(--bg)",
                      color: active ? "var(--text)" : "var(--text-muted)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          background: `linear-gradient(45deg, ${opt.accent}, ${opt.border})`,
                          boxShadow: `0 0 8px ${opt.accent}`,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontWeight: 600 }}>{t(opt.nameKey) || opt.name}</span>
                    </div>
                    {active && <Check size={14} strokeWidth={2.2} style={{ color: "var(--accent)" }} />}
                  </button>
                );
              })}
            </div>
          )}

          {/* 3. Custom Color Studio */}
          {activeTab === "custom" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 2px", maxHeight: 360, overflowY: "auto" }}>
              {/* Inspiration Presets */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>
                  灵感风格预设 (Inspiration Presets)
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                  {[
                    { name: "赛博霓虹", accent: "#38BDF8", bg: "#0B0F19", isDark: true, mode: "flow" as const },
                    { name: "极光翠绿", accent: "#34D399", bg: "#091410", isDark: true, mode: "flow" as const },
                    { name: "德古拉紫", accent: "#BD93F9", bg: "#161020", isDark: true, mode: "flow" as const },
                    { name: "烈焰流金", accent: "#F59E0B", bg: "#1C140C", isDark: true, mode: "flow" as const },
                    { name: "樱落暮雪", accent: "#FB7185", bg: "#1A0F15", isDark: true, mode: "flow" as const },
                    { name: "纯黑极曜", accent: "#00E5FF", bg: "#000000", isDark: true, mode: "flow" as const },
                    { name: "暖阳手帐", accent: "#B03E22", bg: "#FAF9F6", isDark: false, mode: "static" as const },
                    { name: "燕麦拿铁", accent: "#965A38", bg: "#F7F4EE", isDark: false, mode: "static" as const },
                  ].map((preset) => {
                    const isCurrent = customConfig.accent === preset.accent && customConfig.bg === preset.bg;
                    return (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => handleCustomChange(preset)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "5px 7px",
                          borderRadius: 6,
                          border: `1px solid ${isCurrent ? "var(--accent)" : "color-mix(in srgb, var(--border) 60%, transparent)"}`,
                          background: isCurrent ? "color-mix(in srgb, var(--accent) 15%, var(--bg))" : "var(--bg)",
                          color: isCurrent ? "var(--accent)" : "var(--text)",
                          fontSize: 11,
                          fontWeight: 500,
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            backgroundColor: preset.accent,
                            boxShadow: `0 0 4px ${preset.accent}`,
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {preset.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Mode toggle */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>
                  渲染模式 (Mode)
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => handleCustomChange({ mode: "static" })}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                      padding: "6px 0",
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 6,
                      border: `1.5px solid ${customConfig.mode === "static" ? "var(--accent)" : "var(--border)"}`,
                      background: customConfig.mode === "static" ? "color-mix(in srgb, var(--accent) 18%, var(--bg))" : "var(--bg)",
                      color: customConfig.mode === "static" ? "var(--accent)" : "var(--text-muted)",
                      cursor: "pointer",
                      boxShadow: customConfig.mode === "static" ? "0 0 8px color-mix(in srgb, var(--accent) 25%, transparent)" : "none",
                    }}
                  >
                    <span>静态色彩</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCustomChange({ mode: "flow" })}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                      padding: "6px 0",
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 6,
                      border: `1.5px solid ${customConfig.mode === "flow" ? "var(--accent)" : "var(--border)"}`,
                      background: customConfig.mode === "flow" ? "color-mix(in srgb, var(--accent) 18%, var(--bg))" : "var(--bg)",
                      color: customConfig.mode === "flow" ? "var(--accent)" : "var(--text-muted)",
                      cursor: "pointer",
                      boxShadow: customConfig.mode === "flow" ? "0 0 8px color-mix(in srgb, var(--accent) 25%, transparent)" : "none",
                    }}
                  >
                    <Waves size={12} />
                    <span>流动流光</span>
                  </button>
                </div>
              </div>

              {/* Accent Color */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>
                  强调色 (Accent Color)
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <input
                    type="color"
                    value={customConfig.accent}
                    onChange={(e) => handleCustomChange({ accent: e.target.value })}
                    style={{
                      width: 32,
                      height: 28,
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: "transparent",
                      cursor: "pointer",
                      padding: 1,
                    }}
                  />
                  <input
                    type="text"
                    value={customConfig.accent}
                    onChange={(e) => handleCustomChange({ accent: e.target.value })}
                    style={{
                      flex: 1,
                      height: 28,
                      padding: "0 8px",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "var(--text)",
                      fontSize: 12,
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                </div>
                {/* Preset swatches */}
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {[
                    "#38BDF8", "#00E5FF", "#34D399", "#10B981", "#BD93F9", "#8B5CF6",
                    "#FF2A85", "#FB7185", "#F59E0B", "#B03E22", "#E07B54", "#60A5FA"
                  ].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => handleCustomChange({ accent: c })}
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        backgroundColor: c,
                        border: "none",
                        cursor: "pointer",
                        boxShadow: customConfig.accent === c ? "0 0 0 2px var(--text)" : "none",
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Background Color */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>
                  背景底色 (Background Color)
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <input
                    type="color"
                    value={customConfig.bg}
                    onChange={(e) => handleCustomChange({ bg: e.target.value })}
                    style={{
                      width: 32,
                      height: 28,
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: "transparent",
                      cursor: "pointer",
                      padding: 1,
                    }}
                  />
                  <input
                    type="text"
                    value={customConfig.bg}
                    onChange={(e) => handleCustomChange({ bg: e.target.value })}
                    style={{
                      flex: 1,
                      height: 28,
                      padding: "0 8px",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "var(--text)",
                      fontSize: 12,
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                </div>
                {/* Background swatches */}
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {[
                    "#000000", "#090B16", "#0B0F19", "#0C1417", "#121B17", "#1B1916",
                    "#FAF9F6", "#F7F4EE", "#F3F6F3", "#F1F5F9"
                  ].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        const isD = c.startsWith("#0") || c.startsWith("#1");
                        handleCustomChange({ bg: c, isDark: isD });
                      }}
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 4,
                        backgroundColor: c,
                        border: "1px solid var(--border)",
                        cursor: "pointer",
                        boxShadow: customConfig.bg === c ? "0 0 0 2px var(--accent)" : "none",
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Dark / Light Toggle */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>
                  基底明暗 (Base Tone)
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => handleCustomChange({ isDark: false, bg: customConfig.bg.startsWith("#0") || customConfig.bg.startsWith("#1") ? "#FAF9F6" : customConfig.bg })}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                      padding: "5px 0",
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 6,
                      border: `1px solid ${!customConfig.isDark ? "var(--accent)" : "var(--border)"}`,
                      background: !customConfig.isDark ? "color-mix(in srgb, var(--accent) 15%, var(--bg))" : "var(--bg)",
                      color: !customConfig.isDark ? "var(--accent)" : "var(--text)",
                      cursor: "pointer",
                    }}
                  >
                    <Sun size={12} />
                    <span>浅色明亮</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCustomChange({ isDark: true, bg: customConfig.bg.startsWith("#F") ? "#0B0F19" : customConfig.bg })}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                      padding: "5px 0",
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 6,
                      border: `1px solid ${customConfig.isDark ? "var(--accent)" : "var(--border)"}`,
                      background: customConfig.isDark ? "color-mix(in srgb, var(--accent) 15%, var(--bg))" : "var(--bg)",
                      color: customConfig.isDark ? "var(--accent)" : "var(--text)",
                      cursor: "pointer",
                    }}
                  >
                    <Moon size={12} />
                    <span>深色暗夜</span>
                  </button>
                </div>
              </div>

              {/* OMP Letters Color Fine-Tuning */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>
                  OMP 字符专属配色 (OMP Loader Colors)
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--omp-o, var(--accent))" }}>o:</span>
                    <input
                      type="color"
                      value={customConfig.ompO || customConfig.accent}
                      onChange={(e) => handleCustomChange({ ompO: e.target.value })}
                      style={{ width: 24, height: 22, border: "none", background: "none", cursor: "pointer", padding: 0 }}
                    />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--omp-m, #F59E0B)" }}>m:</span>
                    <input
                      type="color"
                      value={customConfig.ompM || "#F59E0B"}
                      onChange={(e) => handleCustomChange({ ompM: e.target.value })}
                      style={{ width: 24, height: 22, border: "none", background: "none", cursor: "pointer", padding: 0 }}
                    />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--omp-p, #38BDF8)" }}>p:</span>
                    <input
                      type="color"
                      value={customConfig.ompP || "#38BDF8"}
                      onChange={(e) => handleCustomChange({ ompP: e.target.value })}
                      style={{ width: 24, height: 22, border: "none", background: "none", cursor: "pointer", padding: 0 }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 4. Motion & Animation Controls */}
          {activeTab === "motion" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 2px", maxHeight: 360, overflowY: "auto" }}>
              {/* Master Animation Switch */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                }}
              >
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text)" }}>全局动效开关</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>开启或关闭全站动态效果</div>
                </div>
                <button
                  type="button"
                  onClick={() => setMotionPrefs({ enabled: !motionPrefs.enabled })}
                  style={{
                    width: 36,
                    height: 20,
                    borderRadius: 10,
                    background: motionPrefs.enabled ? "var(--accent)" : "var(--border)",
                    position: "relative",
                    cursor: "pointer",
                    border: "none",
                    transition: "background var(--dur-fast)",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 2,
                      left: motionPrefs.enabled ? 18 : 2,
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: "#ffffff",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                      transition: "left var(--dur-fast)",
                    }}
                  />
                </button>
              </div>

              {/* Chat Input Border Beam */}
              <div
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  opacity: motionPrefs.enabled ? 1 : 0.5,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text)" }}>对话框边框流光</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>对话中沿边框顺时针游走</div>
                  </div>
                  <button
                    type="button"
                    disabled={!motionPrefs.enabled}
                    onClick={() => setMotionPrefs({ chatBorderBeam: !motionPrefs.chatBorderBeam })}
                    style={{
                      width: 34,
                      height: 18,
                      borderRadius: 9,
                      background: (motionPrefs.enabled && motionPrefs.chatBorderBeam) ? "var(--accent)" : "var(--border)",
                      position: "relative",
                      cursor: motionPrefs.enabled ? "pointer" : "not-allowed",
                      border: "none",
                      transition: "background var(--dur-fast)",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        top: 2,
                        left: (motionPrefs.enabled && motionPrefs.chatBorderBeam) ? 18 : 2,
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        background: "#ffffff",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                        transition: "left var(--dur-fast)",
                      }}
                    />
                  </button>
                </div>

                {/* Flow speed control */}
                {motionPrefs.enabled && motionPrefs.chatBorderBeam && (
                  <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid color-mix(in srgb, var(--border) 60%, transparent)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>
                      <span>流速周期</span>
                      <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)", fontWeight: 600 }}>{motionPrefs.beamSpeed} 秒/周</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 3 }}>
                      {[
                        { label: "极慢 8s", speed: 8 },
                        { label: "慢速 5.5s", speed: 5.5 },
                        { label: "标准 3.8s", speed: 3.8 },
                        { label: "快速 2.2s", speed: 2.2 },
                      ].map((s) => (
                        <button
                          key={s.speed}
                          type="button"
                          onClick={() => setMotionPrefs({ beamSpeed: s.speed })}
                          style={{
                            padding: "3px 0",
                            fontSize: 10,
                            fontWeight: motionPrefs.beamSpeed === s.speed ? 700 : 500,
                            borderRadius: 4,
                            border: `1px solid ${motionPrefs.beamSpeed === s.speed ? "var(--accent)" : "var(--border)"}`,
                            background: motionPrefs.beamSpeed === s.speed ? "color-mix(in srgb, var(--accent) 15%, var(--bg))" : "var(--bg)",
                            color: motionPrefs.beamSpeed === s.speed ? "var(--accent)" : "var(--text-muted)",
                            cursor: "pointer",
                          }}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* OMP Letters Jumping */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  opacity: motionPrefs.enabled ? 1 : 0.5,
                }}
              >
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text)" }}>OMP 字符跳动动效</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>等待响应时 o·m·p 独立循环跳动</div>
                </div>
                <button
                  type="button"
                  disabled={!motionPrefs.enabled}
                  onClick={() => setMotionPrefs({ ompBouncing: !motionPrefs.ompBouncing })}
                  style={{
                    width: 34,
                    height: 18,
                    borderRadius: 9,
                    background: (motionPrefs.enabled && motionPrefs.ompBouncing) ? "var(--accent)" : "var(--border)",
                    position: "relative",
                    cursor: motionPrefs.enabled ? "pointer" : "not-allowed",
                    border: "none",
                    transition: "background var(--dur-fast)",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 2,
                      left: (motionPrefs.enabled && motionPrefs.ompBouncing) ? 18 : 2,
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      background: "#ffffff",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                      transition: "left var(--dur-fast)",
                    }}
                  />
                </button>
              </div>

              {/* Thinking Pulse */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  opacity: motionPrefs.enabled ? 1 : 0.5,
                }}
              >
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text)" }}>思考脑波呼吸动效</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>模型深度思考状态图标脉冲</div>
                </div>
                <button
                  type="button"
                  disabled={!motionPrefs.enabled}
                  onClick={() => setMotionPrefs({ thinkingPulse: !motionPrefs.thinkingPulse })}
                  style={{
                    width: 34,
                    height: 18,
                    borderRadius: 9,
                    background: (motionPrefs.enabled && motionPrefs.thinkingPulse) ? "var(--accent)" : "var(--border)",
                    position: "relative",
                    cursor: motionPrefs.enabled ? "pointer" : "not-allowed",
                    border: "none",
                    transition: "background var(--dur-fast)",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 2,
                      left: (motionPrefs.enabled && motionPrefs.thinkingPulse) ? 18 : 2,
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      background: "#ffffff",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                      transition: "left var(--dur-fast)",
                    }}
                  />
                </button>
              </div>
            </div>
          )}

          {/* 5. Typography Presets & Font Size Slider */}
          {activeTab === "typography" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 2px" }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>
                  字体预设 (Font Family)
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {FONT_PRESETS.map((preset) => {
                    const active = fontPreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setFontPreset(preset.id)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "6px 8px",
                          borderRadius: 6,
                          border: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
                          background: active ? "var(--bg-selected)" : "var(--bg)",
                          color: active ? "var(--text)" : "var(--text-muted)",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, fontFamily: preset.fontFamily }}>
                            {preset.name}
                          </span>
                          <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
                            {preset.description}
                          </span>
                        </div>
                        {active && <Check size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Chat font size adjuster */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>
                    对话字号大小 (Font Size)
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                    {chatFontSize} px
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setChatFontSize(Math.max(12, chatFontSize - 1))}
                    disabled={chatFontSize <= 12}
                    className="shell-toolbar-btn ui-focus-ring"
                    style={{ width: 26, height: 26, borderRadius: 6 }}
                  >
                    <Minus size={12} />
                  </button>
                  <input
                    type="range"
                    min={12}
                    max={20}
                    step={0.5}
                    value={chatFontSize}
                    onChange={(e) => setChatFontSize(Number(e.target.value))}
                    style={{
                      flex: 1,
                      accentColor: "var(--accent)",
                      cursor: "pointer",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setChatFontSize(Math.min(20, chatFontSize + 1))}
                    disabled={chatFontSize >= 20}
                    className="shell-toolbar-btn ui-focus-ring"
                    style={{ width: 26, height: 26, borderRadius: 6 }}
                  >
                    <Plus size={12} />
                  </button>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "var(--text-dim)" }}>
                  <span>精简 (12px)</span>
                  <span>标准 (14px)</span>
                  <span>超大 (20px)</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Activity, Bot, Cable, Cpu, KeyRound, ListTree, RefreshCw, Settings2, ShieldCheck, Smartphone, Sparkles } from "lucide-react";
import type { ComponentType, CSSProperties } from "react";

export type SettingsTab =
  | "general"
  | "safety"
  | "models"
  | "providers"
  | "intelligence"
  | "agents"
  | "extensions"
  | "mcp"
  | "skills"
  | "plugins"
  | "native"
  | "system"
  | "remote"
  | "diagnostics";

export interface TabItem {
  id: SettingsTab;
  label: string;
  description: string;
  Icon: ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean | "true" | "false"; style?: CSSProperties }>;
  needsWorkspace?: boolean;
}

export const SETTINGS_CATEGORIES: TabItem[] = [
  { id: "general", label: "Interface & Behavior", description: "UI preferences, completion sound, submission mode", Icon: Settings2 },
  { id: "safety", label: "Safety & Approvals", description: "Tool safety rules, YOLO mode, terminal permissions", Icon: ShieldCheck },
  { id: "models", label: "AI Model Defaults", description: "Reasoning budget, verbosity, personality, scratchpad", Icon: Cpu },
  { id: "providers", label: "API Keys & Providers", description: "Connected OAuth accounts, API keys, and model registry", Icon: KeyRound },
  { id: "intelligence", label: "Agent & Intelligence", description: "Advisor, memory, autolearn, compaction and retry", Icon: Sparkles },
  { id: "agents", label: "Agents", description: "Task agents, model settings, and tool policy", Icon: Bot },
  { id: "mcp", label: "Extensions & Tools", description: "MCP servers, managed skills, and OMP plugins", Icon: Cable },
  { id: "native", label: "OMP Native Settings", description: "Schema-driven full omp config (all settings, via omp CLI)", Icon: ListTree },
  { id: "system", label: "System & Updates", description: "App updates, runtime version, and active session restart", Icon: RefreshCw },
  { id: "diagnostics", label: "Diagnostics & Recovery", description: "Service health, session locks, Rust host and repair actions", Icon: Activity },
  { id: "remote", label: "Remote Access", description: "Pair phones/PCs over LAN or a public tunnel", Icon: Smartphone },
];

export const getNormalizedActive = (tab: SettingsTab): SettingsTab => {
  if (tab === "skills" || tab === "plugins" || tab === "extensions") return "mcp";
  return tab;
};

export function SettingsTabs({
  active,
  onSelect,
  workspaceReady = true,
  layout = "vertical",
  width = 230,
  collapsed = false,
}: {
  active: SettingsTab;
  onSelect: (tab: SettingsTab) => void;
  workspaceReady?: boolean;
  layout?: "horizontal" | "vertical";
  /** Vertical nav width when expanded (desktop). */
  width?: number;
  /** Collapse the vertical nav to icon-only rail (desktop). */
  collapsed?: boolean;
}) {
  const { t } = useI18n();
  const currentActive = getNormalizedActive(active);
  const navRef = useRef<HTMLElement | null>(null);
  const selectedButtonRef = useRef<HTMLButtonElement | null>(null);
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    if (layout !== "vertical") return;
    const measure = () => {
      const nav = navRef.current;
      const button = selectedButtonRef.current;
      if (!nav || !button) return;
      const navRect = nav.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      setIndicator({ top: buttonRect.top - navRect.top + nav.scrollTop, height: buttonRect.height });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (observer && navRef.current) observer.observe(navRef.current);
    if (observer && selectedButtonRef.current) observer.observe(selectedButtonRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [currentActive, collapsed, width, layout, workspaceReady]);

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const enabled = SETTINGS_CATEGORIES.filter((tab) => !(tab.needsWorkspace && !workspaceReady));
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = index + 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = index - 1;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = enabled.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      const next = enabled[nextIndex] ?? enabled[index];
      if (next) {
        onSelect(next.id);
        const targetBtn = document.getElementById("settings-tab-" + next.id);
        targetBtn?.focus();
      }
    }
  };

  if (layout === "vertical") {
    return (
      <nav
        ref={navRef}
        aria-label={t("settingsTabs.ariaLabel")}
        role="tablist"
        aria-orientation="vertical"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          padding: "12px 8px",
          width: collapsed ? 48 : width,
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          background: "var(--bg-panel)",
          overflowY: "auto",
          transition: "width var(--dur-fast) var(--ease-out-warm)",
          position: "relative",
        }}
      >
        {indicator && (
          <span
            aria-hidden="true"
            className="settings-nav-indicator"
            style={{
              position: "absolute",
              top: indicator.top,
              left: 8,
              right: 8,
              height: indicator.height,
              borderRadius: "var(--radius-control)",
              background: "var(--bg-selected)",
              boxShadow: "inset 3px 0 0 var(--accent)",
              pointerEvents: "none",
              zIndex: 0,
              transition: "top var(--dur-med) var(--ease-out-warm), height var(--dur-med) var(--ease-out-warm)",
            }}
          />
        )}
        {SETTINGS_CATEGORIES.map(({ id, label, description, Icon, needsWorkspace }, index) => {
          const labelKey = `settingsTabs.${id}.label`;
          const descKey = `settingsTabs.${id}.description`;
          const trLabel = t(labelKey);
          const trDesc = t(descKey);
          const displayLabel = trLabel !== labelKey ? trLabel : label;
          const displayDescription = trDesc !== descKey ? trDesc : description;
          const selected = id === currentActive;
          const disabled = Boolean(needsWorkspace && !workspaceReady);
          const enabledIndex = SETTINGS_CATEGORIES.slice(0, index).filter((tab) => !(tab.needsWorkspace && !workspaceReady)).length;
          return (
            <button
              key={id}
              ref={selected ? selectedButtonRef : undefined}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={selected}
              aria-controls={`settings-panel-${id}`}
              aria-label={collapsed ? `${displayLabel}: ${displayDescription}` : undefined}
              title={collapsed ? `${displayLabel} — ${displayDescription}` : undefined}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              onClick={() => onSelect(id)}
              onKeyDown={(event) => onKeyDown(event, enabledIndex)}
              style={{
                display: "flex",
                alignItems: collapsed ? "center" : "flex-start",
                justifyContent: collapsed ? "center" : undefined,
                gap: 10,
                padding: collapsed ? "9px 0" : "9px 10px",
                border: "none",
                borderRadius: "var(--radius-control)",
                background: "transparent",
                color: selected ? "var(--text)" : disabled ? "var(--text-dim)" : "var(--text-muted)",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.5 : 1,
                textAlign: "left",
                transition: "background var(--dur-fast), color var(--dur-fast)",
                width: "100%",
                position: "relative",
                zIndex: 1,
              }}
            >
              <Icon size={16} aria-hidden="true" style={{ marginTop: collapsed ? 0 : 2, flexShrink: 0, color: selected ? "var(--accent)" : "currentColor" }} />
              {!collapsed && (
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ fontSize: 12.5, fontWeight: selected ? 600 : 500, lineHeight: 1.3, color: selected ? "var(--text)" : "inherit" }}>
                    {displayLabel}
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--text-dim)", lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {displayDescription}
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label={t("settingsTabs.ariaLabel")} role="tablist" style={{ display: "flex", gap: 3, padding: "7px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0, overflowX: "auto" }}>
      {SETTINGS_CATEGORIES.map(({ id, label, description, Icon, needsWorkspace }, index) => {
        const labelKey = `settingsTabs.${id}.label`;
        const descKey = `settingsTabs.${id}.description`;
        const trLabel = t(labelKey);
        const trDesc = t(descKey);
        const displayLabel = trLabel !== labelKey ? trLabel : label;
        const displayDescription = trDesc !== descKey ? trDesc : description;
        const selected = id === currentActive;
        const disabled = Boolean(needsWorkspace && !workspaceReady);
        const enabledIndex = SETTINGS_CATEGORIES.slice(0, index).filter((tab) => !(tab.needsWorkspace && !workspaceReady)).length;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={`settings-tab-${id}`}
            aria-selected={selected}
            aria-controls={`settings-panel-${id}`}
            aria-label={`${displayLabel}: ${displayDescription}`}
            title={displayDescription}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onSelect(id)}
            onKeyDown={(event) => onKeyDown(event, enabledIndex)}
            style={{ display: "inline-flex", alignItems: "flex-start", gap: 5, padding: "6px 9px", border: "none", borderRadius: "var(--radius-control)", background: selected ? "var(--bg-selected)" : "transparent", color: selected ? "var(--text)" : "var(--text-muted)", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1, fontSize: 12, whiteSpace: "nowrap", textAlign: "left", minWidth: 150 }}
          >
            <Icon size={13} aria-hidden="true" />
            <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
              <span style={{ fontWeight: selected ? 600 : 500 }}>{displayLabel}</span>
              <span style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-muted)", fontSize: 10, fontWeight: 400, lineHeight: 1.25 }}>{displayDescription}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

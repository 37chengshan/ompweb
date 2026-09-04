"use client";

import { Bot, Files } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export type RightPanelTab = "files" | "agents";

const TABS: Array<{ id: RightPanelTab; Icon: typeof Files; labelKey: string; fallback: string }> = [
  { id: "files", Icon: Files, labelKey: "rightPanel.files", fallback: "Files" },
  { id: "agents", Icon: Bot, labelKey: "rightPanel.agents", fallback: "Agents" },
];

/** Slim panel-level tab strip (Files / Agents) shown above the
 *  file TabBar. Counts render as tiny mono badges beside the label. */
export function RightPanelTabs({
  active,
  onSelect,
  counts,
}: {
  active: RightPanelTab;
  onSelect: (tab: RightPanelTab) => void;
  /** Per-tab badge counts (e.g. agents running/total). */
  counts?: Partial<Record<RightPanelTab, string | null>>;
}) {
  const { t } = useI18n();
  return (
    <div
      role="tablist"
      aria-label={t("rightPanel.tabs") ?? "Panel"}
      style={{ display: "flex", alignItems: "center", gap: 2, padding: "4px 6px 0", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0 }}
    >
      {TABS.map(({ id, Icon, labelKey, fallback }) => {
        const selected = id === active;
        const label = t(labelKey);
        const display = label !== labelKey ? label : fallback;
        const badge = counts?.[id] ?? null;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={`right-panel-tab-${id}`}
            aria-selected={selected}
            aria-controls={`right-panel-view-${id}`}
            onClick={() => onSelect(id)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "5px 9px", marginBottom: -1,
              border: "none", borderBottom: selected ? "2px solid var(--accent)" : "2px solid transparent",
              background: "transparent", color: selected ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer", fontSize: 11.5, fontWeight: selected ? 600 : 500,
              borderRadius: "var(--radius-control) var(--radius-control) 0 0",
              transition: "color var(--dur-fast) var(--ease-out-warm), border-color var(--dur-fast) var(--ease-out-warm)",
            }}
          >
            <Icon size={13} strokeWidth={1.8} aria-hidden style={{ color: selected ? "var(--accent)" : "currentColor" }} />
            {display}
            {badge && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: selected ? "var(--accent)" : "var(--text-dim)", padding: "0 4px", borderRadius: 6, background: "var(--bg-subtle)" }}>
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

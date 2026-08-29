"use client";

import { useI18n } from "@/lib/i18n";
import type { NativeSettings } from "@/lib/omp/settings-config";
import { Check } from "./ui/field";

const MODEL_ROLES = ["slow", "plan", "designer", "advisor", "smol", "task", "tiny", "vision", "commit", "default"] as const;

interface Props {
  settings: NativeSettings;
  /** Patch top-level native settings (merged by the parent). */
  onPatch: (patch: Partial<NativeSettings>) => void;
  /** Patch a nested section (e.g. generateImage: { enabled }) */
  onPatchSection: (key: keyof NativeSettings, patch: Record<string, unknown>) => void;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: "var(--radius-control)",
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 12,
};

const cardStyle: React.CSSProperties = {
  padding: 14,
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-card)",
  background: "var(--bg-panel)",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

/** Native OMP internal settings that live in config.yml but were not yet
 *  surfaced in the UI: model roles, feature toggles, and advanced strings. */
export function NativeExtrasSetting({ settings, onPatch, onPatchSection }: Props) {
  const { t } = useI18n();

  const toggle = (key: keyof NativeSettings, value: boolean) => onPatch({ [key]: value } as Partial<NativeSettings>);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{t("settingsConfig.internalSettings")}</div>
      <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>{t("settingsConfig.internalSettingsDesc")}</p>

      {/* Model roles */}
      <div style={cardStyle}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("settingsConfig.modelRoles")}</span>
        {MODEL_ROLES.map((role) => (
          <div key={role} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 80, flexShrink: 0, fontSize: 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{role}</span>
            <input
              type="text"
              defaultValue={settings.modelRoles?.[role] ?? ""}
              placeholder={t("settingsConfig.modelRolePlaceholder")}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value === (settings.modelRoles?.[role] ?? "")) return;
                const next = { ...(settings.modelRoles ?? {}) };
                if (value) next[role] = value;
                else delete next[role];
                onPatch({ modelRoles: next });
              }}
              style={inputStyle}
            />
          </div>
        ))}
      </div>

      {/* Feature toggles */}
      <div style={cardStyle}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("settingsConfig.featureToggles")}</span>
        <Check checked={settings.generateImage?.enabled ?? true} onChange={(v) => onPatchSection("generateImage", { enabled: v })} label={t("settingsConfig.generateImageEnabled")} />
        <Check checked={settings.computer?.enabled ?? true} onChange={(v) => onPatchSection("computer", { enabled: v })} label={t("settingsConfig.computerEnabled")} />
        <Check checked={settings.security?.enabled ?? false} onChange={(v) => onPatchSection("security", { enabled: v })} label={t("settingsConfig.securityEnabled")} />
        <Check checked={settings.github?.enabled ?? true} onChange={(v) => onPatchSection("github", { enabled: v })} label={t("settingsConfig.githubEnabled")} />
        <Check checked={settings.colorBlindMode ?? false} onChange={(v) => toggle("colorBlindMode", v)} label={t("settingsConfig.colorBlindMode")} />
        <Check checked={settings.contextPromotion?.enabled ?? false} onChange={(v) => onPatchSection("contextPromotion", { enabled: v })} label={t("settingsConfig.contextPromotionEnabled")} />
        <Check checked={settings.snapcompact?.toolResults ?? false} onChange={(v) => onPatchSection("snapcompact", { toolResults: v })} label={t("settingsConfig.snapcompactToolResults")} />
        <Check checked={settings.bash?.autoBackground?.enabled ?? true} onChange={(v) => onPatchSection("bash", { autoBackground: { enabled: v } })} label={t("settingsConfig.bashAutoBackgroundEnabled")} />
        <span style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>{t("settingsConfig.skillCompat")}</span>
        <Check checked={settings.skills?.enableCodexUser ?? false} onChange={(v) => onPatchSection("skills", { enableCodexUser: v })} label={t("settingsConfig.enableCodexUser")} />
        <Check checked={settings.skills?.enableAgentsUser ?? false} onChange={(v) => onPatchSection("skills", { enableAgentsUser: v })} label={t("settingsConfig.enableAgentsUser")} />
        <Check checked={settings.skills?.enableClaudeUser ?? false} onChange={(v) => onPatchSection("skills", { enableClaudeUser: v })} label={t("settingsConfig.enableClaudeUser")} />
        <Check checked={settings.skills?.enableClaudeProject ?? false} onChange={(v) => onPatchSection("skills", { enableClaudeProject: v })} label={t("settingsConfig.enableClaudeProject")} />
      </div>

      {/* Advanced strings */}
      <div style={cardStyle}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{t("settingsConfig.advancedStrings")}</span>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>
          {t("settingsConfig.memoryModel")}
          <input
            type="text"
            defaultValue={settings.providers?.memoryModel ?? ""}
            placeholder="qwen3-1.7b"
            onBlur={(e) => {
              const value = e.target.value.trim();
              if (value !== (settings.providers?.memoryModel ?? "")) onPatchSection("providers", { memoryModel: value || null });
            }}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>
          {t("settingsConfig.webSearchOrder")}
          <input
            type="text"
            defaultValue={(settings.providers?.webSearchOrder ?? []).join(", ")}
            placeholder="searxng, bing"
            onBlur={(e) => {
              const value = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
              const current = settings.providers?.webSearchOrder ?? [];
              if (JSON.stringify(value) !== JSON.stringify(current)) onPatchSection("providers", { webSearchOrder: value });
            }}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>
          {t("settingsConfig.editMode")}
          <input
            type="text"
            defaultValue={settings.edit?.mode ?? ""}
            placeholder="hashline"
            onBlur={(e) => {
              const value = e.target.value.trim();
              if (value !== (settings.edit?.mode ?? "")) onPatchSection("edit", { mode: value || null });
            }}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>
          {t("settingsConfig.composerShape")}
          <input
            type="text"
            defaultValue={settings.composer?.shape ?? ""}
            placeholder="box"
            onBlur={(e) => {
              const value = e.target.value.trim();
              if (value !== (settings.composer?.shape ?? "")) onPatchSection("composer", { shape: value || null });
            }}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>
          {t("settingsConfig.autoqaConsent")}
          <input
            type="text"
            defaultValue={settings.dev?.autoqaConsent ?? ""}
            placeholder="granted"
            onBlur={(e) => {
              const value = e.target.value.trim();
              if (value !== (settings.dev?.autoqaConsent ?? "")) onPatchSection("dev", { autoqaConsent: value || null });
            }}
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--text-muted)" }}>
          {t("settingsConfig.symbolPreset")}
          <input
            type="text"
            defaultValue={settings.symbolPreset ?? ""}
            placeholder="unicode"
            onBlur={(e) => {
              const value = e.target.value.trim();
              if (value !== (settings.symbolPreset ?? "")) onPatch({ symbolPreset: value || null });
            }}
            style={inputStyle}
          />
        </label>
      </div>
    </section>
  );
}

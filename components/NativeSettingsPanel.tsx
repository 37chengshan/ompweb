"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Braces, ChevronDown, Cpu, Database, RefreshCw, RotateCcw, Save, Search, ShieldCheck, Wrench } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { createOmpwebClient } from "@/lib/client";
import {
  translateDescription,
  translateKeyTitle,
  translateSubgroup,
  translateEnumOption,
  formatSettingType,
} from "@/lib/omp/settings-descriptions-zh";
import { Dialog, DialogContent, DialogTitle } from "./ui/primitives";
import { toast } from "./ui/toast";

const client = createOmpwebClient("legacy-http");
export interface NativeSettingRow { key: string; value: unknown; type: string; description?: string; redacted?: boolean; }
// Settings are opened both inline and in the standalone dialog.  Keep one
// browser-local snapshot and one in-flight request so opening the dialog does
// not briefly flash an empty state or issue a second 481-key fetch.
let nativeSettingsCache: NativeSettingRow[] | null = null;
let nativeSettingsRequest: Promise<NativeSettingRow[]> | null = null;
// OMP's schema has many technical prefixes, but exposing every prefix as a
// top-level tab makes the native settings screen unusable. Keep the schema
// keys intact while folding them into eight stable user-facing sections.
const GROUP_ALIASES: Record<string, string> = {
  advisor: "agents", retry: "agents", compaction: "agents", power: "system", prewalk: "system",
  tools: "tools", bash: "tools", security: "tools", git: "tools", terminal: "tools", command: "tools", permission: "tools",
  memory: "memory", autolearn: "memory", mnemopi: "memory", contextPromotion: "memory", snapcompact: "memory", cache: "memory",
  model: "model", generate_image: "model", generateImage: "model", enabledModels: "model", disabledModels: "model", disabledProviders: "model", image: "model",
  mcp: "integrations", providers: "integrations", skills: "integrations", github: "integrations", auth: "integrations", extensions: "integrations",
  edit: "general", composer: "general", session: "general", display: "general", message: "general", file: "general", prompt: "general",
  dev: "developer", eval: "developer", logging: "developer", journal: "developer",
};
const GROUP_META: Record<string, { label: string; zh: string; explanation: string; Icon: typeof Bot }> = {
  general: { label: "General", zh: "通用", explanation: "控制界面、会话、输入和编辑体验。", Icon: Wrench },
  model: { label: "Model", zh: "模型", explanation: "设置模型默认值、思考深度、采样和图像能力。", Icon: Cpu },
  tools: { label: "Tools & Safety", zh: "工具与安全", explanation: "管理工具、终端、审批、沙箱和 Git 操作边界。", Icon: ShieldCheck },
  agents: { label: "Agents", zh: "智能体", explanation: "配置顾问、重试回退和长会话压缩策略。", Icon: Bot },
  memory: { label: "Memory & Context", zh: "记忆与上下文", explanation: "管理记忆后端、自动学习和上下文召回。", Icon: Database },
  integrations: { label: "Integrations", zh: "集成", explanation: "管理提供商、MCP、技能、GitHub 和扩展。", Icon: Braces },
  developer: { label: "Developer", zh: "开发者", explanation: "开发、评估、日志和诊断相关的高级选项。", Icon: Wrench },
  system: { label: "System", zh: "系统", explanation: "启动、性能和 OMP 运行时级别的系统选项。", Icon: Cpu },
};
const GROUP_ORDER = ["general", "model", "tools", "agents", "memory", "integrations", "developer", "system"];
const UNPREFIXED_GROUP: Record<string, string> = {
  defaultThinkingLevel: "model", textVerbosity: "model", personality: "model", externalThinking: "model", hideThinkingBlock: "model", compactThinkingLevel: "model", maxEffort: "model",
  approvalMode: "tools", autoResume: "general", colorBlindMode: "general", cycleOrder: "general", display: "general", language: "general", mode: "general", showImages: "general", showSplash: "general", smoothStreaming: "general",
};
const GROUP_LABELS_ZH: Record<string, string> = {
  ask: "询问",
  astEdit: "AST 编辑",
  astGrep: "AST 搜索",
  async: "异步任务",
  cache: "缓存",
  command: "命令",
  context: "上下文",
  eval: "评估",
  file: "文件",
  image: "图像",
  journal: "日志",
  logging: "日志",
  message: "消息",
  permission: "权限",
  prompt: "提示词",
  session: "会话",
  snapshot: "快照",
  terminal: "终端",
};
function groupOf(key: string): string {
  const head = key.split(".")[0];
  if (UNPREFIXED_GROUP[key]) return GROUP_ALIASES[UNPREFIXED_GROUP[key]] ?? UNPREFIXED_GROUP[key];
  if (GROUP_ALIASES[head]) return GROUP_ALIASES[head];
  if (key.includes("model") || key.includes("Model")) return "model";
  // Unknown schema prefixes belong in System rather than silently creating a
  // ninth, tenth, ... tab every time OMP adds a key.
  return key.includes(".") ? "system" : "general";
}
function labelOf(group: string, locale?: string | null): string { const meta = GROUP_META[group]; if (meta) return locale?.startsWith("zh") ? meta.zh : meta.label; return locale?.startsWith("zh") ? (GROUP_LABELS_ZH[group] ?? group.replace(/[-_]/g, " ")) : group.replace(/[-_]/g, " "); }
function explanationOf(group: string, locale?: string | null): string { const meta = GROUP_META[group]; return locale?.startsWith("zh") ? (meta?.explanation ?? "按 OMP schema 管理这一组原生配置项。") : (meta ? `Configure ${meta.label.toLowerCase()} behavior.` : "Schema-driven OMP configuration."); }
function iconOf(group: string) { return GROUP_META[group]?.Icon ?? Wrench; }
function parseTypedValue(type: string, text: string, locale?: string | null): { ok: true; value: unknown } | { ok: false; error: string } {
  const isZh = locale?.startsWith("zh");
  const value = text.trim();
  if (type === "number") {
    if (!value) return { ok: true, value: undefined };
    const n = Number(value);
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: isZh ? "请输入有效数字" : "Please enter a valid number" };
  }
  if (type === "boolean") {
    return value === "true" || value === "false"
      ? { ok: true, value: value === "true" }
      : { ok: false, error: isZh ? "请输入 true 或 false" : "Please enter true or false" };
  }
  if (["array", "record", "object"].includes(type)) {
    if (!value) return { ok: true, value: undefined };
    try {
      return { ok: true, value: JSON.parse(value) };
    } catch {
      return { ok: false, error: isZh ? "请输入有效 JSON 格式" : "Please enter valid JSON" };
    }
  }
  return { ok: true, value };
}
function formatValue(type: string, value: unknown): string { if (value == null) return ""; if (["array", "record", "object"].includes(type)) { try { return JSON.stringify(value, null, 2); } catch { return String(value); } } return String(value); }
const ENUM_OPTIONS: Record<string, string[]> = {
  "memory.backend": ["off", "local", "mnemopi", "hindsight", "sharpshooter"],
  "compaction.strategy": ["snapcompact", "handoff", "context-full", "shake", "off"],
  "tools.approvalMode": ["always-ask", "write", "yolo"],
  approvalMode: ["always-ask", "write", "yolo"],
  defaultThinkingLevel: ["auto", "minimal", "low", "medium", "high", "xhigh", "max"],
  compactThinkingLevel: ["auto", "minimal", "low", "medium", "high", "xhigh", "max"],
  textVerbosity: ["low", "medium", "high"],
  "power.sleepPrevention": ["none", "idle", "active"],
  "update.channel": ["stable", "beta", "nightly"],
  symbolPreset: ["unicode", "nerd", "ascii"],
  "edit.mode": ["hashline", "patch", "whole"],
  "dev.autoqaConsent": ["granted", "denied"],
  "hindsight.recallBudget": ["low", "mid", "high"],
  "hindsight.retainMode": ["off", "auto", "manual"],
  "stt.submitTrigger": ["never", "release", "sentence", "keyword"],
  "shellMinimizer.sourceOutlineLevel": ["off", "minimal", "full"],
  "python.kernelMode": ["auto", "persistent", "isolated"],
  "isolation.backend": ["auto", "cow", "projfs", "worktree"],
  "speech.mode": ["off", "streaming", "batch"],
};

function NativeSettingsRow({ row, saving, onSave, onReset }: { row: NativeSettingRow; saving: boolean; onSave: (key: string, value: unknown) => void; onReset: (key: string) => void }) {
  const { t, locale } = useI18n();
  const isZh = locale?.startsWith("zh");
  const [text, setText] = useState(() => formatValue(row.type, row.value));
  const [dirty, setDirty] = useState(false);
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setText(formatValue(row.type, row.value)); }, [row.type, row.value]);
  const saveText = () => {
    if (!dirty) return;
    const parsed = parseTypedValue(row.type, text, locale);
    if (!parsed.ok) { toast.error(parsed.error); return; }
    setDirty(false);
    editing.current = false;
    if (parsed.value !== undefined) onSave(row.key, parsed.value);
  };
  const readOnly = row.redacted === true || row.type === "unknown";
  const enumOptions = row.type === "enum" ? (ENUM_OPTIONS[row.key] ?? ENUM_OPTIONS[row.key.split(".").pop() ?? ""] ?? []) : [];
  const friendlyTitle = translateKeyTitle(locale, row.key);
  const description = translateDescription(locale, row.description, row.key);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1fr) minmax(180px,42%) auto", gap: 12, alignItems: "center", padding: "10px 4px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          {friendlyTitle && (
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>
              {friendlyTitle}
            </span>
          )}
          <code style={{ fontFamily: "var(--font-mono)", fontSize: friendlyTitle ? 11 : 11.5, color: friendlyTitle ? "var(--text-muted)" : "var(--text)", overflowWrap: "anywhere" }}>
            {row.key}
          </code>
          <span style={{ color: "var(--text-dim)", font: "10px var(--font-mono)", padding: "1px 5px", borderRadius: 4, background: "var(--bg-subtle)" }}>
            {formatSettingType(locale, row.type)}
          </span>
        </div>
        {description && (
          <div style={{ marginTop: 3, color: "var(--text-muted)", fontSize: 10.5, lineHeight: 1.4 }}>
            {description}
          </div>
        )}
      </div>
      <div>
        {row.type === "boolean" ? (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--text)", fontSize: 11.5, cursor: readOnly || saving ? "default" : "pointer" }}>
            <input
              type="checkbox"
              aria-label={row.key}
              checked={row.value === true}
              disabled={readOnly || saving}
              onChange={(e) => onSave(row.key, e.target.checked)}
              style={{ accentColor: "var(--accent)", width: 16, height: 16 }}
            />
            <span>{row.value === true ? (isZh ? "开启 (true)" : "true") : (isZh ? "关闭 (false)" : "false")}</span>
          </label>
        ) : enumOptions.length > 0 ? (
          <div style={{ position: "relative" }}>
            <select
              aria-label={row.key}
              value={String(row.value ?? "")}
              disabled={readOnly || saving}
              onChange={(e) => onSave(row.key, e.target.value)}
              style={{ width: "100%", minHeight: 32, padding: "4px 28px 4px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg)", color: "var(--text)", appearance: "none", fontSize: 11.5 }}
            >
              <option value="">{isZh ? "— 默认 / 未指定 —" : "—"}</option>
              {enumOptions.map((option) => (
                <option key={option} value={option}>
                  {translateEnumOption(locale, row.key, option)}
                </option>
              ))}
            </select>
            <ChevronDown size={13} style={{ position: "absolute", right: 8, top: 9, pointerEvents: "none", color: "var(--text-dim)" }} />
          </div>
        ) : (
          <textarea
            aria-label={row.key}
            value={text}
            disabled={readOnly || saving}
            rows={["array", "record", "object"].includes(row.type) ? 2 : 1}
            spellCheck={false}
            placeholder={["array", "record", "object"].includes(row.type) ? (isZh ? "输入有效 JSON（留空表示默认）" : "Valid JSON (leave empty for default)") : (isZh ? "留空表示使用默认值" : "Default / unset")}
            onChange={(e) => { setText(e.target.value); setDirty(true); editing.current = true; }}
            onBlur={saveText}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) (e.target as HTMLTextAreaElement).blur(); }}
            style={{ width: "100%", boxSizing: "border-box", resize: "vertical", minHeight: 32, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: readOnly ? "var(--bg-subtle)" : "var(--bg)", color: readOnly ? "var(--text-dim)" : "var(--text)", font: "11px var(--font-mono)" }}
          />
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 3 }}>
        {dirty && (
          <button
            type="button"
            title={t("settingsConfig.save") ?? (isZh ? "保存修改" : "Save")}
            aria-label={isZh ? `保存 ${row.key}` : `Save ${row.key}`}
            onClick={saveText}
            style={{ padding: 5, border: 0, background: "none", color: "var(--accent)", cursor: "pointer" }}
          >
            <Save size={13} />
          </button>
        )}
        <button
          type="button"
          title={t("ompSettings.resetToDefault") ?? (isZh ? "重置为 OMP 默认值" : "Reset to OMP default")}
          aria-label={isZh ? `重置 ${row.key}` : `Reset ${row.key}`}
          onClick={() => onReset(row.key)}
          disabled={saving}
          style={{ padding: 5, border: 0, background: "none", color: "var(--text-dim)", cursor: saving ? "default" : "pointer" }}
        >
          <RotateCcw size={12} />
        </button>
      </div>
    </div>
  );
}

export function NativeSettingsPanel({ onClose, onOpenStandalone, standalone = false }: { onClose?: () => void; onOpenStandalone?: () => void; standalone?: boolean }) {
  const { t, locale } = useI18n();
  const isZh = locale?.startsWith("zh");
  const isJa = locale?.startsWith("ja");
  const [rows, setRows] = useState<NativeSettingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [activeGroup, setActiveGroup] = useState("general");
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (force = false) => {
    setRefreshing(true);
    try {
      if (!force && nativeSettingsCache) {
        setRows(nativeSettingsCache);
        setError(null);
        return;
      }
      if (!nativeSettingsRequest) {
        nativeSettingsRequest = client.nativeSettings.list().then((data) => {
          nativeSettingsCache = data.settings;
          return data.settings;
        }).finally(() => {
          nativeSettingsRequest = null;
        });
      }
      const nextRows = await nativeSettingsRequest;
      setRows(nextRows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const groups = useMemo(() => [...new Set((rows ?? []).map((r) => groupOf(r.key)))].sort((a, b) => (GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b)) || a.localeCompare(b)), [rows]);
  useEffect(() => {
    if (groups.length && !groups.includes(activeGroup)) setActiveGroup(groups[0]);
  }, [groups, activeGroup]);

  // A search is global across the schema; without this, a key in another
  // category incorrectly reports "no settings" until the user guesses the
  // right category first.
  const searching = filter.trim().length > 0;
  const visible = useMemo(() => {
    if (!searching) {
      return (rows ?? []).filter((r) => groupOf(r.key) === activeGroup);
    }
    const q = filter.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      const keyMatch = r.key.toLowerCase().includes(q);
      const descEn = (r.description ?? "").toLowerCase();
      const descZh = translateDescription(locale, r.description, r.key)?.toLowerCase() ?? "";
      const titleZh = translateKeyTitle(locale, r.key)?.toLowerCase() ?? "";
      const sub = r.key.includes(".") ? r.key.split(".")[1] : "general";
      const subZh = translateSubgroup(locale, sub).toLowerCase();
      return keyMatch || descEn.includes(q) || descZh.includes(q) || titleZh.includes(q) || subZh.includes(q);
    });
  }, [rows, activeGroup, filter, searching, locale]);

  const subgroups = useMemo(() => [...new Set(visible.map((r) => r.key.includes(".") ? r.key.split(".")[1] : "general"))].sort(), [visible]);
  const filtered = searching || !activeSub ? visible : visible.filter((r) => (r.key.split(".")[1] ?? "general") === activeSub);
  const sectionLabel = searching ? (isZh ? "搜索结果" : isJa ? "検索結果" : "Search results") : labelOf(activeGroup, locale);

  const save = async (key: string, value: unknown) => {
    setSavingKey(key);
    try {
      await client.nativeSettings.set(key, value);
      setRows((prev) => {
        const next = prev?.map((r) => r.key === key ? { ...r, value } : r) ?? prev;
        if (next) nativeSettingsCache = next;
        return next;
      });
      toast.success(isZh ? `已保存 ${key}` : `${key} saved`);
    } catch (e) {
      toast.error((isZh ? "保存失败: " : "") + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingKey(null);
    }
  };

  const reset = async (key: string) => {
    setSavingKey(key);
    try {
      await client.nativeSettings.reset(key);
      await load(true);
      toast.success(isZh ? `已将 ${key} 重置为默认值` : `${key} reset`);
    } catch (e) {
      toast.error((isZh ? "重置失败: " : "") + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingKey(null);
    }
  };

  const body = (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* 顶部操作工具栏 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", flexWrap: "wrap", padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
        <div style={{ display: "inline-flex", alignItems: "baseline", gap: 8, flexShrink: 0 }}>
          <strong style={{ color: "var(--text)", fontSize: 13 }}>
            {t("settingsTabs.native.label") ?? (isZh ? "OMP 原生设置" : "OMP Native Settings")}
          </strong>
          <span style={{ color: "var(--text-dim)", font: "11px var(--font-mono)" }}>
            {rows?.length ?? "…"} {isZh ? "项设置" : isJa ? "設定" : "settings"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 280px", minWidth: 0 }}>
          <Search size={14} color="var(--text-dim)" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("settingsConfig.searchSettings") ?? (isZh ? "搜索设置项（支持键名、中文说明或分类）…" : "Search settings…")}
            style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: "transparent", color: "var(--text)", fontSize: 12.5 }}
          />
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, padding: "5px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg)", color: "var(--text)", cursor: refreshing ? "wait" : "pointer", fontSize: 12 }}
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : undefined} />
            {t("ompSettings.refresh") ?? (isZh ? "刷新" : "Refresh")}
          </button>
          {onOpenStandalone && !standalone && (
            <button
              type="button"
              onClick={onOpenStandalone}
              style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, padding: "5px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", fontSize: 11.5 }}
            >
              {t("ompSettings.openWindow") ?? (isZh ? "在独立窗口打开" : "Open in separate window")}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close") ?? "关闭"}
              title={t("common.close") ?? "关闭"}
              style={{ padding: 5, border: 0, background: "none", color: "var(--text-muted)", fontSize: 18, cursor: "pointer" }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* 主分类 Tab 栏 */}
      <div style={{ display: "flex", gap: 4, overflowX: "auto", padding: "7px 10px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
        {groups.map((group) => {
          const Icon = iconOf(group);
          const label = labelOf(group, locale);
          return (
            <button
              type="button"
              key={group}
              onClick={() => {
                setActiveGroup(group);
                setActiveSub(null);
              }}
              title={label}
              aria-pressed={activeGroup === group}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
                padding: "6px 10px",
                border: 0,
                borderRadius: "var(--radius-control)",
                background: activeGroup === group ? "var(--bg-selected)" : "transparent",
                color: activeGroup === group ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer",
                fontSize: 11.5,
                fontWeight: activeGroup === group ? 600 : 400,
              }}
            >
              <Icon size={14} color={activeGroup === group ? "var(--accent)" : "currentColor"} />
              {label}
            </button>
          );
        })}
      </div>

      {/* 内容区域：左侧子分类侧边栏 + 右侧配置项列表 */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <nav
          aria-label={isZh ? "原生设置分类导航" : "Native setting sections"}
          style={{ width: 160, flexShrink: 0, overflowY: "auto", padding: "10px 8px", borderRight: "1px solid var(--border)", background: "var(--bg-panel)" }}
        >
          <button
            type="button"
            onClick={() => setActiveSub(null)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "7px 8px",
              border: 0,
              borderRadius: 6,
              background: activeSub === null ? "var(--bg-selected)" : "transparent",
              color: "var(--text)",
              cursor: "pointer",
              fontSize: 11.5,
              fontWeight: activeSub === null ? 600 : 400,
            }}
          >
            <span>{isZh ? `全部 · ${labelOf(activeGroup, locale)}` : `All · ${labelOf(activeGroup, locale)}`}</span>
            <span style={{ font: "10px var(--font-mono)", color: "var(--text-dim)" }}>{visible.length}</span>
          </button>
          {subgroups.map((sub) => {
            const count = visible.filter((r) => (r.key.split(".")[1] ?? "general") === sub).length;
            const label = translateSubgroup(locale, sub);
            return (
              <button
                type="button"
                key={sub}
                onClick={() => setActiveSub(sub)}
                title={sub !== label ? `${label} (${sub})` : label}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "7px 8px",
                  border: 0,
                  borderRadius: 6,
                  background: activeSub === sub ? "var(--bg-selected)" : "transparent",
                  color: activeSub === sub ? "var(--text)" : "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 11.5,
                  fontWeight: activeSub === sub ? 600 : 400,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                <span style={{ font: "10px var(--font-mono)", color: "var(--text-dim)", marginLeft: 4 }}>{count}</span>
              </button>
            );
          })}
        </nav>

        <main style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "8px 14px" }}>
          {error ? (
            <div role="alert" style={{ color: "var(--status-error)", padding: 12, fontSize: 12 }}>{error}</div>
          ) : rows === null ? (
            <div role="status" aria-live="polite" style={{ color: "var(--text-dim)", padding: 16, fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <RefreshCw size={13} className="animate-spin" aria-hidden="true" />
              {isZh ? "正在加载 OMP 设置…" : isJa ? "OMP 設定を読み込み中…" : "Loading OMP settings…"}
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ color: "var(--text-dim)", padding: 16, fontSize: 12 }}>
              {isZh ? "没有匹配的设置。" : "No settings match the filter."}
            </div>
          ) : (
            <section aria-label={`${sectionLabel} settings`}>
              <h3 style={{ margin: "4px 0 2px", fontSize: 14, fontWeight: 650 }}>
                {sectionLabel}
                {activeSub && <span style={{ marginLeft: 6, color: "var(--text-muted)", fontWeight: 500, fontSize: 12.5 }}>· {translateSubgroup(locale, activeSub)}</span>}
                <span style={{ marginLeft: 8, color: "var(--text-dim)", font: "10px var(--font-mono)" }}>{filtered.length}</span>
              </h3>
              <p style={{ margin: "0 0 8px", color: "var(--text-muted)", fontSize: 11 }}>
                {searching
                  ? (isZh ? "按键名、中文标题与说明筛选全部 OMP 配置项。" : isJa ? "キー名と説明から OMP schema 全体を検索します。" : "Search the complete OMP schema by key and description.")
                  : explanationOf(activeGroup, locale)}
              </p>
              {filtered.map((row) => (
                <NativeSettingsRow
                  key={row.key}
                  row={row}
                  saving={savingKey === row.key}
                  onSave={(key, value) => void save(key, value)}
                  onReset={(key) => void reset(key)}
                />
              ))}
            </section>
          )}
        </main>
      </div>
    </div>
  );

  if (standalone) {
    return (
      <Dialog open onOpenChange={(open) => { if (!open) onClose?.(); }}>
        <DialogContent ariaLabel={isZh ? "OMP 原生设置" : "OMP Native Settings"} style={{ width: "min(1100px, calc(100vw - 32px))", height: "min(780px, calc(100dvh - 32px))", maxWidth: "none", maxHeight: "none", padding: 0, overflow: "hidden" }}>
          <DialogTitle style={{ position: "absolute", left: -10000, width: 1, height: 1, overflow: "hidden" }}>
            {isZh ? "OMP 原生设置" : "OMP Native Settings"}
          </DialogTitle>
          {body}
        </DialogContent>
      </Dialog>
    );
  }
  return body;
}

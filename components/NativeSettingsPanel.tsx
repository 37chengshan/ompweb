"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Save, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { createOmpwebClient } from "@/lib/client";
import { toast } from "./ui/toast";

// Route 1 (doc 16): native-settings traffic goes through the OmpWebClient
// facade; legacy-http is the transport today (TauriCore/Remote later).
const client = createOmpwebClient("legacy-http");

/** One schema-driven native setting (mirror of GET /api/native-settings). */
export interface NativeSettingRow {
  key: string;
  value: unknown;
  type: string;
  description?: string;
  redacted?: boolean;
}

const GROUP_KEYS = [
  "advisor", "tools", "retry", "compaction", "memory", "autolearn", "mnemopi",
  "mcp", "providers", "skills", "bash", "security", "github", "contextPromotion",
  "snapcompact", "edit", "composer", "dev", "generate_image", "generateImage",
  "power", "prewalk", "auth", "git", "model", "extensions", "enabledModels",
  "disabledModels", "disabledProviders",
] as const;

function groupOf(key: string): string {
  const dot = key.indexOf(".");
  if (dot <= 0) return "general";
  const head = key.slice(0, dot);
  return (GROUP_KEYS as readonly string[]).includes(head) ? head : "general";
}

function typeLabel(type: string): string {
  switch (type) {
    case "boolean": return "boolean";
    case "number": return "number";
    case "enum": return "enum";
    case "array": return "array";
    case "record": return "record";
    case "string": return "string";
    default: return type;
  }
}

/** Parse a text-box value back to its native JSON for the CLI. */
function parseTypedValue(type: string, text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (type === "number") {
    if (trimmed === "") return { ok: true, value: undefined };
    const n = Number(trimmed);
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: `"${trimmed}" is not a number` };
  }
  if (type === "boolean") {
    if (trimmed === "true") return { ok: true, value: true };
    if (trimmed === "false") return { ok: true, value: false };
    return { ok: false, error: `"${trimmed}" is not a boolean` };
  }
  if (type === "array" || type === "record") {
    if (trimmed === "") return { ok: true, value: undefined };
    try {
      return { ok: true, value: JSON.parse(trimmed) };
    } catch {
      return { ok: false, error: "Invalid JSON" };
    }
  }
  return { ok: true, value: trimmed };
}

function formatValue(type: string, value: unknown): string {
  if (value === undefined || value === null) return "";
  if (type === "array" || type === "record") {
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }
  return String(value);
}

function NativeSettingsRow({ row, saving, onSave, onReset }: {
  row: NativeSettingRow;
  saving: boolean;
  onSave: (key: string, value: unknown) => void;
  onReset: (key: string) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(() => formatValue(row.type, row.value));
  const [dirty, setDirty] = useState(false);
  // The row value can change from a reset elsewhere; keep the text in sync
  // unless the user is mid-edit.
  const editingRef = useRef(false);
  useEffect(() => {
    if (!editingRef.current) setText(formatValue(row.type, row.value));
  }, [row.value, row.type]);

  const saveText = () => {
    if (!dirty) return;
    const parsed = parseTypedValue(row.type, text);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }
    setDirty(false);
    editingRef.current = false;
    if (parsed.value === undefined) return; // empty = untouched
    onSave(row.key, parsed.value);
  };

  const isBool = row.type === "boolean";
  const isReadOnly = row.redacted === true || row.type === "unknown";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: "2px 12px", padding: "8px 4px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
          <code style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text)", wordBreak: "break-all" }}>{row.key}</code>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--text-dim)", flexShrink: 0 }}>{typeLabel(row.type)}</span>
        </div>
        {row.description && (
          <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>{row.description}</div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {isBool ? (
          <input
            type="checkbox"
            aria-label={row.key}
            checked={row.value === true}
            disabled={isReadOnly}
            onChange={(e) => onSave(row.key, e.target.checked)}
            style={{ accentColor: "var(--accent)", width: 15, height: 15 }}
          />
        ) : (
          <input
            type="text"
            aria-label={row.key}
            value={text}
            disabled={isReadOnly || saving}
            spellCheck={false}
            onChange={(e) => { setText(e.target.value); setDirty(true); editingRef.current = true; }}
            onBlur={saveText}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            style={{
              width: 240, maxWidth: "38vw", padding: "4px 7px",
              borderRadius: "var(--radius-control)", border: "1px solid var(--border)",
              background: isReadOnly ? "var(--bg-subtle)" : "var(--bg)",
              color: isReadOnly ? "var(--text-dim)" : "var(--text)",
              fontFamily: "var(--font-mono)", fontSize: 11, outline: "none",
            }}
          />
        )}
        {dirty && !isBool && (
          <button
            type="button"
            title={t("settingsConfig.save") ?? "Save"}
            aria-label={`${t("settingsConfig.save") ?? "Save"} ${row.key}`}
            onClick={saveText}
            style={{ display: "inline-flex", padding: 4, border: "none", background: "none", color: "var(--accent)", cursor: "pointer" }}
          >
            <Save size={13} />
          </button>
        )}
        <button
          type="button"
          title={t("ompSettings.resetToDefault") ?? "Reset to OMP default"}
          aria-label={`Reset ${row.key}`}
          onClick={() => onReset(row.key)}
          style={{ display: "inline-flex", padding: 4, border: "none", background: "none", color: "var(--text-dim)", cursor: "pointer" }}
        >
          <RotateCcw size={12} />
        </button>
      </div>
    </div>
  );
}

export function NativeSettingsPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<NativeSettingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const data = await client.nativeSettings.list();
      setRows(data.settings);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setRefreshing(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const groups = useMemo(() => {
    if (!rows) return [];
    const byGroup = new Map<string, NativeSettingRow[]>();
    for (const row of rows) {
      if (filter && !row.key.toLowerCase().includes(filter.toLowerCase())) continue;
      const g = groupOf(row.key);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(row);
    }
    return [...byGroup.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, filter]);

  const save = async (key: string, value: unknown) => {
    setSavingKey(key);
    try {
      await client.nativeSettings.set(key, value);
      toast.success(`${key} saved`);
      // Update the row's value in place (a reset elsewhere re-reads the row).
      setRows((prev) => prev?.map((r) => (r.key === key ? { ...r, value } : r)) ?? prev);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKey(null);
    }
  };

  const reset = async (key: string) => {
    setSavingKey(key);
    try {
      await client.nativeSettings.reset(key);
      toast.success(`${key} reset`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
        <Search size={13} style={{ color: "var(--text-dim)" }} aria-hidden />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("settingsConfig.searchSettings") ?? "Filter settings…"}
          style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--text)", fontSize: 12.5 }}
        />
        <span style={{ fontSize: 10.5, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
          {rows ? rows.length : "…"}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          disabled={refreshing}
          style={{ padding: "3px 8px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text)", fontSize: 11, cursor: "pointer" }}
        >
          {refreshing ? "…" : t("ompSettings.refresh") ?? "Refresh"}
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={{ padding: "3px 8px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text)", fontSize: 11, cursor: "pointer" }}
          >
            ✕
          </button>
        )}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 10px" }}>
        {error && (
          <div style={{ padding: "12px 8px", color: "var(--status-error)", fontSize: 12, whiteSpace: "pre-wrap" }}>
            {error}
          </div>
        )}
        {!error && rows !== null && groups.length === 0 && (
          <div style={{ padding: "16px 8px", color: "var(--text-dim)", fontSize: 12 }}>
            {t("ompSettings.noMatches") ?? "No settings match the filter."}
          </div>
        )}
        {!error && groups.map(([group, items]) => {
          const isCollapsed = collapsed[group] === true;
          return (
            <section key={group} style={{ marginTop: 8 }}>
              <button
                type="button"
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed((c) => ({ ...c, [group]: !isCollapsed }))}
                style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "6px 2px", border: "none", background: "none", color: "var(--text)", cursor: "pointer", textAlign: "left", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em" }}
              >
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>{isCollapsed ? "▸" : "▾"}</span>
                {group}
                <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 10.5, fontWeight: 400 }}>{items.length}</span>
              </button>
              {!isCollapsed && (
                <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--bg-panel)", padding: "0 10px", marginTop: 2 }}>
                  {items.map((row) => (
                    <NativeSettingsRow
                      key={row.key}
                      row={row}
                      saving={savingKey === row.key}
                      onSave={(k, v) => void save(k, v)}
                      onReset={(k) => void reset(k)}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

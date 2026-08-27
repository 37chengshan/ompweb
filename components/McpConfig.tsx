"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Code,
  Globe,
  Plus,
  RefreshCw,
  Search,
  Sliders,
  Sparkles,
  Terminal,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";

type McpServer = { name: string; config: Record<string, unknown> };
type BuiltinMcpPreset = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  author: string;
  version: string;
  tools: string[];
  config: Record<string, unknown>;
  isAvailable: boolean;
  installedPath?: string;
};
type McpUserConfig = { path: string; servers: Array<{ name: string; status: string; type: string; enabled: boolean; valid: boolean }>; disabledServers: string[]; error?: string };
type McpLiveStatus = "connected" | "connecting" | "not_connected" | "inactive" | "disabled" | "configured";
type McpLiveServer = { name: string; source: string; status: McpLiveStatus; type?: string };

const inputStyle = {
  width: "100%",
  padding: "7px 10px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-control)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
} as const;

function serverSummary(config: Record<string, unknown>): { type: string; target: string; enabled: boolean; valid: boolean } {
  const type = typeof config.type === "string" && config.type !== "stdio" ? config.type : "stdio";
  const command = typeof config.command === "string" ? config.command.trim() : "";
  const url = typeof config.url === "string" ? config.url.trim() : "";
  const hasCommand = command.length > 0;
  const hasUrl = url.length > 0;
  const valid = (hasCommand || hasUrl) && !(hasCommand && hasUrl) && (type === "http" || type === "sse" ? hasUrl : hasCommand);
  return {
    type,
    target: type === "http" || type === "sse" ? url : `${command}${Array.isArray(config.args) ? " " + config.args.join(" ") : ""}`.trim(),
    enabled: config.enabled !== false,
    valid,
  };
}

export function McpConfig({ cwd, sessionId }: { cwd: string | null; sessionId?: string | null }) {
  const { t } = useI18n();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [builtinPresets, setBuiltinPresets] = useState<BuiltinMcpPreset[]>([]);
  const [userConfig, setUserConfig] = useState<McpUserConfig | null>(null);
  const [liveServers, setLiveServers] = useState<McpLiveServer[] | null>(null);
  const [inventory, setInventory] = useState<McpLiveServer[] | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [editorMode, setEditorMode] = useState<"form" | "json">("form");

  // Form Fields
  const [formType, setFormType] = useState<"stdio" | "http" | "sse">("stdio");
  const [formCommand, setFormCommand] = useState("");
  const [formArgs, setFormArgs] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formEnabled, setFormEnabled] = useState(true);

  const [source, setSource] = useState(() => JSON.stringify({ type: "stdio", command: "", args: [] }, null, 2));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Discovered Servers Filter & Fold
  const [filterQuery, setFilterQuery] = useState("");
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({
    "User level": true,
    "Project level": true,
  });

  const syncFormFromConfig = (config: Record<string, unknown>) => {
    const type = (config.type === "http" || config.type === "sse" ? config.type : "stdio") as "stdio" | "http" | "sse";
    setFormType(type);
    setFormCommand(typeof config.command === "string" ? config.command : "");
    setFormArgs(Array.isArray(config.args) ? config.args.join(" ") : "");
    setFormUrl(typeof config.url === "string" ? config.url : "");
    setFormEnabled(config.enabled !== false);
  };

  const buildConfigFromForm = (): Record<string, unknown> => {
    if (formType === "http" || formType === "sse") {
      return {
        type: formType,
        url: formUrl.trim(),
        enabled: formEnabled,
      };
    }
    const args = formArgs.trim() ? formArgs.trim().split(/\s+/) : [];
    return {
      type: "stdio",
      command: formCommand.trim(),
      args,
      enabled: formEnabled,
    };
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (cwd) params.set("cwd", cwd);
      if (sessionId) params.set("sessionId", sessionId);
      const response = await fetch(`/api/mcp?${params}`);
      const data = (await response.json()) as {
        servers?: McpServer[];
        builtinPresets?: BuiltinMcpPreset[];
        user?: McpUserConfig;
        inventory?: McpLiveServer[];
        liveServers?: McpLiveServer[];
        liveError?: string;
        path?: string;
        error?: string;
      };
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      setServers(data.servers ?? []);
      setBuiltinPresets(data.builtinPresets ?? []);
      setUserConfig(data.user ?? null);
      setLiveServers(Array.isArray(data.liveServers) ? data.liveServers : null);
      setInventory(Array.isArray(data.inventory) ? data.inventory : null);
      setLiveError(data.liveError ?? null);
      setPath(data.path ?? null);
      setSelected((current) => (current && data.servers?.some((server) => server.name === current) ? current : null));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessage(detail);
      toast.error(t("mcpConfig.loadError"), detail);
    } finally {
      setLoading(false);
    }
  }, [cwd, sessionId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const choose = (server: McpServer) => {
    setSelected(server.name);
    setName(server.name);
    syncFormFromConfig(server.config);
    setSource(JSON.stringify(server.config, null, 2));
    setMessage(null);
  };

  const add = () => {
    setSelected(null);
    setName("");
    setFormType("stdio");
    setFormCommand("");
    setFormArgs("");
    setFormUrl("");
    setFormEnabled(true);
    setSource(JSON.stringify({ type: "stdio", command: "", args: [] }, null, 2));
    setMessage(null);
  };

  const applyTemplate = (type: "python" | "npx" | "http") => {
    if (type === "python") {
      setName(name || "python-mcp");
      setFormType("stdio");
      setFormCommand("python3");
      setFormArgs("server.py");
      setFormEnabled(true);
      setSource(JSON.stringify({ type: "stdio", command: "python3", args: ["server.py"] }, null, 2));
    } else if (type === "npx") {
      setName(name || "filesystem");
      setFormType("stdio");
      setFormCommand("npx");
      setFormArgs("-y @modelcontextprotocol/server-filesystem /tmp");
      setFormEnabled(true);
      setSource(JSON.stringify({ type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] }, null, 2));
    } else if (type === "http") {
      setName(name || "remote-mcp");
      setFormType("http");
      setFormUrl("http://localhost:8000/mcp");
      setFormEnabled(true);
      setSource(JSON.stringify({ type: "http", url: "http://localhost:8000/mcp" }, null, 2));
    }
    setMessage(null);
  };

  const parse = (): Record<string, unknown> | null => {
    if (editorMode === "form") {
      return buildConfigFromForm();
    }
    try {
      const value = JSON.parse(source) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(t("mcpConfig.mustBeJsonObject"));
      return value as Record<string, unknown>;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("mcpConfig.invalidJson"));
      return null;
    }
  };

  const check = async () => {
    const server = parse();
    if (!server) return;
    setSaving(true);
    try {
      const response = await fetch("/api/mcp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), server }),
      });
      const data = (await response.json()) as { message?: string; error?: string };
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      setMessage(data.message ?? t("mcpConfig.validConfig"));
      toast.success(t("mcpConfig.validConfig"));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessage(detail);
      toast.error(t("mcpConfig.invalidConfig"), detail);
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    const server = parse();
    if (!server || !name.trim()) {
      if (!name.trim()) setMessage("请输入服务端名称");
      return;
    }
    setSaving(true);
    try {
      const payload = cwd
        ? { cwd, name: name.trim(), previousName: selected ?? undefined, server }
        : { scope: "user", name: name.trim(), previousName: selected ?? undefined, server };
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      setSelected(name.trim());
      setMessage(t("mcpConfig.savedMsg"));
      toast.success(t("mcpConfig.serverSaved", { name: name.trim() }));
      await load();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessage(detail);
      toast.error(t("mcpConfig.saveError"), detail);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const payload = cwd ? { cwd, name: selected } : { name: selected };
      const response = await fetch("/api/mcp", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      add();
      setMessage(t("mcpConfig.removedMsg"));
      toast.success(t("mcpConfig.serverRemoved", { name: selected }));
      await load();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessage(detail);
      toast.error(t("mcpConfig.removeError"), detail);
    } finally {
      setSaving(false);
    }
  };

  const enablePreset = async (preset: BuiltinMcpPreset) => {
    setSaving(true);
    try {
      const payload = cwd
        ? { cwd, name: preset.name, server: preset.config }
        : { scope: "user", name: preset.name, server: preset.config };
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      setSelected(preset.name);
      setName(preset.name);
      syncFormFromConfig(preset.config);
      setSource(JSON.stringify(preset.config, null, 2));
      toast.success(t("mcpConfig.serverSaved", { name: preset.displayName }));
      await load();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      toast.error(t("mcpConfig.saveError"), detail);
    } finally {
      setSaving(false);
    }
  };

  const displayedServers = liveServers ?? inventory ?? [];

  const groupedDiscovered = useMemo(() => {
    const groups: Record<string, McpLiveServer[]> = {};
    for (const server of displayedServers) {
      if (filterQuery.trim()) {
        const q = filterQuery.toLowerCase();
        const matchName = server.name.toLowerCase().includes(q);
        const matchSource = server.source.toLowerCase().includes(q);
        if (!matchName && !matchSource) continue;
      }
      if (!groups[server.source]) groups[server.source] = [];
      groups[server.source].push(server);
    }
    return groups;
  }, [displayedServers, filterQuery]);

  const toggleSourceExpand = (source: string) => {
    setExpandedSources((prev) => ({ ...prev, [source]: !prev[source] }));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 8 }}>
      {/* 1. Built-in Native MCP Showcase */}
      {builtinPresets.length > 0 && (
        <section
          style={{
            border: "1px solid color-mix(in srgb, var(--accent) 35%, var(--border))",
            borderRadius: "var(--radius-card)",
            overflow: "hidden",
            background: "color-mix(in srgb, var(--accent) 3%, var(--bg-panel))",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px",
              borderBottom: "1px solid color-mix(in srgb, var(--accent) 20%, var(--border))",
              background: "color-mix(in srgb, var(--accent) 7%, transparent)",
            }}
          >
            <Sparkles size={15} style={{ color: "var(--accent)" }} />
            <strong style={{ fontSize: 13, color: "var(--text)" }}>{t("mcpConfig.builtinServers") || "原生内置 MCP 扩展"}</strong>
            <span
              style={{
                fontSize: 10,
                padding: "2px 7px",
                borderRadius: 4,
                background: "var(--accent)",
                color: "var(--on-accent)",
                fontWeight: 700,
                letterSpacing: "0.02em",
              }}
            >
              {t("mcpConfig.builtinTag") || "原生自带"}
            </span>
          </div>
          <div style={{ padding: 14, display: "grid", gap: 12 }}>
            {builtinPresets.map((preset) => {
              const isConfigured =
                servers.some((s) => s.name === preset.name) ||
                (userConfig?.servers ?? []).some((s) => s.name === preset.name) ||
                displayedServers.some((s) => s.name === preset.name && s.status !== "disabled");
              return (
                <div
                  key={preset.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    padding: "12px 14px",
                    borderRadius: 8,
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{preset.displayName}</span>
                      <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-dim)", padding: "1px 5px", background: "var(--bg-panel)", borderRadius: 4 }}>
                        {preset.version}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>by {preset.author}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {isConfigured ? (
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            fontSize: 11,
                            color: "var(--status-success)",
                            fontWeight: 600,
                            padding: "3px 8px",
                            borderRadius: 6,
                            background: "color-mix(in srgb, var(--status-success) 10%, transparent)",
                          }}
                        >
                          <Check size={13} />
                          <span>{t("mcpConfig.alreadyConfigured") || "已就绪"}</span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void enablePreset(preset)}
                          disabled={saving}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "5px 12px",
                            borderRadius: 6,
                            background: "var(--accent)",
                            color: "var(--on-accent)",
                            border: "none",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: saving ? "wait" : "pointer",
                          }}
                        >
                          <Zap size={13} />
                          <span>{t("mcpConfig.enablePreset") || "一键启用"}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(preset.name);
                          setName(preset.name);
                          syncFormFromConfig(preset.config);
                          setSource(JSON.stringify(preset.config, null, 2));
                        }}
                        style={{
                          padding: "5px 10px",
                          borderRadius: 6,
                          background: "transparent",
                          color: "var(--text)",
                          border: "1px solid var(--border)",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        {t("mcpConfig.editPreset") || "载入编辑"}
                      </button>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{preset.description}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {preset.tools.map((tool) => (
                      <span
                        key={tool}
                        style={{
                          fontSize: 10,
                          fontFamily: "var(--font-mono)",
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: "var(--bg-panel)",
                          border: "1px solid var(--border)",
                          color: "var(--text)",
                        }}
                      >
                        {tool}
                      </span>
                    ))}
                    <span style={{ fontSize: 10, color: "var(--text-dim)", alignSelf: "center", marginLeft: 4 }}>+ 8 更多高级编排工具</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 2. MCP Server Configuration & Editor (Visual Form + JSON) */}
      <section
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)",
          overflow: "hidden",
          background: "var(--bg-panel)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
            background: "color-mix(in srgb, var(--bg-hover) 50%, transparent)",
          }}
        >
          <Sliders size={15} style={{ color: "var(--accent)" }} />
          <strong style={{ fontSize: 13, color: "var(--text)", flexShrink: 0 }}>
            {cwd ? t("mcpConfig.projectServers") : "MCP 服务端管理"}
          </strong>
          {path && (
            <code style={{ flex: 1, minWidth: 0, color: "var(--text-dim)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {path}
            </code>
          )}
          {(() => {
            const total = servers.length;
            if (total === 0) return null;
            const enabled = servers.filter((s) => serverSummary(s.config).enabled && serverSummary(s.config).valid).length;
            const invalid = servers.filter((s) => !serverSummary(s.config).valid).length;
            return (
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-dim)", whiteSpace: "nowrap" }}>
                {t("mcpConfig.serverCounts", { enabled, total })}
                {invalid > 0 ? t("mcpConfig.invalidSuffix", { count: invalid }) : ""}
              </span>
            );
          })()}
        </div>

        <div className="mcp-editor-grid" style={{ display: "grid", gridTemplateColumns: "minmax(160px, 0.35fr) minmax(0, 1fr)", minHeight: 300 }}>
          {/* Server List */}
          <div style={{ borderRight: "1px solid var(--border)", padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", padding: "4px 6px" }}>
              配置列表 ({servers.length})
            </div>
            {servers.map((server) => {
              const summary = serverSummary(server.config);
              const isCurrent = selected === server.name;
              return (
                <button
                  key={server.name}
                  type="button"
                  onClick={() => choose(server)}
                  title={`${server.name} — ${summary.type} · ${summary.target || "invalid"}`}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "8px 10px",
                    border: isCurrent ? "1px solid var(--accent)" : "1px solid transparent",
                    borderRadius: 6,
                    background: isCurrent ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
                    color: "var(--text)",
                    textAlign: "left",
                    font: "12px var(--font-mono)",
                    cursor: "pointer",
                    overflow: "hidden",
                    transition: "background 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: summary.valid ? (summary.enabled ? "var(--status-success)" : "var(--border)") : "var(--status-error)",
                      }}
                    />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, fontWeight: isCurrent ? 700 : 500 }}>
                      {server.name}
                    </span>
                  </div>
                  <div style={{ marginTop: 2, fontSize: 10, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {summary.type}
                    {summary.enabled ? "" : " · 关闭"}
                    {!summary.valid ? " · 无效" : ""}
                    {summary.target ? ` · ${summary.target}` : ""}
                  </div>
                </button>
              );
            })}
            {!loading && servers.length === 0 && (
              <div style={{ padding: "10px 8px", color: "var(--text-dim)", fontSize: 11, textAlign: "center" }}>
                {t("mcpConfig.noServers") || "暂未配置服务端"}
              </div>
            )}
            <button
              type="button"
              onClick={add}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                width: "100%",
                marginTop: 6,
                padding: "8px 10px",
                border: selected === null ? "1px solid var(--accent)" : "1px dashed var(--border)",
                borderRadius: 6,
                background: selected === null ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent",
                color: selected === null ? "var(--accent)" : "var(--text-muted)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: selected === null ? 700 : 500,
              }}
            >
              <Plus size={14} /> {t("mcpConfig.addServer") || "添加服务端"}
            </button>
          </div>

          {/* Editor Form / JSON */}
          <div style={{ minWidth: 0, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Header: Mode Switch & Template Shortcuts */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>快捷模版:</span>
                <button
                  type="button"
                  onClick={() => applyTemplate("python")}
                  style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", cursor: "pointer" }}
                >
                  Python stdio
                </button>
                <button
                  type="button"
                  onClick={() => applyTemplate("npx")}
                  style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", cursor: "pointer" }}
                >
                  NPX stdio
                </button>
                <button
                  type="button"
                  onClick={() => applyTemplate("http")}
                  style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", cursor: "pointer" }}
                >
                  Remote HTTP
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 4, background: "var(--bg)", padding: 2, borderRadius: 6, border: "1px solid var(--border)" }}>
                <button
                  type="button"
                  onClick={() => setEditorMode("form")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 8px",
                    borderRadius: 4,
                    border: "none",
                    background: editorMode === "form" ? "var(--accent)" : "transparent",
                    color: editorMode === "form" ? "var(--on-accent)" : "var(--text-muted)",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <Sliders size={12} /> 表单
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditorMode("json");
                    setSource(JSON.stringify(buildConfigFromForm(), null, 2));
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "3px 8px",
                    borderRadius: 4,
                    border: "none",
                    background: editorMode === "json" ? "var(--accent)" : "transparent",
                    color: editorMode === "json" ? "var(--on-accent)" : "var(--text-muted)",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <Code size={12} /> JSON
                </button>
              </div>
            </div>

            {/* Server Name */}
            <div>
              <label style={{ display: "block", color: "var(--text-muted)", fontSize: 11, marginBottom: 4 }}>
                {t("mcpConfig.serverName") || "服务端标识名称"}
              </label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如: filesystem 或 python-runner"
                style={inputStyle}
              />
            </div>

            {/* Form Mode Inputs */}
            {editorMode === "form" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10 }}>
                  <div>
                    <label style={{ display: "block", color: "var(--text-muted)", fontSize: 11, marginBottom: 4 }}>传输协议</label>
                    <select
                      value={formType}
                      onChange={(e) => setFormType(e.target.value as "stdio" | "http" | "sse")}
                      style={{ ...inputStyle, cursor: "pointer" }}
                    >
                      <option value="stdio">stdio (本地命令)</option>
                      <option value="http">http (远程端点)</option>
                      <option value="sse">sse (流式端点)</option>
                    </select>
                  </div>
                  {formType === "stdio" ? (
                    <div>
                      <label style={{ display: "block", color: "var(--text-muted)", fontSize: 11, marginBottom: 4 }}>可执行命令 (Command)</label>
                      <input
                        value={formCommand}
                        onChange={(e) => setFormCommand(e.target.value)}
                        placeholder="例如: python3, node, npx, uvx"
                        style={inputStyle}
                      />
                    </div>
                  ) : (
                    <div>
                      <label style={{ display: "block", color: "var(--text-muted)", fontSize: 11, marginBottom: 4 }}>远程 URL (Endpoint)</label>
                      <input
                        value={formUrl}
                        onChange={(e) => setFormUrl(e.target.value)}
                        placeholder="例如: http://localhost:8000/mcp"
                        style={inputStyle}
                      />
                    </div>
                  )}
                </div>

                {formType === "stdio" && (
                  <div>
                    <label style={{ display: "block", color: "var(--text-muted)", fontSize: 11, marginBottom: 4 }}>启动参数 (Arguments)</label>
                    <input
                      value={formArgs}
                      onChange={(e) => setFormArgs(e.target.value)}
                      placeholder="例如: mcp_server.py 或 -y @modelcontextprotocol/server-filesystem /path"
                      style={inputStyle}
                    />
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <input
                    type="checkbox"
                    id="mcp-server-enabled"
                    checked={formEnabled}
                    onChange={(e) => setFormEnabled(e.target.checked)}
                    style={{ cursor: "pointer", width: 14, height: 14 }}
                  />
                  <label htmlFor="mcp-server-enabled" style={{ fontSize: 12, color: "var(--text)", cursor: "pointer" }}>
                    启用此服务端 (Enabled)
                  </label>
                </div>
              </div>
            ) : (
              <div>
                <label style={{ display: "block", color: "var(--text-muted)", fontSize: 11, marginBottom: 4 }}>
                  {t("mcpConfig.serverConfigJson") || "OMP 服务端配置 (JSON)"}
                </label>
                <textarea
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  spellCheck={false}
                  style={{ ...inputStyle, minHeight: 140, resize: "vertical", lineHeight: 1.45 }}
                />
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => void check()}
                disabled={saving}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "7px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-control)",
                  background: "transparent",
                  color: "var(--text)",
                  cursor: saving ? "wait" : "pointer",
                  fontSize: 12,
                }}
              >
                <Check size={13} /> {t("mcpConfig.check") || "检查校验"}
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !name.trim()}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "7px 14px",
                  border: "none",
                  borderRadius: "var(--radius-control)",
                  background: "var(--accent)",
                  color: "var(--on-accent)",
                  cursor: saving || !name.trim() ? "default" : "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {saving ? t("mcpConfig.saving") : t("mcpConfig.saveServer") || "保存配置"}
              </button>
              {selected && (
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={saving}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "7px 12px",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-control)",
                    background: "transparent",
                    color: "var(--status-error)",
                    cursor: saving ? "wait" : "pointer",
                    fontSize: 12,
                    marginLeft: "auto",
                  }}
                >
                  <Trash2 size={13} /> {t("mcpConfig.remove") || "删除"}
                </button>
              )}
            </div>
            {message && <div role="status" style={{ color: "var(--text-muted)", fontSize: 11, lineHeight: 1.4 }}>{message}</div>}
          </div>
        </div>
      </section>

      {/* 3. Discovered Multi-Client MCP Servers (Collapsible Accordion by Source) */}
      <section
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)",
          overflow: "hidden",
          background: "var(--bg-panel)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <Globe size={15} style={{ color: "var(--text-muted)" }} />
          <strong style={{ fontSize: 13, color: "var(--text)" }}>
            {t("mcpConfig.configuredServers") || "已配置与自动发现的 MCP 仓库"}
          </strong>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>({displayedServers.length} 款)</span>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <Search size={12} style={{ position: "absolute", left: 7, color: "var(--text-dim)" }} />
              <input
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="筛选 MCP..."
                style={{
                  padding: "3px 8px 3px 24px",
                  fontSize: 11,
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  background: "var(--bg)",
                  color: "var(--text)",
                  width: 120,
                }}
              />
            </div>
            <button
              type="button"
              title={t("mcpConfig.refreshLiveStatus")}
              aria-label={t("mcpConfig.refreshLiveStatus")}
              onClick={() => void load()}
              disabled={loading}
              className="ui-focus-ring"
              style={{
                width: 24,
                height: 24,
                padding: 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: "none",
                borderRadius: 4,
                background: "transparent",
                color: "var(--text-muted)",
                cursor: loading ? "wait" : "pointer",
              }}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {Object.entries(groupedDiscovered).map(([sourceName, groupServers]) => {
            const isExpanded = expandedSources[sourceName] ?? false;
            return (
              <div
                key={sourceName}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  overflow: "hidden",
                  background: "var(--bg)",
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleSourceExpand(sourceName)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "8px 12px",
                    background: "var(--bg-panel)",
                    border: "none",
                    borderBottom: isExpanded ? "1px solid var(--border)" : "none",
                    color: "var(--text)",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span>{sourceName}</span>
                  <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: "auto", fontWeight: 400 }}>
                    {groupServers.length} 个服务端
                  </span>
                </button>
                {isExpanded && (
                  <div
                    style={{
                      padding: 10,
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                      gap: 8,
                    }}
                  >
                    {groupServers.map((server) => {
                      const active = server.status === "connected" || server.status === "configured";
                      return (
                        <div
                          key={`${sourceName}:${server.name}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 10px",
                            borderRadius: 5,
                            background: "var(--bg-panel)",
                            border: "1px solid var(--border)",
                            fontSize: 11,
                          }}
                        >
                          <span
                            aria-hidden="true"
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              flexShrink: 0,
                              background: active ? "var(--status-success)" : "var(--border)",
                            }}
                          />
                          <code style={{ color: "var(--text)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {server.name}
                          </code>
                          <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: "auto" }}>
                            {server.type ? `[${server.type}]` : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {!loading && Object.keys(groupedDiscovered).length === 0 && (
            <div style={{ color: "var(--text-dim)", fontSize: 11, padding: 12, textAlign: "center" }}>
              {t("mcpConfig.noMcpServers") || "未发现 MCP 服务端"}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getSubmitDuringRunBehavior, setSubmitDuringRunBehavior, type SubmitDuringRunBehavior } from "@/lib/composer-prefs";
import dynamic from "next/dynamic";
import { Copy, ExternalLink, RefreshCw, RotateCcw, Sparkles, Search, AlertCircle, ShieldCheck, Cpu, Settings2, Cable, Bot, Puzzle } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/primitives";
import { SettingsTabs, type SettingsTab, SETTINGS_CATEGORIES } from "./SettingsTabs";

const SettingsTabLoading = () => <div role="status" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>Loading settings…</div>;
const ModelsConfig = dynamic(() => import("./ModelsConfig").then((module) => module.ModelsConfig), { loading: SettingsTabLoading });
const SkillsConfig = dynamic(() => import("./SkillsConfig").then((module) => module.SkillsConfig), { loading: SettingsTabLoading });
const PluginsConfig = dynamic(() => import("./PluginsConfig").then((module) => module.PluginsConfig), { loading: SettingsTabLoading });
const McpConfig = dynamic(() => import("./McpConfig").then((module) => module.McpConfig), { loading: SettingsTabLoading });

type UpdateState = {
  currentVersion: string | null;
  availableVersion: string | null;
  updateAvailable: boolean;
  updateCommand?: string;
};

type NativeSettings = {
  defaultThinkingLevel?: "auto" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  hideThinkingBlock?: boolean;
  externalThinking?: boolean;
  textVerbosity?: "low" | "medium" | "high";
  personality?: "default" | "friendly" | "pragmatic" | "none";
  advisor?: { enabled?: boolean; subagents?: boolean; syncBacklog?: "off" | "1" | "3" | "5"; immuneTurns?: number };
  tools?: { approvalMode?: "always-ask" | "write" | "yolo"; approval?: { bash?: "allow" | "prompt" | "deny"; extension?: "allow" | "prompt" } };
  compaction?: { enabled?: boolean; midTurnEnabled?: boolean; strategy?: "snapcompact" | "handoff" | "context-full" | "shake" | "off"; autoContinue?: boolean; remoteEnabled?: boolean; keepRecentTokens?: number };
  memory?: { backend?: "off" | "local" | "mnemopi" | "hindsight" };
  autolearn?: { enabled?: boolean; autoContinue?: boolean; minToolCalls?: number };
  mnemopi?: { scoping?: "global" | "per-project" | "per-project-tagged"; autoRecall?: boolean; autoRetain?: boolean; noEmbeddings?: boolean };
  mcp?: { enableProjectConfig?: boolean; renderMarkdownResults?: boolean; notifications?: boolean; notificationDebounceMs?: number };
  retry?: { enabled?: boolean; maxRetries?: number; modelFallback?: boolean };
};

const nativeSelectStyle = {
  minHeight: 32,
  padding: "4px 28px 4px 10px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-control)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 12,
  cursor: "pointer",
  appearance: "none" as const,
  WebkitAppearance: "none" as const,
  MozAppearance: "none" as const,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat" as const,
  backgroundPosition: "right 8px center" as const,
  outline: "none",
  colorScheme: "dark light",
} as const;

const nativeOptionStyle = {
  background: "var(--bg-panel)",
  color: "var(--text)",
} as const;

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const SettingsHighlightContext = createContext<string | null>(null);

type SearchResult = {
  id: string;
  kind: "category" | "setting";
  tab: SettingsTab;
  label: string;
  description: string;
  scope?: string;
  section?: string;
};

type SettingIndexEntry = {
  tab: SettingsTab;
  section: string;
  label: string;
  description: string;
  scope?: "UI" | "Native OMP" | "Workspace";
};

const SETTING_INDEX: SettingIndexEntry[] = [
  // Interface & Behavior
  { tab: "general", section: "Interface & Behavior", label: "Keep tool calls collapsed", description: "Show only compact headers while tools execute.", scope: "UI" },
  { tab: "general", section: "Interface & Behavior", label: "Completion sound", description: "Play a tone when the agent completes a run.", scope: "UI" },
  { tab: "general", section: "Interface & Behavior", label: "Message during active run", description: "What composer does on submit while agent runs. Steer interrupts; Queue follow-up delivers after finish.", scope: "UI" },
  // Tool Safety & Approvals
  { tab: "safety", section: "Tool Safety & Approvals", label: "Approval Mode", description: "Choose when OMP asks before tool calls.", scope: "Native OMP" },
  { tab: "safety", section: "Tool Safety & Approvals", label: "Bash Override", description: "Override default approval policy specifically for terminal commands.", scope: "Native OMP" },
  { tab: "safety", section: "Tool Safety & Approvals", label: "Extension Tool Requests", description: "Automatically approve extension tool authorization requests.", scope: "Native OMP" },
  // AI Model Defaults
  { tab: "models", section: "AI Model Defaults", label: "Reasoning", description: "Default effort level for thinking-capable models.", scope: "Native OMP" },
  { tab: "models", section: "AI Model Defaults", label: "Verbosity", description: "Response detail level for supporting providers.", scope: "Native OMP" },
  { tab: "models", section: "AI Model Defaults", label: "Personality", description: "Style included in OMP's system prompt.", scope: "Native OMP" },
  { tab: "models", section: "AI Model Defaults", label: "Thinking Blocks", description: "Hide model reasoning from output view.", scope: "Native OMP" },
  { tab: "models", section: "AI Model Defaults", label: "External Thinking", description: "Private scratchpad reasoning via think tool.", scope: "Native OMP" },
  // Agent & Intelligence — Advisor Review
  { tab: "intelligence", section: "Advisor Review", label: "Enable Advisor", description: "Enable Advisor for new sessions with the advisor role.", scope: "Native OMP" },
  { tab: "intelligence", section: "Advisor Review", label: "Advisor Backlog", description: "Wait briefly when advisor falls behind.", scope: "Native OMP" },
  { tab: "intelligence", section: "Advisor Review", label: "Review Subagents", description: "Apply Advisor passive review to subagent tasks.", scope: "Native OMP" },
  // Context Compaction
  { tab: "intelligence", section: "Context Compaction", label: "Automatic Compaction", description: "Compact context before model context limit is hit.", scope: "Native OMP" },
  { tab: "intelligence", section: "Context Compaction", label: "Continue After Compaction", description: "Resume task execution after compaction completes.", scope: "Native OMP" },
  { tab: "intelligence", section: "Context Compaction", label: "Maintenance Strategy", description: "Select algorithm used to reduce context pressure.", scope: "Native OMP" },
  { tab: "intelligence", section: "Context Compaction", label: "Compact Mid-Turn", description: "Check context limits between tool execution steps.", scope: "Native OMP" },
  // Memory & Auto-Learn
  { tab: "intelligence", section: "Memory & Auto-Learn", label: "Memory Backend", description: "Where durable knowledge is stored across sessions.", scope: "Native OMP" },
  { tab: "intelligence", section: "Memory & Auto-Learn", label: "Enable Auto-Learn", description: "Capture reusable lessons after completed runs.", scope: "Native OMP" },
  { tab: "intelligence", section: "Memory & Auto-Learn", label: "Private Capture Turn", description: "Run private lesson-capture turn at completion.", scope: "Native OMP" },
  { tab: "intelligence", section: "Memory & Auto-Learn", label: "Memory Scope", description: "Scoping for Mnemopi knowledge storage.", scope: "Native OMP" },
  { tab: "intelligence", section: "Memory & Auto-Learn", label: "Recall on Session Start", description: "Load relevant memories into first turn.", scope: "Native OMP" },
  { tab: "intelligence", section: "Memory & Auto-Learn", label: "Retain Completed Turns", description: "Store completed conversation turns in memory.", scope: "Native OMP" },
  // Automatic Retry
  { tab: "intelligence", section: "Automatic Retry", label: "Automatic Retry", description: "Retry failed turns automatically.", scope: "Native OMP" },
  { tab: "intelligence", section: "Automatic Retry", label: "Max Attempts", description: "Retry limit before giving up.", scope: "Native OMP" },
  { tab: "intelligence", section: "Automatic Retry", label: "Model Fallback", description: "Fall back to alternative model when retries exhaust.", scope: "Native OMP" },
  // Extensions & Tools
  { tab: "mcp", section: "Extensions & Tools", label: "Load Project MCP Servers", description: "Allow project-root MCP configuration to be discovered.", scope: "Native OMP" },
  { tab: "mcp", section: "Extensions & Tools", label: "Render MCP Markdown", description: "Render non-JSON MCP results as Markdown in transcript.", scope: "Native OMP" },
  { tab: "mcp", section: "Extensions & Tools", label: "MCP Resource Updates", description: "Inject server resource updates into conversation.", scope: "Native OMP" },
];

function SearchResultsList({ results, query, onSelect }: { results: SearchResult[]; query: string; onSelect: (result: SearchResult) => void }) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "var(--bg)", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
        {results.length === 0 ? `No settings match “${query}”.` : `${results.length} result${results.length === 1 ? "" : "s"} for “${query}”.`}
      </div>
      {results.map((result) => (
        <button
          key={result.id}
          type="button"
          onClick={() => onSelect(result)}
          style={{
            textAlign: "left",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "10px 12px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-card)",
            background: "var(--bg-panel)",
            color: "var(--text)",
            cursor: "pointer",
            transition: "border-color var(--dur-fast), background var(--dur-fast)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{result.label}</span>
            {result.kind === "category" && (
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "var(--bg-subtle)", color: "var(--text-muted)", fontWeight: 500 }}>Section</span>
            )}
            {result.scope && (
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "var(--bg-subtle)", color: "var(--text-muted)", fontWeight: 500 }}>{result.scope}</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.45 }}>{result.description}</div>
          {result.section && <div style={{ fontSize: 10, color: "var(--text-dim)" }}>{result.section}</div>}
        </button>
      ))}
    </div>
  );
}

function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        width: 36,
        height: 20,
        borderRadius: 10,
        border: "none",
        background: checked ? "var(--accent)" : "var(--border)",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background var(--dur-fast)",
        padding: 2,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: 8,
          background: "#fff",
          transform: checked ? "translateX(16px)" : "translateX(0px)",
          transition: "transform var(--dur-fast)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />
    </button>
  );
}

function NativeSetting({ label, description, scope, children }: { label: string; description: string; scope?: "UI" | "Native OMP" | "Workspace"; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const highlightId = useContext(SettingsHighlightContext);
  const highlighted = highlightId !== null && highlightId === slugify(label);

  useEffect(() => {
    if (highlighted && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlighted]);

  return (
    <div
      ref={ref}
      data-search-id={slugify(label)}
      style={{
        minWidth: 0,
        padding: "12px 14px",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-card)",
        background: "var(--bg-panel)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        transition: "box-shadow var(--dur-fast), border-color var(--dur-fast)",
        ...(highlighted ? { borderColor: "var(--accent)", boxShadow: "0 0 0 2px var(--accent)" } : {}),
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>{label}</span>
          {scope && (
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "var(--bg-subtle)", color: "var(--text-muted)", fontWeight: 500 }}>
              {scope}
            </span>
          )}
        </div>
        <span style={{ flexShrink: 0 }}>{children}</span>
      </div>
      <span style={{ color: "var(--text-muted)", fontSize: 11, lineHeight: 1.45 }}>{description}</span>
    </div>
  );
}

export function SettingsConfig({ activeTab, advisorEnabled, onAdvisorChange, toolCallsDefaultCollapsed, onToolCallsDefaultCollapsedChange, cwd, sessionId, onModelsSaved, onPluginsReloaded, onOmpUpdateAvailabilityChange, onSelectTab, onClose }: {
  activeTab: SettingsTab;
  advisorEnabled: boolean;
  onAdvisorChange: (enabled: boolean) => void;
  toolCallsDefaultCollapsed: boolean;
  onToolCallsDefaultCollapsedChange: (collapsed: boolean) => void;
  cwd: string | null;
  sessionId: string | null;
  onModelsSaved: () => void;
  onPluginsReloaded: () => void;
  onOmpUpdateAvailabilityChange: (available: boolean) => void;
  onSelectTab: (tab: SettingsTab) => void;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const workspaceReady = cwd !== null;
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [submitBehavior, setSubmitBehavior] = useState<SubmitDuringRunBehavior>(() => getSubmitDuringRunBehavior());
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const value = window.localStorage.getItem("omp-sound-enabled");
      return value === null ? true : value === "true";
    } catch {
      return true;
    }
  });
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [checking, setChecking] = useState(true);
  const [appUpdate, setAppUpdate] = useState<UpdateState | null>(null);
  const [checkingAppUpdate, setCheckingAppUpdate] = useState(true);
  const [restarting, setRestarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nativeSettings, setNativeSettings] = useState<NativeSettings | null>(null);
  const [nativeSettingsError, setNativeSettingsError] = useState<string | null>(null);
  const [nativeSavesInFlight, setNativeSavesInFlight] = useState(0);
  const [visitedTabs, setVisitedTabs] = useState<Set<SettingsTab>>(() => new Set(["general", activeTab]));

  useEffect(() => {
    setVisitedTabs((tabs) => (tabs.has(activeTab) ? tabs : new Set([...tabs, activeTab])));
  }, [activeTab]);

  useEffect(() => {
    fetch("/api/omp-settings")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((data: { settings?: NativeSettings }) => setNativeSettings(data.settings ?? {}))
      .catch((error) => setNativeSettingsError(error instanceof Error ? error.message : String(error)));
  }, []);

  const latestNativeSettingsRef = useRef<NativeSettings | null>(null);
  const nativeSaveDrainingRef = useRef(false);

  const saveNativeSettings = useCallback((next: NativeSettings) => {
    setNativeSettings(next);
    setNativeSettingsError(null);
    latestNativeSettingsRef.current = next;
    if (nativeSaveDrainingRef.current) return;
    nativeSaveDrainingRef.current = true;
    setNativeSavesInFlight((count) => count + 1);

    void (async () => {
      try {
        while (latestNativeSettingsRef.current !== null) {
          const snapshot = latestNativeSettingsRef.current;
          latestNativeSettingsRef.current = null;
          try {
            const response = await fetch("/api/omp-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: snapshot }) });
            const data = (await response.json()) as { settings?: NativeSettings; error?: string };
            if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
            if (latestNativeSettingsRef.current === null) setNativeSettings(data.settings ?? snapshot);
          } catch (error) {
            setNativeSettingsError(error instanceof Error ? error.message : String(error));
            break;
          }
        }
      } finally {
        nativeSaveDrainingRef.current = false;
        setNativeSavesInFlight((count) => Math.max(0, count - 1));
      }
    })();
  }, []);

  const checkForUpdate = useCallback(async () => {
    setChecking(true);
    setMessage(null);
    try {
      const response = await fetch("/api/omp-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check" }) });
      const data = (await response.json()) as UpdateState & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      setUpdate(data);
      onOmpUpdateAvailabilityChange(data.updateAvailable);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }, [onOmpUpdateAvailabilityChange]);

  useEffect(() => {
    void checkForUpdate();
  }, [checkForUpdate]);

  const checkForAppUpdate = useCallback(async (force = false) => {
    setCheckingAppUpdate(true);
    try {
      const response = await fetch(force ? "/api/app-update?force=1" : "/api/app-update");
      const data = (await response.json()) as UpdateState & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      setAppUpdate(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckingAppUpdate(false);
    }
  }, []);

  useEffect(() => {
    void checkForAppUpdate();
  }, [checkForAppUpdate]);

  const restartSessions = useCallback(async () => {
    setRestarting(true);
    try {
      const response = await fetch("/api/omp-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restart" }) });
      const data = (await response.json()) as { error?: string; sessionsRestarted?: number };
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      setMessage(`Restarted ${data.sessionsRestarted ?? 0} active OMP session(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRestarting(false);
    }
  }, []);

  const getNormalizedActive = (tab: SettingsTab): SettingsTab => {
    if (tab === "skills" || tab === "plugins" || tab === "extensions") return "mcp";
    return tab;
  };

  const currentTab = getNormalizedActive(activeTab);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const searchActive = trimmedQuery.length > 0;

  const searchResults = useMemo<SearchResult[]>(() => {
    if (!trimmedQuery) return [];
    const results: SearchResult[] = [];
    for (const category of SETTINGS_CATEGORIES) {
      const haystack = `${category.label} ${category.description}`.toLowerCase();
      if (haystack.includes(trimmedQuery)) {
        results.push({ id: `tab-${category.id}`, kind: "category", tab: category.id, label: category.label, description: category.description });
      }
    }
    for (const setting of SETTING_INDEX) {
      const haystack = `${setting.label} ${setting.description} ${setting.section}`.toLowerCase();
      if (haystack.includes(trimmedQuery)) {
        results.push({ id: slugify(setting.label), kind: "setting", tab: setting.tab, label: setting.label, description: setting.description, scope: setting.scope, section: setting.section });
      }
    }
    return results;
  }, [trimmedQuery]);

  const openSearchResult = useCallback((result: SearchResult) => {
    onSelectTab(result.tab);
    setHighlightId(result.kind === "setting" ? result.id : null);
    setSearchQuery("");
  }, [onSelectTab]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent ariaLabel="Settings" style={{ width: isMobile ? "calc(100vw - 16px)" : 940, maxWidth: "calc(100vw - 16px)", height: isMobile ? "calc(100dvh - 16px)" : "82vh", maxHeight: "calc(100dvh - 16px)", padding: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "12px 18px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <DialogTitle style={{ fontSize: 16, margin: 0, fontWeight: 600 }}>Settings</DialogTitle>
            {nativeSavesInFlight > 0 ? (
              <span style={{ fontSize: 11, color: "var(--accent)", padding: "2px 8px", borderRadius: 10, background: "var(--bg-subtle)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <RefreshCw size={11} className="spin" aria-hidden="true" /> Saving…
              </span>
            ) : (
              <span style={{ fontSize: 11, color: "var(--text-dim)", padding: "2px 8px", borderRadius: 10, background: "var(--bg-subtle)" }}>
                Auto-saved
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, maxWidth: 360, justifyContent: "flex-end" }}>
            <div style={{ position: "relative", width: "100%", maxWidth: 260 }}>
              <Search size={13} aria-hidden="true" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
              <input
                type="text"
                aria-label="Search settings"
                placeholder="Search settings..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSearchQuery("");
                    setHighlightId(null);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                style={{ width: "100%", height: 28, padding: "0 8px 0 28px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none" }}
              />
            </div>
            <button type="button" onClick={onClose} aria-label="Close settings" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
          </div>
        </header>

        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>
          {searchActive ? (
            <SearchResultsList results={searchResults} query={searchQuery.trim()} onSelect={openSearchResult} />
          ) : (
            <SettingsHighlightContext.Provider value={highlightId}>
              {isMobile ? (
                <SettingsTabs active={currentTab} onSelect={onSelectTab} workspaceReady={workspaceReady} layout="horizontal" />
              ) : (
                <SettingsTabs active={currentTab} onSelect={onSelectTab} workspaceReady={workspaceReady} layout="vertical" />
              )}

              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto", background: "var(--bg)" }}>
            {nativeSettingsError && (
              <div role="alert" style={{ margin: 16, padding: "10px 14px", borderRadius: "var(--radius-card)", background: "var(--bg-panel)", border: "1px solid var(--status-error)", color: "var(--status-error)", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <AlertCircle size={14} aria-hidden="true" /> {nativeSettingsError}
              </div>
            )}

            {/* GENERAL & UI TAB */}
            {currentTab === "general" && (
              <div role="tabpanel" id="settings-panel-general" aria-labelledby="settings-tab-general" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Interface & Behavior</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>Controls interface presentation, notification sounds, and execution submission mode.</p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <NativeSetting label="Keep tool calls collapsed" description="Show only compact headers while tools execute." scope="UI">
                    <ToggleSwitch checked={toolCallsDefaultCollapsed} onChange={onToolCallsDefaultCollapsedChange} />
                  </NativeSetting>
                  <NativeSetting label="Completion sound" description="Play a tone when the agent completes a run." scope="UI">
                    <ToggleSwitch
                      checked={soundEnabled}
                      onChange={(next) => {
                        setSoundEnabled(next);
                        try { localStorage.setItem("omp-sound-enabled", String(next)); } catch { /* storage fallback */ }
                        window.dispatchEvent(new CustomEvent("omp-sound-pref-change", { detail: next }));
                      }}
                    />
                  </NativeSetting>
                </div>
                <NativeSetting label="Message during active run" description="What composer does on submit while agent runs. Steer interrupts; Queue follow-up delivers after finish." scope="UI">
                  <select
                    style={nativeSelectStyle}
                    value={submitBehavior}
                    onChange={(event) => {
                      const next = event.target.value as SubmitDuringRunBehavior;
                      setSubmitDuringRunBehavior(next);
                      setSubmitBehavior(next);
                    }}
                  >
                    <option value="steer" style={nativeOptionStyle}>Steer current run</option>
                    <option value="queue" style={nativeOptionStyle}>Queue follow-up</option>
                  </select>
                </NativeSetting>
              </div>
            )}

            {/* SAFETY & APPROVALS TAB */}
            {currentTab === "safety" && (
              <div role="tabpanel" id="settings-panel-safety" aria-labelledby="settings-tab-safety" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Tool Safety & Approvals</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>Tool execution safety rules and permission prompts. Persisted in <code>~/.omp/agent/config.yml</code>.</p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <NativeSetting label="Approval Mode" description="Choose when OMP asks before tool calls." scope="Native OMP">
                    <select
                      style={nativeSelectStyle}
                      value={nativeSettings?.tools?.approvalMode ?? "yolo"}
                      onChange={(event) =>
                        void saveNativeSettings({
                          ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                          tools: { ...(latestNativeSettingsRef.current ?? nativeSettings?.tools ?? {}), approvalMode: event.target.value as "always-ask" | "write" | "yolo" },
                        })
                      }
                    >
                      <option value="always-ask" style={nativeOptionStyle}>Always ask</option>
                      <option value="write" style={nativeOptionStyle}>Allow writes</option>
                      <option value="yolo" style={nativeOptionStyle}>Auto approve (YOLO)</option>
                    </select>
                  </NativeSetting>
                  <NativeSetting label="Bash Override" description="Override default approval policy specifically for terminal commands." scope="Native OMP">
                    <select
                      style={nativeSelectStyle}
                      value={nativeSettings?.tools?.approval?.bash ?? "prompt"}
                      onChange={(event) =>
                        void saveNativeSettings({
                          ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                          tools: {
                            ...(latestNativeSettingsRef.current ?? nativeSettings?.tools ?? {}),
                            approval: { ...(latestNativeSettingsRef.current ?? nativeSettings?.tools?.approval ?? {}), bash: event.target.value as "allow" | "prompt" | "deny" },
                          },
                        })
                      }
                    >
                      <option value="allow" style={nativeOptionStyle}>Allow</option>
                      <option value="prompt" style={nativeOptionStyle}>Always ask</option>
                      <option value="deny" style={nativeOptionStyle}>Deny</option>
                    </select>
                  </NativeSetting>
                  <NativeSetting label="Extension Tool Requests" description="Automatically approve extension tool authorization requests." scope="Native OMP">
                    <select
                      style={nativeSelectStyle}
                      value={nativeSettings?.tools?.approval?.extension ?? "prompt"}
                      onChange={(event) =>
                        void saveNativeSettings({
                          ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                          tools: {
                            ...(latestNativeSettingsRef.current ?? nativeSettings?.tools ?? {}),
                            approval: { ...(latestNativeSettingsRef.current ?? nativeSettings?.tools?.approval ?? {}), extension: event.target.value as "allow" | "prompt" },
                          },
                        })
                      }
                    >
                      <option value="prompt" style={nativeOptionStyle}>Ask every time</option>
                      <option value="allow" style={nativeOptionStyle}>Auto approve</option>
                    </select>
                  </NativeSetting>
                </div>
              </div>
            )}

            {/* AI MODEL DEFAULTS TAB */}
            {(activeTab === "models" || currentTab === "models") && (
              <div role="tabpanel" id="settings-panel-models" aria-labelledby="settings-tab-models" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>AI Model Defaults</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>Configure default reasoning effort, response verbosity, personality tone, and thinking display.</p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <NativeSetting label="Reasoning" description="Default effort level for thinking-capable models." scope="Native OMP">
                    <select
                      style={nativeSelectStyle}
                      value={nativeSettings?.defaultThinkingLevel ?? "high"}
                      onChange={(e) => void saveNativeSettings({ ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}), defaultThinkingLevel: e.target.value as NativeSettings["defaultThinkingLevel"] })}
                    >
                      {["auto", "minimal", "low", "medium", "high", "xhigh", "max"].map((l) => (
                        <option key={l} value={l} style={nativeOptionStyle}>{l}</option>
                      ))}
                    </select>
                  </NativeSetting>
                  <NativeSetting label="Verbosity" description="Response detail level for supporting providers." scope="Native OMP">
                    <select
                      style={nativeSelectStyle}
                      value={nativeSettings?.textVerbosity ?? "medium"}
                      onChange={(e) => void saveNativeSettings({ ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}), textVerbosity: e.target.value as NativeSettings["textVerbosity"] })}
                    >
                      {["low", "medium", "high"].map((l) => (
                        <option key={l} value={l} style={nativeOptionStyle}>{l}</option>
                      ))}
                    </select>
                  </NativeSetting>
                  <NativeSetting label="Personality" description="Style included in OMP's system prompt." scope="Native OMP">
                    <select
                      style={nativeSelectStyle}
                      value={nativeSettings?.personality ?? "default"}
                      onChange={(e) => void saveNativeSettings({ ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}), personality: e.target.value as NativeSettings["personality"] })}
                    >
                      {["default", "friendly", "pragmatic", "none"].map((p) => (
                        <option key={p} value={p} style={nativeOptionStyle}>{p}</option>
                      ))}
                    </select>
                  </NativeSetting>
                  <NativeSetting label="Thinking Blocks" description="Hide model reasoning from output view." scope="Native OMP">
                    <ToggleSwitch
                      checked={nativeSettings?.hideThinkingBlock ?? false}
                      onChange={(checked) => void saveNativeSettings({ ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}), hideThinkingBlock: checked })}
                    />
                  </NativeSetting>
                  <NativeSetting label="External Thinking" description="Private scratchpad reasoning via think tool." scope="Native OMP">
                    <ToggleSwitch
                      checked={nativeSettings?.externalThinking ?? false}
                      onChange={(checked) => void saveNativeSettings({ ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}), externalThinking: checked })}
                    />
                  </NativeSetting>
                </div>
              </div>
            )}

            {/* API KEYS & PROVIDERS TAB */}
            {(visitedTabs.has("providers") || visitedTabs.has("models")) && (
              <div role="tabpanel" id="settings-panel-providers" aria-labelledby="settings-tab-providers" style={{ display: (currentTab === "providers" || activeTab === "providers") ? "flex" : "none", height: "100%", minHeight: 0, flexDirection: "column" }}>
                <ModelsConfig embedded onClose={onClose} onSaved={onModelsSaved} />
              </div>
            )}

            {/* AGENT INTELLIGENCE TAB */}
            {currentTab === "intelligence" && (
              <div role="tabpanel" id="settings-panel-intelligence" aria-labelledby="settings-tab-intelligence" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
                {/* Advisor Section */}
                <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
                    <Sparkles size={14} aria-hidden="true" style={{ color: "var(--accent)" }} /> Advisor Review
                  </div>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>Configured advisor model role passively reviews turns and injects guidance notes.</p>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    <NativeSetting label="Enable Advisor" description="Enable Advisor for new sessions with the advisor role." scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.advisor?.enabled ?? advisorEnabled}
                        onChange={(enabled) => {
                          onAdvisorChange(enabled);
                          void saveNativeSettings({
                            ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                            advisor: { ...(latestNativeSettingsRef.current ?? nativeSettings?.advisor ?? {}), enabled },
                          });
                        }}
                      />
                    </NativeSetting>
                    {(nativeSettings?.advisor?.enabled ?? advisorEnabled) && (
                      <NativeSetting label="Advisor Backlog" description="Wait briefly when advisor falls behind." scope="Native OMP">
                        <select
                          style={nativeSelectStyle}
                          value={nativeSettings?.advisor?.syncBacklog ?? "off"}
                          onChange={(e) =>
                            void saveNativeSettings({
                              ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                              advisor: { ...(latestNativeSettingsRef.current ?? nativeSettings?.advisor ?? {}), syncBacklog: e.target.value as "off" | "1" | "3" | "5" },
                            })
                          }
                        >
                          <option value="off" style={nativeOptionStyle}>Off</option>
                          <option value="1" style={nativeOptionStyle}>1 turn</option>
                          <option value="3" style={nativeOptionStyle}>3 turns</option>
                          <option value="5" style={nativeOptionStyle}>5 turns</option>
                        </select>
                      </NativeSetting>
                    )}
                  </div>
                  {(nativeSettings?.advisor?.enabled ?? advisorEnabled) && (
                    <NativeSetting label="Review Subagents" description="Apply Advisor passive review to subagent tasks." scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.advisor?.subagents ?? false}
                        onChange={(checked) =>
                          void saveNativeSettings({
                            ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                            advisor: { ...(latestNativeSettingsRef.current ?? nativeSettings?.advisor ?? {}), subagents: checked },
                          })
                        }
                      />
                    </NativeSetting>
                  )}
                </section>

                {/* Context Compaction Section */}
                <section style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Context Compaction</div>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>OMP automatically compacts oversized context to prevent hitting context limits.</p>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    <NativeSetting label="Automatic Compaction" description="Compact context before model context limit is hit." scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.compaction?.enabled ?? true}
                        onChange={(checked) =>
                          void saveNativeSettings({
                            ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                            compaction: { ...(latestNativeSettingsRef.current ?? nativeSettings?.compaction ?? {}), enabled: checked },
                          })
                        }
                      />
                    </NativeSetting>
                    <NativeSetting label="Continue After Compaction" description="Resume task execution after compaction completes." scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.compaction?.autoContinue ?? true}
                        onChange={(checked) =>
                          void saveNativeSettings({
                            ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                            compaction: { ...(latestNativeSettingsRef.current ?? nativeSettings?.compaction ?? {}), autoContinue: checked },
                          })
                        }
                      />
                    </NativeSetting>
                    <NativeSetting label="Maintenance Strategy" description="Select algorithm used to reduce context pressure." scope="Native OMP">
                      <select
                        style={nativeSelectStyle}
                        value={nativeSettings?.compaction?.strategy ?? "snapcompact"}
                        onChange={(e) =>
                          void saveNativeSettings({
                            ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                            compaction: { ...(latestNativeSettingsRef.current ?? nativeSettings?.compaction ?? {}), strategy: e.target.value as NonNullable<NativeSettings["compaction"]>["strategy"] },
                          })
                        }
                      >
                        <option value="snapcompact" style={nativeOptionStyle}>Snapcompact</option>
                        <option value="handoff" style={nativeOptionStyle}>Handoff</option>
                        <option value="context-full" style={nativeOptionStyle}>Context full</option>
                        <option value="shake" style={nativeOptionStyle}>Shake</option>
                        <option value="off" style={nativeOptionStyle}>Off</option>
                      </select>
                    </NativeSetting>
                    <NativeSetting label="Compact Mid-Turn" description="Check context limits between tool execution steps." scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.compaction?.midTurnEnabled ?? true}
                        onChange={(checked) =>
                          void saveNativeSettings({
                            ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                            compaction: { ...(latestNativeSettingsRef.current ?? nativeSettings?.compaction ?? {}), midTurnEnabled: checked },
                          })
                        }
                      />
                    </NativeSetting>
                  </div>
                </section>

                {/* Memory & Auto-Learn Section */}
                <section style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Memory & Auto-Learn</div>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>Durable project memory storage and automatic lesson capture.</p>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    <NativeSetting label="Memory Backend" description="Where durable knowledge is stored across sessions." scope="Native OMP">
                      <select
                        style={nativeSelectStyle}
                        value={nativeSettings?.memory?.backend ?? "mnemopi"}
                        onChange={(e) =>
                          void saveNativeSettings({
                            ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                            memory: { ...(latestNativeSettingsRef.current ?? nativeSettings?.memory ?? {}), backend: e.target.value as NonNullable<NativeSettings["memory"]>["backend"] },
                          })
                        }
                      >
                        <option value="off" style={nativeOptionStyle}>Off</option>
                        <option value="local" style={nativeOptionStyle}>Local summaries</option>
                        <option value="mnemopi" style={nativeOptionStyle}>Mnemopi SQLite</option>
                        <option value="hindsight" style={nativeOptionStyle}>Hindsight</option>
                      </select>
                    </NativeSetting>
                    <NativeSetting label="Enable Auto-Learn" description="Capture reusable lessons after completed runs." scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.autolearn?.enabled ?? true}
                        onChange={(checked) =>
                          void saveNativeSettings({
                            ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                            autolearn: { ...(latestNativeSettingsRef.current ?? nativeSettings?.autolearn ?? {}), enabled: checked },
                          })
                        }
                      />
                    </NativeSetting>
                    <NativeSetting label="Private Capture Turn" description="Run private lesson-capture turn at completion." scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.autolearn?.autoContinue ?? true}
                        onChange={(checked) =>
                          void saveNativeSettings({
                            ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                            autolearn: { ...(latestNativeSettingsRef.current ?? nativeSettings?.autolearn ?? {}), autoContinue: checked },
                          })
                        }
                      />
                    </NativeSetting>
                    <NativeSetting label="Memory Scope" description="Scoping for Mnemopi knowledge storage." scope="Native OMP">
                      <select
                        style={nativeSelectStyle}
                        value={nativeSettings?.mnemopi?.scoping ?? "per-project"}
                        onChange={(e) =>
                          void saveNativeSettings({
                            ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                            mnemopi: { ...(latestNativeSettingsRef.current ?? nativeSettings?.mnemopi ?? {}), scoping: e.target.value as NonNullable<NativeSettings["mnemopi"]>["scoping"] },
                          })
                        }
                      >
                        <option value="per-project" style={nativeOptionStyle}>Per project</option>
                        <option value="per-project-tagged" style={nativeOptionStyle}>Per project, tagged recall</option>
                        <option value="global" style={nativeOptionStyle}>Global</option>
                      </select>
                    </NativeSetting>
                    <NativeSetting label="Recall on Session Start" description="Load relevant memories into first turn." scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.mnemopi?.autoRecall ?? true}
                        onChange={(checked) =>
                          void saveNativeSettings({
                            ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                            mnemopi: { ...(latestNativeSettingsRef.current ?? nativeSettings?.mnemopi ?? {}), autoRecall: checked },
                          })
                        }
                      />
                    </NativeSetting>
                    <NativeSetting label="Retain Completed Turns" description="Store completed conversation turns in memory." scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.mnemopi?.autoRetain ?? true}
                        onChange={(checked) =>
                          void saveNativeSettings({
                            ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                            mnemopi: { ...(latestNativeSettingsRef.current ?? nativeSettings?.mnemopi ?? {}), autoRetain: checked },
                          })
                        }
                      />
                    </NativeSetting>
                  </div>
                </section>

                {/* Retry Section */}
                <section style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Automatic Retry</div>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>Rules for automatically retrying failed turns.</p>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    <NativeSetting label="Automatic Retry" description="Retry failed turns automatically." scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.retry?.enabled ?? true}
                        onChange={(checked) =>
                          void saveNativeSettings({
                            ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                            retry: { ...(latestNativeSettingsRef.current ?? nativeSettings?.retry ?? {}), enabled: checked },
                          })
                        }
                      />
                    </NativeSetting>
                    <NativeSetting label="Max Attempts" description="Retry limit before giving up." scope="Native OMP">
                      <select
                        style={nativeSelectStyle}
                        value={String(nativeSettings?.retry?.maxRetries ?? 2)}
                        onChange={(e) =>
                          void saveNativeSettings({
                            ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                            retry: { ...(latestNativeSettingsRef.current ?? nativeSettings?.retry ?? {}), maxRetries: Number(e.target.value) },
                          })
                        }
                      >
                        {[0, 1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n} style={nativeOptionStyle}>{n}</option>
                        ))}
                      </select>
                    </NativeSetting>
                    <NativeSetting label="Model Fallback" description="Fall back to alternative model when retries exhaust." scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.retry?.modelFallback ?? false}
                        onChange={(checked) =>
                          void saveNativeSettings({
                            ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                            retry: { ...(latestNativeSettingsRef.current ?? nativeSettings?.retry ?? {}), modelFallback: checked },
                          })
                        }
                      />
                    </NativeSetting>
                  </div>
                </section>
              </div>
            )}

            {/* EXTENSIONS & TOOLS TAB (MCP, SKILLS, PLUGINS) */}
            {(visitedTabs.has("mcp") || visitedTabs.has("skills") || visitedTabs.has("plugins")) && (
              <div role="tabpanel" id="settings-panel-mcp" aria-labelledby="settings-tab-mcp" style={{ display: currentTab === "mcp" ? "flex" : "none", height: "100%", minHeight: 0, flexDirection: "column", overflowY: "auto", padding: 20, gap: 16 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Extensions & Tools</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>Model Context Protocol servers, managed skills, and OMP plugins.</p>
                </div>
                {cwd && (
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    <NativeSetting label="Load Project MCP Servers" description="Allow project-root MCP configuration to be discovered." scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.mcp?.enableProjectConfig ?? true}
                        onChange={(checked) =>
                          void saveNativeSettings({
                            ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                            mcp: { ...(latestNativeSettingsRef.current ?? nativeSettings?.mcp ?? {}), enableProjectConfig: checked },
                          })
                        }
                      />
                    </NativeSetting>
                    <NativeSetting label="Render MCP Markdown" description="Render non-JSON MCP results as Markdown in transcript." scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.mcp?.renderMarkdownResults ?? true}
                        onChange={(checked) =>
                          void saveNativeSettings({
                            ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                            mcp: { ...(latestNativeSettingsRef.current ?? nativeSettings?.mcp ?? {}), renderMarkdownResults: checked },
                          })
                        }
                      />
                    </NativeSetting>
                    <NativeSetting label="MCP Resource Updates" description="Inject server resource updates into conversation." scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.mcp?.notifications ?? false}
                        onChange={(checked) =>
                          void saveNativeSettings({
                            ...(latestNativeSettingsRef.current ?? nativeSettings ?? {}),
                            mcp: { ...(latestNativeSettingsRef.current ?? nativeSettings?.mcp ?? {}), notifications: checked },
                          })
                        }
                      />
                    </NativeSetting>
                  </div>
                )}
                <McpConfig cwd={cwd} sessionId={sessionId} />
                {!cwd && <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>Select a project workspace to view and edit its project MCP configuration.</p>}
              </div>
            )}

            {/* SKILLS SUB-PANEL CONTRACT MATCH */}
            {cwd && visitedTabs.has("skills") && (
              <div role="tabpanel" id="settings-panel-skills" aria-labelledby="settings-tab-skills" style={{ display: activeTab === "skills" ? "flex" : "none", height: "100%", minHeight: 0, flexDirection: "column" }}>
                <SkillsConfig embedded cwd={cwd} onClose={onClose} />
              </div>
            )}

            {/* PLUGINS SUB-PANEL CONTRACT MATCH */}
            {cwd && visitedTabs.has("plugins") && (
              <div role="tabpanel" id="settings-panel-plugins" aria-labelledby="settings-tab-plugins" style={{ display: activeTab === "plugins" ? "flex" : "none", height: "100%", minHeight: 0, flexDirection: "column" }}>
                <PluginsConfig embedded cwd={cwd} sessionId={sessionId} onClose={onClose} onReloaded={onPluginsReloaded} />
              </div>
            )}

            {/* SYSTEM & UPDATES TAB */}
            {currentTab === "system" && (
              <div role="tabpanel" id="settings-panel-system" aria-labelledby="settings-tab-system" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>System & Updates</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>App version status, OMP runtime updates, and active session management.</p>
                </div>

                {/* ompweb app update card */}
                <section style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>ompweb application</div>
                      <div style={{ marginTop: 4, color: appUpdate?.updateAvailable ? "var(--accent)" : "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                        {checkingAppUpdate ? "Checking for updates..." : appUpdate?.updateAvailable ? `v${appUpdate.currentVersion ?? "?"} -> v${appUpdate.availableVersion}` : appUpdate?.currentVersion ? `v${appUpdate.currentVersion} is up to date` : "Version unavailable"}
                      </div>
                    </div>
                    <button type="button" onClick={() => void checkForAppUpdate(true)} disabled={checkingAppUpdate} aria-label="Check ompweb updates" style={{ padding: "6px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "transparent", color: "var(--text)", cursor: checkingAppUpdate ? "wait" : "pointer", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <RefreshCw size={13} aria-hidden="true" /> Refresh
                    </button>
                  </div>
                  {appUpdate?.updateAvailable && (
                    <div style={{ marginTop: 6, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg)", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Run this command in terminal to update ompweb:</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <code style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)", wordBreak: "break-all" }}>{appUpdate.updateCommand || "npm install -g @kahme247/ompweb"}</code>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(appUpdate.updateCommand || "npm install -g @kahme247/ompweb");
                            setMessage("Copied update command to clipboard.");
                          }}
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", cursor: "pointer", fontSize: 11 }}
                        >
                          <Copy size={12} aria-hidden="true" /> Copy
                        </button>
                      </div>
                    </div>
                  )}
                </section>

                {/* OMP runtime update card */}
                <section style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>OMP runtime</div>
                      <div style={{ marginTop: 4, color: update?.updateAvailable ? "var(--accent)" : "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                        {checking ? "Checking for updates..." : update?.updateAvailable ? `v${update.currentVersion ?? "?"} -> v${update.availableVersion}` : update?.currentVersion ? `v${update.currentVersion} is up to date` : "Version unavailable"}
                      </div>
                    </div>
                    <button type="button" onClick={() => void checkForUpdate()} disabled={checking} aria-label="Check OMP updates" style={{ padding: "6px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "transparent", color: "var(--text)", cursor: checking ? "wait" : "pointer", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <RefreshCw size={13} aria-hidden="true" /> Refresh
                    </button>
                  </div>
                  {update?.updateAvailable && (
                    <div style={{ marginTop: 6, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg)", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Run this command in terminal to update OMP runtime:</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <code style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)", wordBreak: "break-all" }}>{update.updateCommand || "omp update"}</code>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(update.updateCommand || "omp update");
                            setMessage("Copied update command to clipboard.");
                          }}
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", cursor: "pointer", fontSize: 11 }}
                        >
                          <Copy size={12} aria-hidden="true" /> Copy
                        </button>
                      </div>
                    </div>
                  )}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                    <button
                      type="button"
                      onClick={() => void restartSessions()}
                      disabled={restarting}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", cursor: restarting ? "wait" : "pointer", fontSize: 12 }}
                    >
                      <RotateCcw size={13} aria-hidden="true" /> {restarting ? "Restarting..." : "Restart OMP sessions"}
                    </button>
                    <a
                      href="https://github.com/can1357/oh-my-pi/releases"
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", color: "var(--text-muted)", textDecoration: "none", fontSize: 12 }}
                    >
                      <ExternalLink size={13} aria-hidden="true" /> Changelog
                    </a>
                  </div>
                  {message && <p role="status" style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>{message}</p>}
                </section>
              </div>
            )}
              </div>
            </SettingsHighlightContext.Provider>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

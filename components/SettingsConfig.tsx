"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { getSubmitDuringRunBehavior, setSubmitDuringRunBehavior, type SubmitDuringRunBehavior } from "@/lib/composer-prefs";
import dynamic from "next/dynamic";
import { Copy, ExternalLink, RefreshCw, RotateCcw, Search, AlertCircle } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useMotionPrefs } from "@/hooks/useMotionPrefs";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/primitives";
import { SettingsTabs, type SettingsTab, SETTINGS_CATEGORIES, getNormalizedActive } from "./SettingsTabs";
import { useI18n } from "@/lib/i18n";
import { copyText } from "@/lib/clipboard";

const SettingsTabLoading = () => {
  const { t } = useI18n();
  return <div role="status" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>{t("settingsConfig.loadingSettings")}</div>;
};
const ModelsConfig = dynamic(() => import("./ModelsConfig").then((module) => module.ModelsConfig), { loading: SettingsTabLoading, ssr: false });
const SkillsConfig = dynamic(() => import("./SkillsConfig").then((module) => module.SkillsConfig), { loading: SettingsTabLoading, ssr: false });
const PluginsConfig = dynamic(() => import("./PluginsConfig").then((module) => module.PluginsConfig), { loading: SettingsTabLoading, ssr: false });
const McpConfig = dynamic(() => import("./McpConfig").then((module) => module.McpConfig), { loading: SettingsTabLoading, ssr: false });
const AgentsConfig = dynamic(() => import("./AgentsConfig").then((module) => module.AgentsConfig), { loading: SettingsTabLoading, ssr: false });
const RemoteAccessSetting = dynamic(() => import("./RemoteAccessSetting").then((module) => module.RemoteAccessSetting), { loading: SettingsTabLoading, ssr: false });
import { NetworkProxyConfig } from "./NetworkProxyConfig";
import { SplashAnimationSetting } from "./SplashAnimationSetting";
import { NativeExtrasSetting } from "./NativeExtrasSetting";
import { UpdateNoticeDialog } from "./UpdateNoticeDialog";
import { loadUpdateHistory, clearUpdateHistory, isUpdateNoticeEnabled, setUpdateNoticeEnabled, type UpdateRecord } from "@/lib/update-notice";

type UpdateState = {
  currentVersion: string | null;
  availableVersion: string | null;
  updateAvailable: boolean;
  updateCommand?: string;
  checkError?: boolean;
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

const chipStyle = {
  fontSize: 10,
  padding: "1px 6px",
  borderRadius: 4,
  background: "var(--bg-subtle)",
  color: "var(--text-muted)",
  fontWeight: 500,
} as const;

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

const SettingsHighlightContext = createContext<string | null>(null);

type EnhancedChildProps = {
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-label"?: string;
};

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
  id: string;
  tab: SettingsTab;
  sectionKey: string;
  labelKey: string;
  descKey: string;
  fallbackSection: string;
  fallbackLabel: string;
  fallbackDesc: string;
  scope?: "UI" | "Native OMP" | "Workspace";
};

const SETTING_INDEX: SettingIndexEntry[] = [
  // Interface & Behavior
  { id: "keep-tool-calls-collapsed", tab: "general", sectionKey: "settingsConfig.interfaceBehavior", labelKey: "settingsConfig.keepToolCallsCollapsed", descKey: "settingsConfig.keepToolCallsCollapsedDesc", fallbackSection: "Interface & Behavior", fallbackLabel: "Keep tool calls collapsed", fallbackDesc: "Show only compact headers while tools execute.", scope: "UI" },
  { id: "thinking-display-mode", tab: "general", sectionKey: "settingsConfig.interfaceBehavior", labelKey: "settingsConfig.thinkingDisplayMode", descKey: "settingsConfig.thinkingDisplayModeDesc", fallbackSection: "Interface & Behavior", fallbackLabel: "Thinking Display Behavior", fallbackDesc: "Configure whether model thinking blocks default to collapsed, auto-collapse, or always expanded.", scope: "UI" },
  { id: "completion-sound", tab: "general", sectionKey: "settingsConfig.interfaceBehavior", labelKey: "settingsConfig.completionSound", descKey: "settingsConfig.completionSoundDesc", fallbackSection: "Interface & Behavior", fallbackLabel: "Completion sound", fallbackDesc: "Play a tone when the agent completes a run.", scope: "UI" },
  { id: "message-during-active-run", tab: "general", sectionKey: "settingsConfig.interfaceBehavior", labelKey: "settingsConfig.messageDuringActiveRun", descKey: "settingsConfig.messageDuringActiveRunDesc", fallbackSection: "Interface & Behavior", fallbackLabel: "Message during active run", fallbackDesc: "What composer does on submit while agent runs. Steer interrupts; Queue follow-up delivers after finish.", scope: "UI" },
  { id: "global-animations", tab: "general", sectionKey: "settingsConfig.interfaceBehavior", labelKey: "settingsConfig.globalAnimations", descKey: "settingsConfig.globalAnimationsDesc", fallbackSection: "Interface & Behavior", fallbackLabel: "Global Animations", fallbackDesc: "Enable or disable all UI animations across the application.", scope: "UI" },
  { id: "chat-border-beam", tab: "general", sectionKey: "settingsConfig.interfaceBehavior", labelKey: "settingsConfig.chatBorderBeam", descKey: "settingsConfig.chatBorderBeamDesc", fallbackSection: "Interface & Behavior", fallbackLabel: "Chat Border Flow", fallbackDesc: "Clockwise luminous beam on input border during active conversation.", scope: "UI" },
  { id: "omp-bouncing-letters", tab: "general", sectionKey: "settingsConfig.interfaceBehavior", labelKey: "settingsConfig.ompBouncingLetters", descKey: "settingsConfig.ompBouncingLettersDesc", fallbackSection: "Interface & Behavior", fallbackLabel: "OMP Loader Jump", fallbackDesc: "Sequential jumping letters animation while waiting for response.", scope: "UI" },
  { id: "thinking-pulse", tab: "general", sectionKey: "settingsConfig.interfaceBehavior", labelKey: "settingsConfig.thinkingPulse", descKey: "settingsConfig.thinkingPulseDesc", fallbackSection: "Interface & Behavior", fallbackLabel: "Thinking Pulse", fallbackDesc: "Breathing brain pulse animation on the reasoning icon.", scope: "UI" },
  // Tool Safety & Approvals
  { id: "approval-mode", tab: "safety", sectionKey: "settingsConfig.toolSafetyApprovals", labelKey: "settingsConfig.approvalMode", descKey: "settingsConfig.approvalModeDesc", fallbackSection: "Tool Safety & Approvals", fallbackLabel: "Approval Mode", fallbackDesc: "Choose when OMP asks before tool calls.", scope: "Native OMP" },
  { id: "bash-override", tab: "safety", sectionKey: "settingsConfig.toolSafetyApprovals", labelKey: "settingsConfig.bashOverride", descKey: "settingsConfig.bashOverrideDesc", fallbackSection: "Tool Safety & Approvals", fallbackLabel: "Bash Override", fallbackDesc: "Override default approval policy specifically for terminal commands.", scope: "Native OMP" },
  { id: "extension-tool-requests", tab: "safety", sectionKey: "settingsConfig.toolSafetyApprovals", labelKey: "settingsConfig.extensionToolRequests", descKey: "settingsConfig.extensionToolRequestsDesc", fallbackSection: "Tool Safety & Approvals", fallbackLabel: "Extension Tool Requests", fallbackDesc: "Automatically approve extension tool authorization requests.", scope: "Native OMP" },
  // AI Model Defaults
  { id: "reasoning", tab: "models", sectionKey: "settingsConfig.modelDefaults", labelKey: "settingsConfig.reasoning", descKey: "settingsConfig.reasoningDesc", fallbackSection: "AI Model Defaults", fallbackLabel: "Reasoning", fallbackDesc: "Default effort level for thinking-capable models.", scope: "Native OMP" },
  { id: "verbosity", tab: "models", sectionKey: "settingsConfig.modelDefaults", labelKey: "settingsConfig.verbosity", descKey: "settingsConfig.verbosityDesc", fallbackSection: "AI Model Defaults", fallbackLabel: "Verbosity", fallbackDesc: "Response detail level for supporting providers.", scope: "Native OMP" },
  { id: "personality", tab: "models", sectionKey: "settingsConfig.modelDefaults", labelKey: "settingsConfig.personality", descKey: "settingsConfig.personalityDesc", fallbackSection: "AI Model Defaults", fallbackLabel: "Personality", fallbackDesc: "Style included in OMP's system prompt.", scope: "Native OMP" },
  { id: "thinking-blocks", tab: "models", sectionKey: "settingsConfig.modelDefaults", labelKey: "settingsConfig.thinkingBlocks", descKey: "settingsConfig.thinkingBlocksDesc", fallbackSection: "AI Model Defaults", fallbackLabel: "Thinking Blocks", fallbackDesc: "Hide model reasoning from output view.", scope: "Native OMP" },
  { id: "external-thinking", tab: "models", sectionKey: "settingsConfig.modelDefaults", labelKey: "settingsConfig.externalThinking", descKey: "settingsConfig.externalThinkingDesc", fallbackSection: "AI Model Defaults", fallbackLabel: "External Thinking", fallbackDesc: "Private scratchpad reasoning via think tool.", scope: "Native OMP" },
  // Context Compaction
  { id: "automatic-compaction", tab: "intelligence", sectionKey: "settingsConfig.contextCompaction", labelKey: "settingsConfig.automaticCompaction", descKey: "settingsConfig.automaticCompactionDesc", fallbackSection: "Context Compaction", fallbackLabel: "Automatic Compaction", fallbackDesc: "Compact context before model context limit is hit.", scope: "Native OMP" },
  { id: "continue-after-compaction", tab: "intelligence", sectionKey: "settingsConfig.contextCompaction", labelKey: "settingsConfig.continueAfterCompaction", descKey: "settingsConfig.continueAfterCompactionDesc", fallbackSection: "Context Compaction", fallbackLabel: "Continue After Compaction", fallbackDesc: "Resume task execution after compaction completes.", scope: "Native OMP" },
  { id: "maintenance-strategy", tab: "intelligence", sectionKey: "settingsConfig.contextCompaction", labelKey: "settingsConfig.maintenanceStrategy", descKey: "settingsConfig.maintenanceStrategyDesc", fallbackSection: "Context Compaction", fallbackLabel: "Maintenance Strategy", fallbackDesc: "Select algorithm used to reduce context pressure.", scope: "Native OMP" },
  { id: "compact-mid-turn", tab: "intelligence", sectionKey: "settingsConfig.contextCompaction", labelKey: "settingsConfig.compactMidTurn", descKey: "settingsConfig.compactMidTurnDesc", fallbackSection: "Context Compaction", fallbackLabel: "Compact Mid-Turn", fallbackDesc: "Check context limits between tool execution steps.", scope: "Native OMP" },
  // Memory & Auto-Learn
  { id: "memory-backend", tab: "intelligence", sectionKey: "settingsConfig.memoryAutoLearn", labelKey: "settingsConfig.memoryBackend", descKey: "settingsConfig.memoryBackendDesc", fallbackSection: "Memory & Auto-Learn", fallbackLabel: "Memory Backend", fallbackDesc: "Where durable knowledge is stored across sessions.", scope: "Native OMP" },
  { id: "enable-auto-learn", tab: "intelligence", sectionKey: "settingsConfig.memoryAutoLearn", labelKey: "settingsConfig.enableAutoLearn", descKey: "settingsConfig.enableAutoLearnDesc", fallbackSection: "Memory & Auto-Learn", fallbackLabel: "Enable Auto-Learn", fallbackDesc: "Capture reusable lessons after completed runs.", scope: "Native OMP" },
  { id: "private-capture-turn", tab: "intelligence", sectionKey: "settingsConfig.memoryAutoLearn", labelKey: "settingsConfig.privateCaptureTurn", descKey: "settingsConfig.privateCaptureTurnDesc", fallbackSection: "Memory & Auto-Learn", fallbackLabel: "Private Capture Turn", fallbackDesc: "Run private lesson-capture turn at completion.", scope: "Native OMP" },
  { id: "memory-scope", tab: "intelligence", sectionKey: "settingsConfig.memoryAutoLearn", labelKey: "settingsConfig.memoryScope", descKey: "settingsConfig.memoryScopeDesc", fallbackSection: "Memory & Auto-Learn", fallbackLabel: "Memory Scope", fallbackDesc: "Scoping for Mnemopi knowledge storage.", scope: "Native OMP" },
  { id: "recall-on-session-start", tab: "intelligence", sectionKey: "settingsConfig.memoryAutoLearn", labelKey: "settingsConfig.recallOnSessionStart", descKey: "settingsConfig.recallOnSessionStartDesc", fallbackSection: "Memory & Auto-Learn", fallbackLabel: "Recall on Session Start", fallbackDesc: "Load relevant memories into first turn.", scope: "Native OMP" },
  { id: "retain-completed-turns", tab: "intelligence", sectionKey: "settingsConfig.memoryAutoLearn", labelKey: "settingsConfig.retainCompletedTurns", descKey: "settingsConfig.retainCompletedTurnsDesc", fallbackSection: "Memory & Auto-Learn", fallbackLabel: "Retain Completed Turns", fallbackDesc: "Store completed conversation turns in memory.", scope: "Native OMP" },
  // Automatic Retry
  { id: "automatic-retry", tab: "intelligence", sectionKey: "settingsConfig.automaticRetry", labelKey: "settingsConfig.retryToggle", descKey: "settingsConfig.retryToggleDesc", fallbackSection: "Automatic Retry", fallbackLabel: "Automatic Retry", fallbackDesc: "Retry failed turns automatically.", scope: "Native OMP" },
  { id: "max-attempts", tab: "intelligence", sectionKey: "settingsConfig.automaticRetry", labelKey: "settingsConfig.maxAttempts", descKey: "settingsConfig.maxAttemptsDesc", fallbackSection: "Automatic Retry", fallbackLabel: "Max Attempts", fallbackDesc: "Retry limit before giving up.", scope: "Native OMP" },
  { id: "model-fallback", tab: "intelligence", sectionKey: "settingsConfig.automaticRetry", labelKey: "settingsConfig.modelFallback", descKey: "settingsConfig.modelFallbackDesc", fallbackSection: "Automatic Retry", fallbackLabel: "Model Fallback", fallbackDesc: "Fall back to alternative model when retries exhaust.", scope: "Native OMP" },
  // Agents
  { id: "agent-roster", tab: "agents", sectionKey: "settingsConfig.agentsTitle", labelKey: "settingsTabs.agents.label", descKey: "settingsTabs.agents.description", fallbackSection: "Agents", fallbackLabel: "Agent roster", fallbackDesc: "Browse enabled agents filtered by name and source.", scope: "Native OMP" },
  { id: "agent-model", tab: "agents", sectionKey: "settingsConfig.agentsTitle", labelKey: "agentsConfig.modelRoles", descKey: "modelsConfig.modelRolesDesc", fallbackSection: "Agents", fallbackLabel: "Agent model", fallbackDesc: "Model mapping and reasoning effort per agent role.", scope: "Native OMP" },
  { id: "agent-tools", tab: "agents", sectionKey: "settingsConfig.agentsTitle", labelKey: "agentsConfig.tools", descKey: "settingsTabs.agents.description", fallbackSection: "Agents", fallbackLabel: "Agent tools", fallbackDesc: "Allowed tools and delegated task prompt per agent.", scope: "Native OMP" },
  // Extensions & Tools
  { id: "load-project-mcp-servers", tab: "mcp", sectionKey: "settingsConfig.extensionsTools", labelKey: "settingsConfig.loadProjectMcp", descKey: "settingsConfig.loadProjectMcpDesc", fallbackSection: "Extensions & Tools", fallbackLabel: "Load Project MCP Servers", fallbackDesc: "Allow project-root MCP configuration to be discovered.", scope: "Native OMP" },
  { id: "render-mcp-markdown", tab: "mcp", sectionKey: "settingsConfig.extensionsTools", labelKey: "settingsConfig.renderMcpMarkdown", descKey: "settingsConfig.renderMcpMarkdownDesc", fallbackSection: "Extensions & Tools", fallbackLabel: "Render MCP Markdown", fallbackDesc: "Render non-JSON MCP results as Markdown in transcript.", scope: "Native OMP" },
  { id: "mcp-resource-updates", tab: "mcp", sectionKey: "settingsConfig.extensionsTools", labelKey: "settingsConfig.mcpResourceUpdates", descKey: "settingsConfig.mcpResourceUpdatesDesc", fallbackSection: "Extensions & Tools", fallbackLabel: "MCP Resource Updates", fallbackDesc: "Inject server resource updates into conversation.", scope: "Native OMP" },
];

function SearchResultsList({ results, query, onSelect }: { results: SearchResult[]; query: string; onSelect: (result: SearchResult) => void }) {
  const { t, tn } = useI18n();
  const formatScope = (s?: string) => {
    if (s === "UI") return t("settingsConfig.chipUI");
    if (s === "Native OMP") return t("settingsConfig.chipNativeOMP");
    if (s === "Workspace") return t("settingsConfig.chipWorkspace");
    return s;
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", background: "var(--bg)", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
        {results.length === 0 ? t("settingsConfig.noSettingsMatch", { query }) : tn("settingsConfig.searchResults", results.length, { count: results.length, query })}
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
              <span style={chipStyle}>{t("settingsConfig.chipSection")}</span>
            )}
            {result.scope && (
              <span style={chipStyle}>{formatScope(result.scope)}</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.45 }}>{result.description}</div>
          {result.section && <div style={{ fontSize: 10, color: "var(--text-dim)" }}>{result.section}</div>}
        </button>
      ))}
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="ui-focus-ring"
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        width: 40,
        height: 24,
        borderRadius: 12,
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
          width: 20,
          height: 20,
          borderRadius: 10,
          background: "#fff",
          transform: checked ? "translateX(16px)" : "translateX(0px)",
          transition: "transform var(--dur-fast)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />
    </button>
  );
}

function NativeSetting({ label, description, scope, searchId, children }: { label: string; description: string; scope?: "UI" | "Native OMP" | "Workspace"; searchId?: string; children: ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const highlightId = useContext(SettingsHighlightContext);
  const settingSlug = searchId || slugify(label);
  const highlighted = highlightId !== null && (highlightId === settingSlug || highlightId === slugify(label));
  const settingId = 'setting-' + settingSlug;
  const labelId = 'setting-label-' + settingSlug;
  const descId = 'setting-desc-' + settingSlug;

  const formatScope = (s?: string) => {
    if (s === "UI") return t("settingsConfig.chipUI");
    if (s === "Native OMP") return t("settingsConfig.chipNativeOMP");
    if (s === "Workspace") return t("settingsConfig.chipWorkspace");
    return s;
  };

  useEffect(() => {
    if (highlighted && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlighted]);

  let enhancedChild = children;
  if (isValidElement(children)) {
    const childProps = children.props as EnhancedChildProps;
    enhancedChild = cloneElement(children as ReactElement<EnhancedChildProps>, {
      id: childProps.id || settingId,
      "aria-labelledby": childProps["aria-labelledby"] || labelId,
      "aria-describedby": childProps["aria-describedby"] || descId,
      "aria-label": childProps["aria-label"] || label,
    });
  }

  return (
    <div
      ref={ref}
      data-search-id={settingSlug}
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: "1 1 auto" }}>
          {/* flexShrink 0 keeps CJK labels from collapsing to one glyph per
              line ("vertical text"); flexWrap above moves the control below
              the label on narrow cards instead of squeezing it. */}
          <label id={labelId} htmlFor={settingId} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)", cursor: "pointer", flexShrink: 0 }}>{label}</label>
          {scope && (
            <span style={{ ...chipStyle, flexShrink: 0 }}>
              {formatScope(scope)}
            </span>
          )}
        </div>
        <span style={{ flexShrink: 0 }}>{enhancedChild}</span>
      </div>
      <span id={descId} style={{ color: "var(--text-muted)", fontSize: 11, lineHeight: 1.45, overflowWrap: "anywhere" }}>{description}</span>
    </div>
  );
}

export function SettingsConfig({ activeTab, toolCallsDefaultCollapsed, onToolCallsDefaultCollapsedChange, thinkingDisplayMode = "auto", onThinkingDisplayModeChange, cwd, sessionId, onModelsSaved, onPluginsReloaded, onOmpUpdateAvailabilityChange, onSelectTab, onClose }: {
  activeTab: SettingsTab;
  toolCallsDefaultCollapsed: boolean;
  onToolCallsDefaultCollapsedChange: (collapsed: boolean) => void;
  thinkingDisplayMode?: "auto" | "collapsed" | "expanded";
  onThinkingDisplayModeChange?: (mode: "auto" | "collapsed" | "expanded") => void;
  cwd: string | null;
  sessionId: string | null;
  onModelsSaved: () => void;
  onPluginsReloaded: () => void;
  onOmpUpdateAvailabilityChange: (available: boolean) => void;
  onSelectTab: (tab: SettingsTab) => void;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
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
  const { motionPrefs, setMotionPrefs } = useMotionPrefs();
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [checking, setChecking] = useState(false);
  const [appUpdate, setAppUpdate] = useState<UpdateState | null>(null);
  const [checkingAppUpdate, setCheckingAppUpdate] = useState(false);
  const [hasCheckedUpdates, setHasCheckedUpdates] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nativeSettings, setNativeSettings] = useState<NativeSettings | null>(null);
  const [nativeSettingsError, setNativeSettingsError] = useState<string | null>(null);
  const [nativeSavesInFlight, setNativeSavesInFlight] = useState(0);
  const [isPending, startTransition] = useTransition();
  const latestNativeSettingsRef = useRef<NativeSettings | null>(null);
  const nativeSaveDrainingRef = useRef(false);
  const nativeSettingsMutatedRef = useRef(false);

  useEffect(() => {
    fetch("/api/omp-settings")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((data: { settings?: NativeSettings }) => {
        if (!nativeSettingsMutatedRef.current) setNativeSettings(data.settings ?? {});
      })
      .catch((error) => setNativeSettingsError(error instanceof Error ? error.message : String(error)));
  }, []);

  const saveNativeSettings = useCallback((next: NativeSettings) => {
    nativeSettingsMutatedRef.current = true;
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

  const currentSettings = useCallback((): NativeSettings => latestNativeSettingsRef.current ?? nativeSettings ?? {}, [nativeSettings]);

  const patchSettings = useCallback((patch: Partial<NativeSettings>) => {
    void saveNativeSettings({ ...currentSettings(), ...patch });
  }, [currentSettings, saveNativeSettings]);

  const patchSection = useCallback(<K extends keyof NativeSettings,>(key: K, patch: Partial<NonNullable<NativeSettings[K]>>) => {
    const base = latestNativeSettingsRef.current;
    const section = (base ?? nativeSettings?.[key] ?? {}) as object;
    void saveNativeSettings({ ...currentSettings(), [key]: { ...section, ...patch } });
  }, [currentSettings, nativeSettings, saveNativeSettings]);

  const patchApproval = useCallback((patch: Partial<NonNullable<NonNullable<NativeSettings["tools"]>["approval"]>>) => {
    const base = latestNativeSettingsRef.current ?? nativeSettings ?? {};
    const tools = base.tools ?? {};
    void saveNativeSettings({ ...base, tools: { ...tools, approval: { ...(tools.approval ?? {}), ...patch } } });
  }, [nativeSettings, saveNativeSettings]);

  const [updatingOmp, setUpdatingOmp] = useState(false);
  const [ompUpdateOutput, setOmpUpdateOutput] = useState<string | null>(null);
  const [ompUpdated, setOmpUpdated] = useState(false);
  const [updatingApp, setUpdatingApp] = useState(false);
  const [appUpdateOutput, setAppUpdateOutput] = useState<string | null>(null);
  const [appUpdated, setAppUpdated] = useState(false);
  const [desktopUpdateState, setDesktopUpdateState] = useState<{ status: string; version?: string; percent?: number; message?: string }>({ status: "idle" });

  // Desktop app: subscribe to the native updater's status broadcasts and
  useEffect(() => {
    const desktop = (window as { ompWebDesktop?: { isDesktop?: boolean; version?: string; updateCheck?: () => Promise<unknown>; onUpdateStatus?: (cb: (s: { status: string; version?: string; percent?: number; message?: string }) => void) => () => void } }).ompWebDesktop;
    if (!desktop?.isDesktop) return;
    const localVersion = desktop.version ?? "?";

    // Show the installed version IMMEDIATELY — the update card must never
    // sit on "version unavailable" while the (slow/offline) native check
    // runs. The check events refine this afterwards.
    setAppUpdate((prev) => prev ?? { currentVersion: localVersion, availableVersion: null, updateAvailable: false, updateCommand: "" });

    if (!desktop.onUpdateStatus) return;
    const unsubscribe = desktop.onUpdateStatus((status) => {
      setDesktopUpdateState(status);
      if (status.status === "downloaded") {
        setAppUpdated(false);
        setUpdatingApp(false);
      }
      if (status.status === "error") {
        setUpdatingApp(false);
        // Keep the installed version visible and mark the CHECK as failed
        // instead of falling back to "version unavailable".
        setAppUpdate({ currentVersion: localVersion, availableVersion: null, updateAvailable: false, updateCommand: "", checkError: true });
        setMessage(status.message ?? t("settingsConfig.desktopUpdateFailed"));
      }
      if (status.status === "available" || status.status === "downloaded") {
        onOmpUpdateAvailabilityChange(true);
      }
      if (status.status === "up-to-date" || status.status === "error") {
        onOmpUpdateAvailabilityChange(false);
      }
      if (status.status === "up-to-date") {
        setAppUpdate({ currentVersion: localVersion, availableVersion: null, updateAvailable: false, updateCommand: "" });
      }
      if (status.status === "available") {
        setAppUpdate({ currentVersion: localVersion, availableVersion: status.version ?? "?", updateAvailable: true, updateCommand: "" });
      }
    });
    // One quiet check on mount so the card reflects reality without the user
    // having to click Refresh (launch-time events fired before mount).
    desktop.updateCheck?.().catch(() => undefined);
    return unsubscribe;
  }, [t, onOmpUpdateAvailabilityChange]);

  const runAppUpdate = useCallback(async () => {
    // Desktop app: the native updater downloads and restarts the packaged
    // app. Browser/CLI: npm/bun install -g + manual restart.
    const desktop = (window as { ompWebDesktop?: { isDesktop?: boolean; updateDownload?: () => Promise<unknown> } }).ompWebDesktop;
    if (desktop?.isDesktop) {
      setUpdatingApp(true);
      setAppUpdateOutput(null);
      setAppUpdated(false);
      try {
        await desktop.updateDownload?.();
        // The updater broadcasts status events; the downloaded state flips
        // the button into "Restart to apply".
        setDesktopUpdateState((prev) => ({ ...prev, downloading: true }));
      } catch {
        setMessage(t("settingsConfig.desktopUpdateUnavailable"));
        setUpdatingApp(false);
      }
      return;
    }
    setUpdatingApp(true);
    setAppUpdateOutput(null);
    setAppUpdated(false);
    try {
      const response = await fetch("/api/app-update", { method: "POST" });
      const data = (await response.json()) as { success?: boolean; output?: string; restartRequired?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error ?? `HTTP ${response.status}`);
      setAppUpdateOutput(data.output ?? null);
      setAppUpdated(true);
      setAppUpdate((prev) => (prev ? { ...prev, updateAvailable: false } : prev));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setUpdatingApp(false);
    }
  }, [t]);

  const runOmpUpdate = useCallback(async () => {
    setUpdatingOmp(true);
    setOmpUpdateOutput(null);
    setOmpUpdated(false);
    try {
      const response = await fetch("/api/omp-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update" }) });
      const data = (await response.json()) as { success?: boolean; output?: string; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error ?? `HTTP ${response.status}`);
      setOmpUpdateOutput(data.output ?? null);
      setOmpUpdated(true);
      onOmpUpdateAvailabilityChange(false);
      setUpdate((prev) => (prev ? { ...prev, updateAvailable: false } : prev));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setUpdatingOmp(false);
    }
  }, [onOmpUpdateAvailabilityChange]);

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
      // Same as the app card: a failed check must be visible in the card,
      // not silently rendered as "version unavailable".
      setUpdate((prev) => prev ?? { currentVersion: null, availableVersion: null, updateAvailable: false, checkError: true });
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }, [onOmpUpdateAvailabilityChange]);

  const checkForAppUpdate = useCallback(async (force = false) => {
    // Desktop app: the native updater (GitHub releases feed) drives the
    // download/apply flow, but GitHub is unreachable on some networks — the
    // card must never hang on "version unavailable" waiting for it. Always
    // populate from the embedded server's registry check first, then let the
    // native check refine it (its status events still drive download state).
    const desktop = (window as { ompWebDesktop?: { updateCheck?: () => Promise<unknown> } }).ompWebDesktop;
    if (desktop?.updateCheck) {
      setCheckingAppUpdate(true);
      try {
        const registry = await fetch(force ? "/api/app-update?force=1" : "/api/app-update");
        const data = (await registry.json()) as UpdateState & { error?: string };
        if (registry.ok && !data.error) {
          setAppUpdate((prev) => (prev?.updateAvailable ? prev : data));
        }
      } catch {
        // Registry unreachable: keep whatever the native events provided.
      }
      try {
        await desktop.updateCheck();
      } catch {
        setMessage(t("settingsConfig.desktopUpdateUnavailable"));
      } finally {
        setCheckingAppUpdate(false);
      }
      return;
    }
    setCheckingAppUpdate(true);
    try {
      const response = await fetch(force ? "/api/app-update?force=1" : "/api/app-update");
      const data = (await response.json()) as UpdateState & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      setAppUpdate(data);
    } catch (error) {
      // Surface the failure in the card itself — leaving the state null kept
      // the card on "version unavailable" with no hint that the CHECK failed
      // (vs. genuinely having no version info).
      setAppUpdate((prev) => prev ?? { currentVersion: null, availableVersion: null, updateAvailable: false, checkError: true });
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckingAppUpdate(false);
    }
  }, [t]);

  const restartSessions = useCallback(async () => {
    setRestarting(true);
    try {
      const response = await fetch("/api/omp-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restart" }) });
      const data = (await response.json()) as { error?: string; sessionsRestarted?: number };
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      setMessage(t("settingsConfig.restartSuccess", { count: data.sessionsRestarted ?? 0 }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRestarting(false);
    }
  }, [t]);

  const currentTab = getNormalizedActive(activeTab);

  useEffect(() => {
    if (currentTab !== "system" || hasCheckedUpdates) return;
    setHasCheckedUpdates(true);
    void checkForUpdate();
    void checkForAppUpdate();
  }, [currentTab, hasCheckedUpdates, checkForUpdate, checkForAppUpdate]);

  const [noticeEnabled, setNoticeEnabled] = useState(isUpdateNoticeEnabled());
  const [noticeHistory, setNoticeHistory] = useState<UpdateRecord[]>(() => loadUpdateHistory());
  const [historyVersion, setHistoryVersion] = useState<string | null>(null);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const searchActive = trimmedQuery.length > 0;

  const searchResults = useMemo<SearchResult[]>(() => {
    if (!trimmedQuery) return [];
    const results: SearchResult[] = [];
    for (const category of SETTINGS_CATEGORIES) {
      const labelKeyCat = `settingsTabs.${category.id}.label`;
      const descKeyCat = `settingsTabs.${category.id}.description`;
      const trLabelCat = t(labelKeyCat);
      const trDescCat = t(descKeyCat);
      const localizedLabel = trLabelCat !== labelKeyCat ? trLabelCat : category.label;
      const localizedDesc = trDescCat !== descKeyCat ? trDescCat : category.description;
      const haystack = `${localizedLabel} ${localizedDesc} ${category.label} ${category.description}`.toLowerCase();
      if (haystack.includes(trimmedQuery)) {
        results.push({ id: `tab-${category.id}`, kind: "category", tab: category.id, label: localizedLabel, description: localizedDesc });
      }
    }
    for (const setting of SETTING_INDEX) {
      const trLabel = t(setting.labelKey);
      const trDesc = t(setting.descKey);
      const trSection = t(setting.sectionKey);
      const localizedLabel = trLabel !== setting.labelKey ? trLabel : setting.fallbackLabel;
      const localizedDesc = trDesc !== setting.descKey ? trDesc : setting.fallbackDesc;
      const localizedSection = trSection !== setting.sectionKey ? trSection : setting.fallbackSection;
      const haystack = `${localizedLabel} ${localizedDesc} ${localizedSection} ${setting.fallbackLabel} ${setting.fallbackDesc} ${setting.fallbackSection}`.toLowerCase();
      if (haystack.includes(trimmedQuery)) {
        results.push({ id: setting.id, kind: "setting", tab: setting.tab, label: localizedLabel, description: localizedDesc, scope: setting.scope, section: localizedSection });
      }
    }
    return results;
  }, [trimmedQuery, t]);

  const openSearchResult = useCallback((result: SearchResult) => {
    startTransition(() => onSelectTab(result.tab));
    setHighlightId(result.kind === "setting" ? result.id : null);
    setSearchQuery("");
  }, [onSelectTab]);

  const handleSelectTab = useCallback((tab: SettingsTab) => {
    startTransition(() => onSelectTab(tab));
  }, [onSelectTab]);

  const contentStyle = useMemo(() => ({
    flex: 1 as const,
    minHeight: 0,
    display: "flex" as const,
    flexDirection: "column" as const,
    overflowY: "auto" as const,
    background: "var(--bg)" as const,
    opacity: isPending ? 0.92 : 1,
    transition: isPending ? "opacity 80ms ease-out" : "opacity 120ms ease-out",
  }), [isPending]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent ariaLabel={t("settingsConfig.title")} style={{ width: isMobile ? "calc(100vw - 16px)" : 940, maxWidth: "calc(100vw - 16px)", height: isMobile ? "calc(100dvh - 16px)" : "82vh", maxHeight: "calc(100dvh - 16px)", padding: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "12px 18px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <DialogTitle style={{ fontSize: 16, margin: 0, fontWeight: 600 }}>{t("settingsConfig.title")}</DialogTitle>
            {nativeSavesInFlight > 0 ? (
              <span style={{ fontSize: 11, color: "var(--accent)", padding: "2px 8px", borderRadius: 10, background: "var(--bg-subtle)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <RefreshCw size={11} className="spin" aria-hidden="true" /> {t("settingsConfig.saving")}
              </span>
            ) : (
              <span style={{ fontSize: 11, color: "var(--text-dim)", padding: "2px 8px", borderRadius: 10, background: "var(--bg-subtle)" }}>
                {t("settingsConfig.autoSaved")}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, maxWidth: 360, justifyContent: "flex-end" }}>
            <div style={{ position: "relative", width: "100%", maxWidth: 260 }}>
              <Search size={13} aria-hidden="true" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
              <input
                type="text"
                aria-label={t("settingsConfig.searchPlaceholder")}
                placeholder={t("settingsConfig.searchPlaceholder")}
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
            <button type="button" onClick={onClose} aria-label={t("settingsConfig.closeSettings")} title={t("settingsConfig.closeSettings")} className="ui-focus-ring" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "4px 8px", minWidth: 28, minHeight: 28, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--radius-control)" }}>×</button>
          </div>
        </header>

        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>
          {searchActive ? (
            <SearchResultsList results={searchResults} query={searchQuery.trim()} onSelect={openSearchResult} />
          ) : (
            <SettingsHighlightContext.Provider value={highlightId}>
              <SettingsTabs active={currentTab} onSelect={handleSelectTab} workspaceReady={workspaceReady} layout={isMobile ? "horizontal" : "vertical"} />

              <div style={contentStyle}>
            {nativeSettingsError && (
              <div role="alert" style={{ margin: 16, padding: "10px 14px", borderRadius: "var(--radius-card)", background: "var(--bg-panel)", border: "1px solid var(--status-error)", color: "var(--status-error)", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <AlertCircle size={14} aria-hidden="true" /> {nativeSettingsError}
              </div>
            )}

            {/* GENERAL & UI TAB */}
            {currentTab === "general" && (
              <div role="tabpanel" id="settings-panel-general" aria-labelledby="settings-tab-general" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{t("settingsConfig.interfaceBehavior")}</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>{t("settingsConfig.interfaceBehaviorDesc")}</p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <NativeSetting searchId="keep-tool-calls-collapsed" label={t("settingsConfig.keepToolCallsCollapsed")} description={t("settingsConfig.keepToolCallsCollapsedDesc")} scope="UI">
                    <ToggleSwitch checked={toolCallsDefaultCollapsed} onChange={onToolCallsDefaultCollapsedChange} />
                  </NativeSetting>
                  <NativeSetting searchId="thinking-display-mode" label={t("settingsConfig.thinkingDisplayMode")} description={t("settingsConfig.thinkingDisplayModeDesc")} scope="UI">
                    <select
                      style={nativeSelectStyle}
                      value={thinkingDisplayMode}
                      onChange={(event) => {
                        onThinkingDisplayModeChange?.(event.target.value as "auto" | "collapsed" | "expanded");
                      }}
                    >
                      <option value="auto" style={nativeOptionStyle}>{t("settingsConfig.thinkingModeAuto")}</option>
                      <option value="collapsed" style={nativeOptionStyle}>{t("settingsConfig.thinkingModeCollapsed")}</option>
                      <option value="expanded" style={nativeOptionStyle}>{t("settingsConfig.thinkingModeExpanded")}</option>
                    </select>
                  </NativeSetting>
                  <NativeSetting searchId="completion-sound" label={t("settingsConfig.completionSound")} description={t("settingsConfig.completionSoundDesc")} scope="UI">
                    <ToggleSwitch
                      checked={soundEnabled}
                      onChange={(next) => {
                        setSoundEnabled(next);
                        try { localStorage.setItem("omp-sound-enabled", String(next)); } catch { /* storage fallback */ }
                        window.dispatchEvent(new CustomEvent("omp-sound-pref-change", { detail: next }));
                      }}
                    />
                  </NativeSetting>
                  <NativeSetting searchId="message-during-active-run" label={t("settingsConfig.messageDuringActiveRun")} description={t("settingsConfig.messageDuringActiveRunDesc")} scope="UI">
                    <select
                      style={nativeSelectStyle}
                      value={submitBehavior}
                      onChange={(event) => {
                        const next = event.target.value as SubmitDuringRunBehavior;
                        setSubmitDuringRunBehavior(next);
                        setSubmitBehavior(next);
                      }}
                    >
                      <option value="steer" style={nativeOptionStyle}>{t("settingsConfig.steerCurrentRun")}</option>
                      <option value="queue" style={nativeOptionStyle}>{t("settingsConfig.queueFollowUp")}</option>
                    </select>
                  </NativeSetting>
                </div>

                <div style={{ marginTop: 12, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
                  <h4 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px", color: "var(--text)" }}>动画与动效 (Animations & Motion)</h4>
                  <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--text-muted)" }}>管理全站交互动效、边框流光与跳动动画开关</p>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    <NativeSetting searchId="global-animations" label="全局动效总开关" description="开启或关闭全站所有动态效果与过渡动画" scope="UI">
                      <ToggleSwitch checked={motionPrefs.enabled} onChange={(next) => setMotionPrefs({ enabled: next })} />
                    </NativeSetting>

                    <NativeSetting searchId="chat-border-beam" label="对话框边框流光" description="对话响应中沿输入框边缘顺时针流淌" scope="UI">
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {motionPrefs.enabled && motionPrefs.chatBorderBeam && (
                          <select
                            style={nativeSelectStyle}
                            value={motionPrefs.beamSpeed}
                            onChange={(e) => setMotionPrefs({ beamSpeed: Number(e.target.value) })}
                          >
                            <option value={8} style={nativeOptionStyle}>极慢 (8.0s)</option>
                            <option value={5.5} style={nativeOptionStyle}>慢速 (5.5s)</option>
                            <option value={3.8} style={nativeOptionStyle}>标准 (3.8s)</option>
                            <option value={2.2} style={nativeOptionStyle}>快速 (2.2s)</option>
                          </select>
                        )}
                        <ToggleSwitch
                          checked={motionPrefs.enabled && motionPrefs.chatBorderBeam}
                          disabled={!motionPrefs.enabled}
                          onChange={(next) => setMotionPrefs({ chatBorderBeam: next })}
                        />
                      </div>
                    </NativeSetting>

                    <NativeSetting searchId="omp-bouncing-letters" label="OMP 字符跳动动效" description="等待响应时 o·m·p 字母独立循环跳动" scope="UI">
                      <ToggleSwitch
                        checked={motionPrefs.enabled && motionPrefs.ompBouncing}
                        disabled={!motionPrefs.enabled}
                        onChange={(next) => setMotionPrefs({ ompBouncing: next })}
                      />
                    </NativeSetting>

                    <NativeSetting searchId="thinking-pulse" label="思考脑波呼吸动效" description="模型深度思考状态图标脉冲" scope="UI">
                      <ToggleSwitch
                        checked={motionPrefs.enabled && motionPrefs.thinkingPulse}
                        disabled={!motionPrefs.enabled}
                        onChange={(next) => setMotionPrefs({ thinkingPulse: next })}
                      />
                    </NativeSetting>
                  </div>
                </div>

                <NetworkProxyConfig />

                <SplashAnimationSetting />

                <div style={{ marginTop: 12, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
                  <h4 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px", color: "var(--text)" }}>{t("settingsConfig.updateNotice")}</h4>
                  <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--text-muted)" }}>{t("settingsConfig.updateNoticeDesc")}</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 520 }}>
                    <NativeSetting searchId="update-notice-enabled" label={t("settingsConfig.updateNoticeToggle")} description={t("settingsConfig.updateNoticeToggleDesc")} scope="UI">
                      <ToggleSwitch checked={noticeEnabled} onChange={(next) => { setNoticeEnabled(next); setUpdateNoticeEnabled(next); }} />
                    </NativeSetting>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: "var(--font-mono)", marginBottom: 6 }}>
                        {t("settingsConfig.updateHistory")}
                      </div>
                      {noticeHistory.length === 0 ? (
                        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("settingsConfig.updateHistoryEmpty")}</div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {noticeHistory.map((r) => (
                            <button
                              key={r.version}
                              type="button"
                              onClick={() => setHistoryVersion(r.version)}
                              title={t("settingsConfig.updateHistoryView")}
                              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontFamily: "var(--font-mono)", padding: "3px 6px", borderRadius: 6, background: "transparent", border: "none", color: "var(--text)", cursor: "pointer", textAlign: "left" }}
                            >
                              <span style={{ fontWeight: 600, color: "var(--accent)" }}>v{r.version}</span>
                              <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{new Date(r.seenAt).toLocaleString()}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {noticeHistory.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setNoticeHistory(clearUpdateHistory())}
                          style={{ marginTop: 8, padding: "4px 10px", borderRadius: "var(--radius-control)", background: "transparent", border: "1px solid var(--border)", color: "var(--status-error)", fontSize: 11, cursor: "pointer" }}
                        >
                          {t("settingsConfig.updateHistoryClear")}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            )}

            {/* SAFETY & APPROVALS TAB */}
            {currentTab === "safety" && (
              <div role="tabpanel" id="settings-panel-safety" aria-labelledby="settings-tab-safety" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{t("settingsConfig.toolSafetyApprovals")}</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>{t("settingsConfig.toolSafetyApprovalsDesc")}</p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <NativeSetting searchId="approval-mode" label={t("settingsConfig.approvalMode")} description={t("settingsConfig.approvalModeDesc")} scope="Native OMP">
                    <select
                      style={nativeSelectStyle}
                      value={nativeSettings?.tools?.approvalMode ?? "yolo"}
                      onChange={(event) => patchSection("tools", { approvalMode: event.target.value as "always-ask" | "write" | "yolo" })}
                    >
                      <option value="always-ask" style={nativeOptionStyle}>{t("settingsConfig.alwaysAsk")}</option>
                      <option value="write" style={nativeOptionStyle}>{t("settingsConfig.allowWrites")}</option>
                      <option value="yolo" style={nativeOptionStyle}>{t("settingsConfig.autoApproveYolo")}</option>
                    </select>
                  </NativeSetting>
                  <NativeSetting searchId="bash-override" label={t("settingsConfig.bashOverride")} description={t("settingsConfig.bashOverrideDesc")} scope="Native OMP">
                    <select
                      style={nativeSelectStyle}
                      value={nativeSettings?.tools?.approval?.bash ?? "prompt"}
                      onChange={(event) => patchApproval({ bash: event.target.value as "allow" | "prompt" | "deny" })}
                    >
                      <option value="allow" style={nativeOptionStyle}>{t("settingsConfig.allow")}</option>
                      <option value="prompt" style={nativeOptionStyle}>{t("settingsConfig.alwaysAsk")}</option>
                      <option value="deny" style={nativeOptionStyle}>{t("settingsConfig.deny")}</option>
                    </select>
                  </NativeSetting>
                  <NativeSetting searchId="extension-tool-requests" label={t("settingsConfig.extensionToolRequests")} description={t("settingsConfig.extensionToolRequestsDesc")} scope="Native OMP">
                    <select
                      style={nativeSelectStyle}
                      value={nativeSettings?.tools?.approval?.extension ?? "prompt"}
                      onChange={(event) => patchApproval({ extension: event.target.value as "allow" | "prompt" })}
                    >
                      <option value="prompt" style={nativeOptionStyle}>{t("settingsConfig.askEveryTime")}</option>
                      <option value="allow" style={nativeOptionStyle}>{t("settingsConfig.autoApprove")}</option>
                    </select>
                  </NativeSetting>
                </div>
              </div>
            )}

            {/* AI MODEL DEFAULTS TAB */}
            {currentTab === "models" && (
              <div role="tabpanel" id="settings-panel-models" aria-labelledby="settings-tab-models" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{t("settingsConfig.modelDefaults")}</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>{t("settingsConfig.modelDefaultsDesc")}</p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                  <NativeSetting searchId="reasoning" label={t("settingsConfig.reasoning")} description={t("settingsConfig.reasoningDesc")} scope="Native OMP">
                    <select
                      style={nativeSelectStyle}
                      value={nativeSettings?.defaultThinkingLevel ?? "high"}
                      onChange={(e) => patchSettings({ defaultThinkingLevel: e.target.value as NativeSettings["defaultThinkingLevel"] })}
                    >
                      {["auto", "minimal", "low", "medium", "high", "xhigh", "max"].map((l) => (
                        <option key={l} value={l} style={nativeOptionStyle}>{l}</option>
                      ))}
                    </select>
                  </NativeSetting>
                  <NativeSetting searchId="verbosity" label={t("settingsConfig.verbosity")} description={t("settingsConfig.verbosityDesc")} scope="Native OMP">
                    <select
                      style={nativeSelectStyle}
                      value={nativeSettings?.textVerbosity ?? "medium"}
                      onChange={(e) => patchSettings({ textVerbosity: e.target.value as NativeSettings["textVerbosity"] })}
                    >
                      <option value="low" style={nativeOptionStyle}>{t("settingsConfig.verbosityLow")}</option>
                      <option value="medium" style={nativeOptionStyle}>{t("settingsConfig.verbosityMedium")}</option>
                      <option value="high" style={nativeOptionStyle}>{t("settingsConfig.verbosityHigh")}</option>
                    </select>
                  </NativeSetting>
                  <NativeSetting searchId="personality" label={t("settingsConfig.personality")} description={t("settingsConfig.personalityDesc")} scope="Native OMP">
                    <select
                      style={nativeSelectStyle}
                      value={nativeSettings?.personality ?? "default"}
                      onChange={(e) => patchSettings({ personality: e.target.value as NativeSettings["personality"] })}
                    >
                      <option value="default" style={nativeOptionStyle}>{t("settingsConfig.personalityDefault")}</option>
                      <option value="friendly" style={nativeOptionStyle}>{t("settingsConfig.personalityFriendly")}</option>
                      <option value="pragmatic" style={nativeOptionStyle}>{t("settingsConfig.personalityPragmatic")}</option>
                      <option value="none" style={nativeOptionStyle}>{t("settingsConfig.personalityNone")}</option>
                    </select>
                  </NativeSetting>
                  <NativeSetting searchId="thinking-blocks" label={t("settingsConfig.thinkingBlocks")} description={t("settingsConfig.thinkingBlocksDesc")} scope="Native OMP">
                    <ToggleSwitch
                      checked={nativeSettings?.hideThinkingBlock ?? false}
                      onChange={(checked) => patchSettings({ hideThinkingBlock: checked })}
                    />
                  </NativeSetting>
                  <NativeSetting searchId="external-thinking" label={t("settingsConfig.externalThinking")} description={t("settingsConfig.externalThinkingDesc")} scope="Native OMP">
                    <ToggleSwitch
                      checked={nativeSettings?.externalThinking ?? false}
                      onChange={(checked) => patchSettings({ externalThinking: checked })}
                    />
                  </NativeSetting>
                </div>
              </div>
            )}

            {/* API KEYS & PROVIDERS TAB */}
            {currentTab === "providers" && (
              <div role="tabpanel" id="settings-panel-providers" aria-labelledby="settings-tab-providers" style={{ display: currentTab === "providers" ? "flex" : "none", height: "100%", minHeight: 0, flexDirection: "column" }}>
                <ModelsConfig embedded onClose={onClose} onSaved={onModelsSaved} />
              </div>
            )}

            {/* AGENT INTELLIGENCE TAB */}
            {currentTab === "intelligence" && (
              <div role="tabpanel" id="settings-panel-intelligence" aria-labelledby="settings-tab-intelligence" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
                {/* Context Compaction Section */}
                <section style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t("settingsConfig.contextCompaction")}</div>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>{t("settingsConfig.contextCompactionDesc")}</p>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    <NativeSetting searchId="automatic-compaction" label={t("settingsConfig.automaticCompaction")} description={t("settingsConfig.automaticCompactionDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.compaction?.enabled ?? true}
                        onChange={(checked) => patchSection("compaction", { enabled: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting searchId="continue-after-compaction" label={t("settingsConfig.continueAfterCompaction")} description={t("settingsConfig.continueAfterCompactionDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.compaction?.autoContinue ?? true}
                        onChange={(checked) => patchSection("compaction", { autoContinue: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting searchId="maintenance-strategy" label={t("settingsConfig.maintenanceStrategy")} description={t("settingsConfig.maintenanceStrategyDesc")} scope="Native OMP">
                      <select
                        style={nativeSelectStyle}
                        value={nativeSettings?.compaction?.strategy ?? "snapcompact"}
                        onChange={(e) => patchSection("compaction", { strategy: e.target.value as NonNullable<NativeSettings["compaction"]>["strategy"] })}
                      >
                        <option value="snapcompact" style={nativeOptionStyle}>{t("settingsConfig.strategySnapcompact")}</option>
                        <option value="handoff" style={nativeOptionStyle}>{t("settingsConfig.strategyHandoff")}</option>
                        <option value="context-full" style={nativeOptionStyle}>{t("settingsConfig.strategyContextFull")}</option>
                        <option value="shake" style={nativeOptionStyle}>{t("settingsConfig.strategyShake")}</option>
                        <option value="off" style={nativeOptionStyle}>{t("settingsConfig.strategyOff")}</option>
                      </select>
                    </NativeSetting>
                    <NativeSetting searchId="compact-mid-turn" label={t("settingsConfig.compactMidTurn")} description={t("settingsConfig.compactMidTurnDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.compaction?.midTurnEnabled ?? true}
                        onChange={(checked) => patchSection("compaction", { midTurnEnabled: checked })}
                      />
                    </NativeSetting>
                  </div>
                </section>

                {/* Memory & Auto-Learn Section */}
                <section style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t("settingsConfig.memoryAutoLearn")}</div>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>{t("settingsConfig.memoryAutoLearnDesc")}</p>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    <NativeSetting searchId="memory-backend" label={t("settingsConfig.memoryBackend")} description={t("settingsConfig.memoryBackendDesc")} scope="Native OMP">
                      <select
                        style={nativeSelectStyle}
                        value={nativeSettings?.memory?.backend ?? "mnemopi"}
                        onChange={(e) => patchSection("memory", { backend: e.target.value as NonNullable<NativeSettings["memory"]>["backend"] })}
                      >
                        <option value="off" style={nativeOptionStyle}>{t("settingsConfig.memoryBackendOff")}</option>
                        <option value="local" style={nativeOptionStyle}>{t("settingsConfig.memoryBackendLocal")}</option>
                        <option value="mnemopi" style={nativeOptionStyle}>{t("settingsConfig.memoryBackendMnemopi")}</option>
                        <option value="hindsight" style={nativeOptionStyle}>{t("settingsConfig.memoryBackendHindsight")}</option>
                      </select>
                    </NativeSetting>
                    <NativeSetting searchId="enable-auto-learn" label={t("settingsConfig.enableAutoLearn")} description={t("settingsConfig.enableAutoLearnDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.autolearn?.enabled ?? true}
                        onChange={(checked) => patchSection("autolearn", { enabled: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting searchId="private-capture-turn" label={t("settingsConfig.privateCaptureTurn")} description={t("settingsConfig.privateCaptureTurnDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.autolearn?.autoContinue ?? true}
                        onChange={(checked) => patchSection("autolearn", { autoContinue: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting searchId="memory-scope" label={t("settingsConfig.memoryScope")} description={t("settingsConfig.memoryScopeDesc")} scope="Native OMP">
                      <select
                        style={nativeSelectStyle}
                        value={nativeSettings?.mnemopi?.scoping ?? "per-project"}
                        onChange={(e) => patchSection("mnemopi", { scoping: e.target.value as NonNullable<NativeSettings["mnemopi"]>["scoping"] })}
                      >
                        <option value="per-project" style={nativeOptionStyle}>{t("settingsConfig.memoryScopePerProject")}</option>
                        <option value="per-project-tagged" style={nativeOptionStyle}>{t("settingsConfig.memoryScopePerProjectTagged")}</option>
                        <option value="global" style={nativeOptionStyle}>{t("settingsConfig.memoryScopeGlobal")}</option>
                      </select>
                    </NativeSetting>
                    <NativeSetting searchId="recall-on-session-start" label={t("settingsConfig.recallOnSessionStart")} description={t("settingsConfig.recallOnSessionStartDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.mnemopi?.autoRecall ?? true}
                        onChange={(checked) => patchSection("mnemopi", { autoRecall: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting searchId="retain-completed-turns" label={t("settingsConfig.retainCompletedTurns")} description={t("settingsConfig.retainCompletedTurnsDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.mnemopi?.autoRetain ?? true}
                        onChange={(checked) => patchSection("mnemopi", { autoRetain: checked })}
                      />
                    </NativeSetting>
                  </div>
                </section>

                {/* Retry Section */}
                <section style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t("settingsConfig.automaticRetry")}</div>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>{t("settingsConfig.automaticRetryDesc")}</p>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    <NativeSetting searchId="automatic-retry" label={t("settingsConfig.retryToggle")} description={t("settingsConfig.retryToggleDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.retry?.enabled ?? true}
                        onChange={(checked) => patchSection("retry", { enabled: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting searchId="max-attempts" label={t("settingsConfig.maxAttempts")} description={t("settingsConfig.maxAttemptsDesc")} scope="Native OMP">
                      <select
                        style={nativeSelectStyle}
                        value={String(nativeSettings?.retry?.maxRetries ?? 2)}
                        onChange={(e) => patchSection("retry", { maxRetries: Number(e.target.value) })}
                      >
                        {[0, 1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n} style={nativeOptionStyle}>{n}</option>
                        ))}
                      </select>
                    </NativeSetting>
                    <NativeSetting searchId="model-fallback" label={t("settingsConfig.modelFallback")} description={t("settingsConfig.modelFallbackDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.retry?.modelFallback ?? false}
                        onChange={(checked) => patchSection("retry", { modelFallback: checked })}
                      />
                    </NativeSetting>
                  </div>
                </section>

                {/* OMP internal settings: model roles, feature toggles, advanced */}
                {nativeSettings && (
                  <NativeExtrasSetting
                    settings={nativeSettings}
                    onPatch={(patch) => patchSettings(patch)}
                    onPatchSection={(key, patch) => patchSection(key as never, patch as never)}
                  />
                )}
              </div>
            )}

            {/* EXTENSIONS & TOOLS TAB (MCP, SKILLS, PLUGINS) */}
            {currentTab === "mcp" && (
              <div role="tabpanel" id="settings-panel-mcp" aria-labelledby="settings-tab-mcp" style={{ display: currentTab === "mcp" ? "flex" : "none", height: "100%", minHeight: 0, flexDirection: "column", overflowY: "auto", padding: 20, gap: 16 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{t("settingsConfig.extensionsTools")}</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>{t("settingsConfig.extensionsToolsDesc")}</p>
                </div>
                {cwd && (
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                    <NativeSetting searchId="load-project-mcp-servers" label={t("settingsConfig.loadProjectMcp")} description={t("settingsConfig.loadProjectMcpDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.mcp?.enableProjectConfig ?? true}
                        onChange={(checked) => patchSection("mcp", { enableProjectConfig: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting searchId="render-mcp-markdown" label={t("settingsConfig.renderMcpMarkdown")} description={t("settingsConfig.renderMcpMarkdownDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.mcp?.renderMarkdownResults ?? true}
                        onChange={(checked) => patchSection("mcp", { renderMarkdownResults: checked })}
                      />
                    </NativeSetting>
                    <NativeSetting searchId="mcp-resource-updates" label={t("settingsConfig.mcpResourceUpdates")} description={t("settingsConfig.mcpResourceUpdatesDesc")} scope="Native OMP">
                      <ToggleSwitch
                        checked={nativeSettings?.mcp?.notifications ?? false}
                        onChange={(checked) => patchSection("mcp", { notifications: checked })}
                      />
                    </NativeSetting>
                  </div>
                )}
                <McpConfig cwd={cwd} sessionId={sessionId} />
                {!cwd && <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>{t("settingsConfig.selectWorkspaceForMcp")}</p>}
              </div>
            )}

            {/* SKILLS SUB-PANEL CONTRACT MATCH */}
            {cwd && currentTab === "skills" && (
              <div role="tabpanel" id="settings-panel-skills" aria-labelledby="settings-tab-skills" style={{ display: currentTab === "skills" ? "flex" : "none", height: "100%", minHeight: 0, flexDirection: "column" }}>
                <SkillsConfig embedded cwd={cwd} onClose={onClose} />
              </div>
            )}

            {/* PLUGINS SUB-PANEL CONTRACT MATCH */}
            {cwd && currentTab === "plugins" && (
              <div role="tabpanel" id="settings-panel-plugins" aria-labelledby="settings-tab-plugins" style={{ display: currentTab === "plugins" ? "flex" : "none", height: "100%", minHeight: 0, flexDirection: "column" }}>
                <PluginsConfig embedded cwd={cwd} sessionId={sessionId} onClose={onClose} onReloaded={onPluginsReloaded} />
              </div>
            )}

            {/* AGENTS TAB */}
            {currentTab === "agents" && (
              <div
                role="tabpanel"
                id="settings-panel-agents"
                aria-labelledby="settings-tab-agents"
                style={{
                  display: currentTab === "agents" ? "flex" : "none",
                  height: "100%",
                  minHeight: 0,
                  flexDirection: "column",
                  overflowY: "auto",
                  padding: 20,
                  gap: 16,
                  ...(highlightId && ["agent-roster", "agent-model", "agent-tools"].includes(highlightId)
                    ? { border: "1px solid var(--accent)", boxShadow: "0 0 0 2px var(--accent)" }
                    : {}),
                }}
              >
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{t("settingsConfig.agentsTitle")}</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                    {t("settingsConfig.agentsDesc")}
                  </p>
                </div>
                <AgentsConfig cwd={cwd} />
              </div>
            )}

            {/* SYSTEM & UPDATES TAB */}
            {currentTab === "system" && (
              <div role="tabpanel" id="settings-panel-system" aria-labelledby="settings-tab-system" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{t("settingsConfig.systemUpdates")}</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>{t("settingsConfig.systemUpdatesDescription")}</p>
                </div>

                {/* ompweb app update card */}
                <section style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{t("settingsConfig.appLabel")}</div>
                      <div style={{ marginTop: 4, color: appUpdate?.updateAvailable ? "var(--accent)" : "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                        {checkingAppUpdate ? t("settingsConfig.checkingUpdates") : appUpdate?.updateAvailable ? t("appShell.updateVersion", { current: appUpdate.currentVersion ?? "?", available: appUpdate.availableVersion ?? "?" }) : appUpdate?.checkError ? t("settingsConfig.updateCheckFailed", { version: appUpdate.currentVersion ?? "?" }) : appUpdate?.currentVersion ? t("settingsConfig.upToDate", { version: appUpdate.currentVersion }) : t("settingsConfig.versionUnavailable")}
                      </div>
                    </div>
                    <button type="button" onClick={() => void checkForAppUpdate(true)} disabled={checkingAppUpdate} aria-label={t("settingsConfig.checkAppUpdates")} style={{ padding: "6px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "transparent", color: "var(--text)", cursor: checkingAppUpdate ? "wait" : "pointer", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <RefreshCw size={13} aria-hidden="true" /> {t("settingsConfig.refresh")}
                    </button>
                  </div>
                  {appUpdate?.updateAvailable && (
                    <div style={{ marginTop: 6, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg)", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("settingsConfig.runAppUpdateCommand")}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <code style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)", wordBreak: "break-all" }}>{appUpdate.updateCommand || "npm install -g @37chengshan/ompweb"}</code>
                        {(window as { ompWebDesktop?: { isDesktop?: boolean; updateApply?: () => Promise<unknown> } }).ompWebDesktop?.isDesktop ? (
                          desktopUpdateState.status === "downloaded" ? (
                            <button
                              type="button"
                              onClick={() => void (window as { ompWebDesktop?: { updateApply?: () => Promise<unknown> } }).ompWebDesktop?.updateApply?.()}
                              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", border: "1px solid var(--accent)", borderRadius: "var(--radius-control)", background: "var(--accent)", color: "var(--bg)", cursor: "pointer", fontSize: 11, fontWeight: 600, flexShrink: 0 }}
                            >
                              <RotateCcw size={12} aria-hidden="true" /> {t("settingsConfig.restartToApply")}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void runAppUpdate()}
                              disabled={updatingApp}
                              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", border: "1px solid var(--accent)", borderRadius: "var(--radius-control)", background: "var(--accent)", color: "var(--bg)", cursor: updatingApp ? "wait" : "pointer", fontSize: 11, fontWeight: 600, flexShrink: 0 }}
                            >
                              <RefreshCw size={12} aria-hidden="true" className={updatingApp ? "spin" : undefined} /> {updatingApp ? t("settingsConfig.updating") : desktopUpdateState.status === "downloading" ? `${t("settingsConfig.downloading")} ${desktopUpdateState.percent ?? 0}%` : t("settingsConfig.updateNow")}
                            </button>
                          )
                        ) : (
                          <button
                            type="button"
                            onClick={() => void runAppUpdate()}
                            disabled={updatingApp}
                            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", border: "1px solid var(--accent)", borderRadius: "var(--radius-control)", background: "var(--accent)", color: "var(--bg)", cursor: updatingApp ? "wait" : "pointer", fontSize: 11, fontWeight: 600, flexShrink: 0 }}
                          >
                            <RefreshCw size={12} aria-hidden="true" className={updatingApp ? "spin" : undefined} /> {updatingApp ? t("settingsConfig.updating") : t("settingsConfig.updateNow")}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            void copyText(appUpdate.updateCommand || "npm install -g @37chengshan/ompweb")
                              .then(() => setMessage(t("appShell.commandCopied")))
                              .catch(() => setMessage(t("appShell.commandCopyFailed")));
                          }}
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", cursor: "pointer", fontSize: 11 }}
                        >
                          <Copy size={12} aria-hidden="true" /> {t("appShell.copyCommand")}
                        </button>
                      </div>
                      {appUpdateOutput && (
                        <pre style={{ margin: 0, padding: "6px 8px", background: "var(--bg-subtle)", borderRadius: 6, fontSize: 11, color: "var(--text-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 140, overflow: "auto", fontFamily: "var(--font-mono)" }}>{appUpdateOutput}</pre>
                      )}
                      {appUpdated && (
                        <div style={{ fontSize: 12, color: "var(--status-ok, #2e9e5b)" }} role="status">{t("settingsConfig.appUpdateComplete")}</div>
                      )}
                    </div>
                  )}
                </section>

                {/* OMP runtime update card */}
                <section style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{t("settingsConfig.ompLabel")}</div>
                      <div style={{ marginTop: 4, color: update?.updateAvailable ? "var(--accent)" : "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                        {checking ? t("settingsConfig.checkingUpdates") : update?.updateAvailable ? t("appShell.updateVersion", { current: update.currentVersion ?? "?", available: update.availableVersion ?? "?" }) : update?.currentVersion ? t("settingsConfig.upToDate", { version: update.currentVersion }) : t("settingsConfig.versionUnavailable")}
                      </div>
                    </div>
                    <button type="button" onClick={() => void checkForUpdate()} disabled={checking} aria-label={t("settingsConfig.checkOmpUpdates")} style={{ padding: "6px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "transparent", color: "var(--text)", cursor: checking ? "wait" : "pointer", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <RefreshCw size={13} aria-hidden="true" /> {t("settingsConfig.refresh")}
                    </button>
                  </div>
                  {update?.updateAvailable && (
                    <div style={{ marginTop: 6, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg)", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("settingsConfig.runOmpUpdateCommand")}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <code style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)", wordBreak: "break-all" }}>{update.updateCommand || "omp update"}</code>
                        <button
                          type="button"
                          onClick={() => {
                            void copyText(update.updateCommand || "omp update")
                              .then(() => setMessage(t("appShell.commandCopied")))
                              .catch(() => setMessage(t("appShell.commandCopyFailed")));
                          }}
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", cursor: "pointer", fontSize: 11 }}
                        >
                          <Copy size={12} aria-hidden="true" /> {t("appShell.copyCommand")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void runOmpUpdate()}
                          disabled={updatingOmp}
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", border: "1px solid var(--accent)", borderRadius: "var(--radius-control)", background: "var(--accent)", color: "var(--bg)", cursor: updatingOmp ? "wait" : "pointer", fontSize: 11, fontWeight: 600 }}
                        >
                          <RefreshCw size={12} aria-hidden="true" className={updatingOmp ? "spin" : undefined} /> {updatingOmp ? t("settingsConfig.updating") : t("settingsConfig.updateNow")}
                        </button>
                      </div>
                      {ompUpdateOutput && (
                        <pre style={{ margin: 0, padding: "6px 8px", background: "var(--bg-subtle)", borderRadius: 6, fontSize: 11, color: "var(--text-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 140, overflow: "auto", fontFamily: "var(--font-mono)" }}>{ompUpdateOutput}</pre>
                      )}
                      {ompUpdated && (
                        <div style={{ fontSize: 12, color: "var(--status-ok, #2e9e5b)" }} role="status">{t("settingsConfig.ompUpdateComplete")}</div>
                      )}
                    </div>
                  )}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                    <button
                      type="button"
                      onClick={() => void restartSessions()}
                      disabled={restarting}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", cursor: restarting ? "wait" : "pointer", fontSize: 12 }}
                    >
                      <RotateCcw size={13} aria-hidden="true" /> {restarting ? t("settingsConfig.restarting") : t("settingsConfig.restartSessions")}
                    </button>
                    <a
                      href="https://github.com/can1357/oh-my-pi/releases"
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", color: "var(--text-muted)", textDecoration: "none", fontSize: 12 }}
                    >
                      <ExternalLink size={13} aria-hidden="true" /> {t("settingsConfig.changelog")}
                    </a>
                  </div>
                  {message && <p role="status" style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>{message}</p>}
                </section>
              </div>
            )}

            {/* REMOTE ACCESS TAB */}
            {currentTab === "remote" && (
              <div role="tabpanel" id="settings-panel-remote" aria-labelledby="settings-tab-remote" style={{ display: currentTab === "remote" ? "flex" : "none", height: "100%", minHeight: 0, flexDirection: "column", overflowY: "auto", padding: 20, gap: 16 }}>
                <RemoteAccessSetting />
              </div>
            )}
              </div>
            </SettingsHighlightContext.Provider>
          )}
        </div>
      {historyVersion && (
        <UpdateNoticeDialog version={historyVersion} onClose={() => setHistoryVersion(null)} />
      )}
      </DialogContent>
    </Dialog>
  );
}

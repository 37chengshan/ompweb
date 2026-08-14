"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getSubmitDuringRunBehavior, setSubmitDuringRunBehavior, type SubmitDuringRunBehavior } from "@/lib/composer-prefs";
import dynamic from "next/dynamic";
import { Copy, ExternalLink, RefreshCw, RotateCcw, Sparkles } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/primitives";
import { SettingsTabs, type SettingsTab } from "./SettingsTabs";

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
  minHeight: 30,
  padding: "4px 26px 4px 9px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-control)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 12,
  cursor: "pointer",
} as const;

function NativeSetting({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <div style={{ minWidth: 0, padding: "11px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--bg-panel)" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{label}</div>
      <div style={{ minHeight: 30, marginTop: 7, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ color: "var(--text-muted)", fontSize: 11, lineHeight: 1.4 }}>{description}</span>
        <span style={{ flexShrink: 0 }}>{children}</span>
      </div>
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
    setVisitedTabs((tabs) => tabs.has(activeTab) ? tabs : new Set([...tabs, activeTab]));
  }, [activeTab]);

  useEffect(() => {
    fetch("/api/omp-settings")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((data: { settings?: NativeSettings }) => setNativeSettings(data.settings ?? {}))
      .catch((error) => setNativeSettingsError(error instanceof Error ? error.message : String(error)));
  }, []);

  // Full-snapshot saves must be serialized against each other: each call
  // sends the whole settings object, so two overlapping PUTs can land out of
  // order and a stale snapshot can clobber a newer one server-side. We keep the
  // latest snapshot in a ref and drain a single serialized save loop, always
  // writing the most recent snapshot.
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
        // Drain: keep writing until the latest desired snapshot has been saved.
        while (latestNativeSettingsRef.current !== null) {
          const snapshot = latestNativeSettingsRef.current;
          latestNativeSettingsRef.current = null;
          try {
            const response = await fetch("/api/omp-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: snapshot }) });
            const data = await response.json() as { settings?: NativeSettings; error?: string };
            if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
            // Only reflect the server-normalized result when no newer snapshot
            // arrived while this request was in flight.
            if (latestNativeSettingsRef.current === null) setNativeSettings(data.settings ?? snapshot);
          } catch (error) {
            setNativeSettingsError(error instanceof Error ? error.message : String(error));
            // A failed save should not silently drop later pending changes; the
            // loop exits but the latest snapshot stays queued for a retry.
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
      const data = await response.json() as UpdateState & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      setUpdate(data);
      onOmpUpdateAvailabilityChange(data.updateAvailable);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }, [onOmpUpdateAvailabilityChange]);

  useEffect(() => { void checkForUpdate(); }, [checkForUpdate]);

  const checkForAppUpdate = useCallback(async (force = false) => {
    setCheckingAppUpdate(true);
    try {
      const response = await fetch(force ? "/api/app-update?force=1" : "/api/app-update");
      const data = await response.json() as UpdateState & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      setAppUpdate(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckingAppUpdate(false);
    }
  }, []);

  useEffect(() => { void checkForAppUpdate(); }, [checkForAppUpdate]);
  const restartSessions = useCallback(async () => {
    setRestarting(true);
    try {
      const response = await fetch("/api/omp-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restart" }) });
      const data = await response.json() as { error?: string; sessionsRestarted?: number };
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
      setMessage(`Restarted ${data.sessionsRestarted ?? 0} active OMP session(s).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRestarting(false);
    }
  }, []);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent ariaLabel="Settings" style={{ width: isMobile ? "calc(100vw - 16px)" : 860, maxWidth: "calc(100vw - 16px)", height: isMobile ? "calc(100dvh - 16px)" : "78vh", maxHeight: "calc(100dvh - 16px)", padding: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid var(--border)" }}>
          <DialogTitle style={{ fontSize: 16, margin: 0 }}>Settings</DialogTitle>
          <button type="button" onClick={onClose} aria-label="Close settings" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </header>
        <SettingsTabs active={activeTab} onSelect={onSelectTab} workspaceReady={workspaceReady} />
        <div role="tabpanel" id="settings-panel-general" aria-labelledby="settings-tab-general" style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <div style={{ display: activeTab === "general" ? "flex" : "none", height: "100%", overflowY: "auto", padding: 20, flexDirection: "column", gap: 20 }}>
           {nativeSavesInFlight > 0 && <div role="status" style={{ position: "sticky", top: 0, zIndex: 5, alignSelf: "flex-start", padding: "5px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-panel)", color: "var(--text-muted)", fontSize: 11 }}>Saving to OMP config…</div>}
           <section style={{ padding: "16px", border: "1px solid var(--border)", borderRadius: "var(--radius-modal)", background: "var(--bg-subtle)" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Interface</div>
            <p style={{ margin: "6px 0 10px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>Controls how ompweb presents live agent activity.</p>
            <NativeSetting label="Keep tool calls collapsed" description="Show only the compact tool-call header while tools are running."><input type="checkbox" style={{ accentColor: "var(--accent)", width: 15, height: 15, cursor: "pointer" }} checked={toolCallsDefaultCollapsed} onChange={(event) => onToolCallsDefaultCollapsedChange(event.target.checked)} /></NativeSetting>
            <NativeSetting label="Completion sound" description="Play a short sound when the agent finishes a run."><input type="checkbox" style={{ accentColor: "var(--accent)", width: 15, height: 15, cursor: "pointer" }} checked={soundEnabled} onChange={(event) => { const next = event.target.checked; setSoundEnabled(next); try { localStorage.setItem("omp-sound-enabled", String(next)); } catch { /* storage unavailable */ } window.dispatchEvent(new CustomEvent("omp-sound-pref-change", { detail: next })); }} /></NativeSetting>
            <NativeSetting label="Message during active run" description="What the composer does when you submit while the agent is working. Steer interrupts the current run; Queue follow-up delivers the message after it finishes."><select style={nativeSelectStyle} value={submitBehavior} onChange={(event) => { const next = event.target.value as SubmitDuringRunBehavior; setSubmitDuringRunBehavior(next); setSubmitBehavior(next); }}><option value="steer">Steer current run</option><option value="queue">Queue follow-up</option></select></NativeSetting>
           </section>
           <section style={{ padding: "16px", border: "1px solid var(--border)", borderRadius: "var(--radius-modal)", background: "var(--bg-subtle)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600 }}><Sparkles size={15} aria-hidden="true" /> Advisor</div>
            <p style={{ margin: "6px 0 10px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>Native OMP setting. The configured <code>advisor</code> model role passively reviews turns and injects notes.</p>
             <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 9 }}>
              <NativeSetting label="Enable Advisor" description="Enable Advisor for new sessions with the advisor role."><input type="checkbox" style={{ accentColor: "var(--accent)", width: 15, height: 15, cursor: "pointer" }} checked={nativeSettings?.advisor?.enabled ?? advisorEnabled} onChange={(event) => { const enabled = event.target.checked; onAdvisorChange(enabled); void saveNativeSettings({ ...(nativeSettings ?? {}), advisor: { ...(nativeSettings?.advisor ?? {}), enabled } }); }} /></NativeSetting>
              {(nativeSettings?.advisor?.enabled ?? advisorEnabled) && <NativeSetting label="Advisor Backlog" description="Wait briefly when the advisor is behind."><select style={nativeSelectStyle} value={nativeSettings?.advisor?.syncBacklog ?? "off"} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), advisor: { ...(nativeSettings?.advisor ?? {}), syncBacklog: event.target.value as "off" | "1" | "3" | "5" } })}><option value="off">Off</option><option value="1">1 turn</option><option value="3">3 turns</option><option value="5">5 turns</option></select></NativeSetting>}
            </div>
            {(nativeSettings?.advisor?.enabled ?? advisorEnabled) && <div style={{ marginTop: 9 }}>
              <NativeSetting label="Review Subagents" description="Apply Advisor to task and eval subagents."><input type="checkbox" style={{ accentColor: "var(--accent)", width: 15, height: 15, cursor: "pointer" }} checked={nativeSettings?.advisor?.subagents ?? false} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), advisor: { ...(nativeSettings?.advisor ?? {}), subagents: event.target.checked } })} /></NativeSetting>
            </div>}
          </section>
          <section style={{ padding: "16px", border: "1px solid var(--border)", borderRadius: "var(--radius-modal)", background: "var(--bg-subtle)" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Native Tool Safety</div>
            <p style={{ margin: "6px 0 10px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>OMP&apos;s approval policy applies before tools run. Critical Bash commands retain their native safety checks.</p>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 9 }}>
              <NativeSetting label="Approval Mode" description="Choose when OMP asks before tool calls."><select style={nativeSelectStyle} value={nativeSettings?.tools?.approvalMode ?? "yolo"} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), tools: { ...(nativeSettings?.tools ?? {}), approvalMode: event.target.value as "always-ask" | "write" | "yolo" } })}><option value="always-ask">Always ask</option><option value="write">Allow writes</option><option value="yolo">Auto approve</option></select></NativeSetting>
              <NativeSetting label="Bash Override" description="Override the default policy for Bash commands."><select style={nativeSelectStyle} value={nativeSettings?.tools?.approval?.bash ?? "prompt"} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), tools: { ...(nativeSettings?.tools ?? {}), approval: { ...(nativeSettings?.tools?.approval ?? {}), bash: event.target.value as "allow" | "prompt" | "deny" } } })}><option value="allow">Allow</option><option value="prompt">Always ask</option><option value="deny">Deny</option></select></NativeSetting>
              <NativeSetting label="Extension Tool Requests" description="Automatically approve extension requests such as “Allow tool: hub”."><select style={nativeSelectStyle} value={nativeSettings?.tools?.approval?.extension ?? "prompt"} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), tools: { ...(nativeSettings?.tools ?? {}), approval: { ...(nativeSettings?.tools?.approval ?? {}), extension: event.target.value as "allow" | "prompt" } } })}><option value="prompt">Ask every time</option><option value="allow">Auto approve</option></select></NativeSetting>
            </div>
          </section>
          <section style={{ padding: "16px", border: "1px solid var(--border)", borderRadius: "var(--radius-modal)", background: "var(--bg-subtle)" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Native Model Defaults</div>
            <p style={{ margin: "6px 0 10px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>Persisted in OMP and applied to new sessions.</p>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 9 }}>
              <NativeSetting label="Reasoning" description="Default effort for thinking-capable models."><select style={nativeSelectStyle} value={nativeSettings?.defaultThinkingLevel ?? "high"} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), defaultThinkingLevel: event.target.value as NativeSettings["defaultThinkingLevel"] })}>{["auto", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) => <option key={level} value={level}>{level}</option>)}</select></NativeSetting>
              <NativeSetting label="Verbosity" description="Response detail for supporting providers."><select style={nativeSelectStyle} value={nativeSettings?.textVerbosity ?? "medium"} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), textVerbosity: event.target.value as NativeSettings["textVerbosity"] })}>{["low", "medium", "high"].map((level) => <option key={level} value={level}>{level}</option>)}</select></NativeSetting>
              <NativeSetting label="Personality" description="Style included in OMP's system prompt."><select style={nativeSelectStyle} value={nativeSettings?.personality ?? "default"} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), personality: event.target.value as NativeSettings["personality"] })}>{["default", "friendly", "pragmatic", "none"].map((value) => <option key={value} value={value}>{value}</option>)}</select></NativeSetting>
              <NativeSetting label="Thinking Blocks" description="Hide model reasoning from agent responses."><input type="checkbox" style={{ accentColor: "var(--accent)", width: 15, height: 15, cursor: "pointer" }} checked={nativeSettings?.hideThinkingBlock ?? false} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), hideThinkingBlock: event.target.checked })} /></NativeSetting>
              <NativeSetting label="External Thinking" description="Private scratchpad reasoning via the think tool (disables GPT/Claude/Gemini native reasoning)."><input type="checkbox" style={{ accentColor: "var(--accent)", width: 15, height: 15, cursor: "pointer" }} checked={nativeSettings?.externalThinking ?? false} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), externalThinking: event.target.checked })} /></NativeSetting>
             </div>
           </section>
           <section style={{ padding: "16px", border: "1px solid var(--border)", borderRadius: "var(--radius-modal)", background: "var(--bg-subtle)" }}>
             <div style={{ fontSize: 13, fontWeight: 600 }}>Context Management</div>
             <p style={{ margin: "6px 0 10px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>OMP manages oversized context itself. These controls apply to new and restarted sessions.</p>
             <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 9 }}>
               <NativeSetting label="Automatic Compaction" description="Compact context before it exceeds the model limit."><input type="checkbox" style={{ accentColor: "var(--accent)", width: 15, height: 15, cursor: "pointer" }} checked={nativeSettings?.compaction?.enabled ?? true} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), compaction: { ...(nativeSettings?.compaction ?? {}), enabled: event.target.checked } })} /></NativeSetting>
               <NativeSetting label="Continue After Compaction" description="Resume the task after context maintenance completes."><input type="checkbox" style={{ accentColor: "var(--accent)", width: 15, height: 15, cursor: "pointer" }} checked={nativeSettings?.compaction?.autoContinue ?? true} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), compaction: { ...(nativeSettings?.compaction ?? {}), autoContinue: event.target.checked } })} /></NativeSetting>
                <NativeSetting label="Maintenance Strategy" description="Choose how OMP reduces context pressure."><select style={nativeSelectStyle} value={nativeSettings?.compaction?.strategy ?? "snapcompact"} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), compaction: { ...(nativeSettings?.compaction ?? {}), strategy: event.target.value as NonNullable<NativeSettings["compaction"]>["strategy"] } })}><option value="snapcompact">Snapcompact</option><option value="handoff">Handoff</option><option value="context-full">Context full</option><option value="shake">Shake</option><option value="off">Off</option></select></NativeSetting>
               <NativeSetting label="Compact Mid-Turn" description="Check context limits between safe tool-loop steps."><input type="checkbox" style={{ accentColor: "var(--accent)", width: 15, height: 15, cursor: "pointer" }} checked={nativeSettings?.compaction?.midTurnEnabled ?? true} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), compaction: { ...(nativeSettings?.compaction ?? {}), midTurnEnabled: event.target.checked } })} /></NativeSetting>
             </div>
           </section>
           <section style={{ padding: "16px", border: "1px solid var(--border)", borderRadius: "var(--radius-modal)", background: "var(--bg-subtle)" }}>
             <div style={{ fontSize: 13, fontWeight: 600 }}>Memory & Auto-Learn</div>
             <p style={{ margin: "6px 0 10px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>Memory stays under OMP&apos;s configured backend. Auto-learn may use an extra private turn after work completes.</p>
             <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 9 }}>
               <NativeSetting label="Memory Backend" description="Select where OMP stores durable project knowledge."><select style={nativeSelectStyle} value={nativeSettings?.memory?.backend ?? "mnemopi"} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), memory: { ...(nativeSettings?.memory ?? {}), backend: event.target.value as NonNullable<NativeSettings["memory"]>["backend"] } })}><option value="off">Off</option><option value="local">Local summaries</option><option value="mnemopi">Mnemopi SQLite</option><option value="hindsight">Hindsight</option></select></NativeSetting>
               <NativeSetting label="Enable Auto-Learn" description="Capture reusable lessons and managed skills after agent runs."><input type="checkbox" style={{ accentColor: "var(--accent)", width: 15, height: 15, cursor: "pointer" }} checked={nativeSettings?.autolearn?.enabled ?? true} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), autolearn: { ...(nativeSettings?.autolearn ?? {}), enabled: event.target.checked } })} /></NativeSetting>
               <NativeSetting label="Private Capture Turn" description="Run one private lesson-capture turn at completion; uses extra tokens."><input type="checkbox" style={{ accentColor: "var(--accent)", width: 15, height: 15, cursor: "pointer" }} checked={nativeSettings?.autolearn?.autoContinue ?? true} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), autolearn: { ...(nativeSettings?.autolearn ?? {}), autoContinue: event.target.checked } })} /></NativeSetting>
               <NativeSetting label="Memory Scope" description="Choose whether Mnemopi knowledge is shared across projects."><select style={nativeSelectStyle} value={nativeSettings?.mnemopi?.scoping ?? "per-project"} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), mnemopi: { ...(nativeSettings?.mnemopi ?? {}), scoping: event.target.value as NonNullable<NativeSettings["mnemopi"]>["scoping"] } })}><option value="per-project">Per project</option><option value="per-project-tagged">Per project, tagged recall</option><option value="global">Global</option></select></NativeSetting>
               <NativeSetting label="Recall on Session Start" description="Load relevant local memories into the first turn."><input type="checkbox" style={{ accentColor: "var(--accent)", width: 15, height: 15, cursor: "pointer" }} checked={nativeSettings?.mnemopi?.autoRecall ?? true} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), mnemopi: { ...(nativeSettings?.mnemopi ?? {}), autoRecall: event.target.checked } })} /></NativeSetting>
               <NativeSetting label="Retain Completed Turns" description="Store completed conversation turns in Mnemopi memory."><input type="checkbox" style={{ accentColor: "var(--accent)", width: 15, height: 15, cursor: "pointer" }} checked={nativeSettings?.mnemopi?.autoRetain ?? true} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), mnemopi: { ...(nativeSettings?.mnemopi ?? {}), autoRetain: event.target.checked } })} /></NativeSetting>
              </div>
            </section>
            <section style={{ padding: "16px", border: "1px solid var(--border)", borderRadius: "var(--radius-modal)", background: "var(--bg-subtle)" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Retry</div>
              <p style={{ margin: "6px 0 10px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>Persisted in OMP config and applied to new sessions. The retry banner in the composer can abort a live retry.</p>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 9 }}>
                <NativeSetting label="Automatic Retry" description="Retry failed turns automatically."><input type="checkbox" style={{ accentColor: "var(--accent)", width: 15, height: 15, cursor: "pointer" }} checked={nativeSettings?.retry?.enabled ?? true} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), retry: { ...(nativeSettings?.retry ?? {}), enabled: event.target.checked } })} /></NativeSetting>
                <NativeSetting label="Max Attempts" description="Retry limit before the turn is given up."><select style={nativeSelectStyle} value={String(nativeSettings?.retry?.maxRetries ?? 2)} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), retry: { ...(nativeSettings?.retry ?? {}), maxRetries: Number(event.target.value) } })}>{[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></NativeSetting>
                <NativeSetting label="Model Fallback" description="Fall back to another model when retries exhaust."><input type="checkbox" style={{ accentColor: "var(--accent)", width: 15, height: 15, cursor: "pointer" }} checked={nativeSettings?.retry?.modelFallback ?? false} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), retry: { ...(nativeSettings?.retry ?? {}), modelFallback: event.target.checked } })} /></NativeSetting>
              </div>
            </section>
            {nativeSettingsError && <p role="alert" style={{ margin: 0, color: "var(--status-error)", fontSize: 12 }}>{nativeSettingsError}</p>}
          <section style={{ borderTop: "1px solid var(--border)", paddingTop: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>ompweb application</div>
                <div style={{ marginTop: 4, color: appUpdate?.updateAvailable ? "var(--accent)" : "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                  {checkingAppUpdate ? "Checking for updates..." : appUpdate?.updateAvailable ? `v${appUpdate.currentVersion ?? "?"} -> v${appUpdate.availableVersion}` : appUpdate?.currentVersion ? `v${appUpdate.currentVersion} is up to date` : "Version unavailable"}
                </div>
              </div>
              <button type="button" onClick={() => void checkForAppUpdate(true)} disabled={checkingAppUpdate} aria-label="Check ompweb updates" style={{ padding: 7, border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "transparent", color: "var(--text-muted)", cursor: checkingAppUpdate ? "wait" : "pointer" }}><RefreshCw size={14} aria-hidden="true" /></button>
            </div>
            {appUpdate?.updateAvailable && <div style={{ marginTop: 12, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Run this command in terminal to update ompweb:</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <code style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)", wordBreak: "break-all" }}>{appUpdate.updateCommand || "npm install -g @kahme247/ompweb"}</code>
                <button type="button" onClick={() => { void navigator.clipboard.writeText(appUpdate.updateCommand || "npm install -g @kahme247/ompweb"); setMessage("Copied update command to clipboard."); }} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", cursor: "pointer", fontSize: 11 }}><Copy size={12} aria-hidden="true" /> Copy</button>
              </div>
            </div>}
          </section>
          <section style={{ borderTop: "1px solid var(--border)", paddingTop: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>OMP runtime</div>
                <div style={{ marginTop: 4, color: update?.updateAvailable ? "var(--accent)" : "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                  {checking ? "Checking for updates..." : update?.updateAvailable ? `v${update.currentVersion ?? "?"} -> v${update.availableVersion}` : update?.currentVersion ? `v${update.currentVersion} is up to date` : "Version unavailable"}
                </div>
              </div>
              <button type="button" onClick={() => void checkForUpdate()} disabled={checking} aria-label="Check OMP updates" style={{ padding: 7, border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "transparent", color: "var(--text-muted)", cursor: checking ? "wait" : "pointer" }}><RefreshCw size={14} aria-hidden="true" /></button>
            </div>
            {update?.updateAvailable && <div style={{ marginTop: 12, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Run this command in terminal to update OMP runtime:</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <code style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)", wordBreak: "break-all" }}>{update.updateCommand || "omp update"}</code>
                <button type="button" onClick={() => { void navigator.clipboard.writeText(update.updateCommand || "omp update"); setMessage("Copied update command to clipboard."); }} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-subtle)", color: "var(--text)", cursor: "pointer", fontSize: 11 }}><Copy size={12} aria-hidden="true" /> Copy</button>
              </div>
            </div>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              <button type="button" onClick={() => void restartSessions()} disabled={restarting} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 11px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "transparent", color: "var(--text)", cursor: restarting ? "wait" : "pointer", fontSize: 12 }}><RotateCcw size={13} aria-hidden="true" /> {restarting ? "Restarting..." : "Restart OMP sessions"}</button>
              <a href="https://github.com/can1357/oh-my-pi/releases" target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 11px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", color: "var(--text-muted)", textDecoration: "none", fontSize: 12 }}><ExternalLink size={13} aria-hidden="true" /> Changelog</a>
            </div>
            {message && <p role="status" style={{ margin: "10px 0 0", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>{message}</p>}
          </section>
          </div>
          {visitedTabs.has("models") && <div style={{ display: activeTab === "models" ? "flex" : "none", height: "100%", minHeight: 0, flexDirection: "column" }}>
            <ModelsConfig embedded onClose={onClose} onSaved={onModelsSaved} />
          </div>}
          {visitedTabs.has("mcp") && <div role="tabpanel" id="settings-panel-mcp" aria-labelledby="settings-tab-mcp" style={{ display: activeTab === "mcp" ? "flex" : "none", height: "100%", minHeight: 0, flexDirection: "column", overflowY: "auto", padding: 20, gap: 14 }}>
            {cwd && <section style={{ padding: "16px", border: "1px solid var(--border)", borderRadius: "var(--radius-modal)", background: "var(--bg-subtle)" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>MCP Behavior</div>
              <p style={{ margin: "6px 0 10px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>Global MCP behavior, persisted in OMP&apos;s config. Servers below are project-scoped and saved to <code>.omp/mcp.json</code> when no existing MCP config is present.</p>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 9 }}>
                <NativeSetting label="Load Project MCP Servers" description="Allow project-root MCP configuration to be discovered."><input type="checkbox" style={{ accentColor: "var(--accent)", width: 15, height: 15, cursor: "pointer" }} checked={nativeSettings?.mcp?.enableProjectConfig ?? true} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), mcp: { ...(nativeSettings?.mcp ?? {}), enableProjectConfig: event.target.checked } })} /></NativeSetting>
                <NativeSetting label="Render MCP Markdown" description="Render non-JSON MCP results as Markdown in the transcript."><input type="checkbox" style={{ accentColor: "var(--accent)", width: 15, height: 15, cursor: "pointer" }} checked={nativeSettings?.mcp?.renderMarkdownResults ?? true} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), mcp: { ...(nativeSettings?.mcp ?? {}), renderMarkdownResults: event.target.checked } })} /></NativeSetting>
                <NativeSetting label="MCP Resource Updates" description="Inject server resource updates into agent conversation."><input type="checkbox" style={{ accentColor: "var(--accent)", width: 15, height: 15, cursor: "pointer" }} checked={nativeSettings?.mcp?.notifications ?? false} onChange={(event) => void saveNativeSettings({ ...(nativeSettings ?? {}), mcp: { ...(nativeSettings?.mcp ?? {}), notifications: event.target.checked } })} /></NativeSetting>
              </div>
            </section>}
            <McpConfig cwd={cwd} sessionId={sessionId} />
            {!cwd && <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>Select a workspace to view and edit its project MCP configuration.</p>}
            {nativeSettingsError && <p role="alert" style={{ margin: 0, color: "var(--status-error)", fontSize: 12 }}>{nativeSettingsError}</p>}
          </div>}
          {cwd && visitedTabs.has("skills") && <div style={{ display: activeTab === "skills" ? "flex" : "none", height: "100%", minHeight: 0, flexDirection: "column" }}>
            <SkillsConfig embedded cwd={cwd} onClose={onClose} />
          </div>}
          {cwd && visitedTabs.has("plugins") && <div style={{ display: activeTab === "plugins" ? "flex" : "none", height: "100%", minHeight: 0, flexDirection: "column" }}>
            <PluginsConfig embedded cwd={cwd} sessionId={sessionId} onClose={onClose} onReloaded={onPluginsReloaded} />
          </div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

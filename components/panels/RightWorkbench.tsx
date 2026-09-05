"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bot, Columns2, ExternalLink, Files, Globe2, MessageCircle, Plus, Search, Split, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { sendAgentCommand } from "@/lib/agent-client";
import { createTemporarySession, fetchBrowserPreview } from "@/lib/workbench-client";

export type WorkbenchView = "files" | "agents" | "sidechat" | "browser";
// The workbench intentionally has one axis only.  A second axis (or a
// draggable dock) made the right rail feel like a nested window manager and
// was especially confusing on small screens.  The sole split is upper/lower.
type Orientation = "vertical";
type Pane = { id: string; tabs: WorkbenchView[]; active: WorkbenchView | null };
type Layout = { orientation: Orientation; split: number; panes: Pane[] };

const STORAGE_PREFIX = "omp-web:right-workbench:v1:";

const VIEW_META: Record<WorkbenchView, { icon: typeof Files; labelKey: string; fallback: string }> = {
  files: { icon: Files, labelKey: "rightWorkbench.files", fallback: "文件" },
  agents: { icon: Bot, labelKey: "rightWorkbench.agents", fallback: "任务管理" },
  sidechat: { icon: MessageCircle, labelKey: "rightWorkbench.sideChat", fallback: "侧栏对话" },
  browser: { icon: Globe2, labelKey: "rightWorkbench.browser", fallback: "浏览器" },
};

function emptyLayout(): Layout {
  return { orientation: "vertical", split: 50, panes: [{ id: "pane-1", tabs: [], active: null }] };
}

function normalizeLayout(value: unknown): Layout {
  if (!value || typeof value !== "object") return emptyLayout();
  const candidate = value as Partial<Layout>;
  const panes = Array.isArray(candidate.panes) ? candidate.panes.slice(0, 2).map((pane, index) => {
    const source = pane as Partial<Pane>;
    const tabs = Array.isArray(source.tabs) ? source.tabs.filter((tab): tab is WorkbenchView => tab === "files" || tab === "agents" || tab === "sidechat" || tab === "browser") : [];
    const active = tabs.includes(source.active as WorkbenchView) ? source.active as WorkbenchView : tabs[0] ?? null;
    return { id: typeof source.id === "string" ? source.id : `pane-${index + 1}`, tabs: [...new Set(tabs)], active };
  }) : [];
  return {
    // The workbench intentionally has one predictable split direction: an
    // upper and lower pane. Older saved layouts are normalized so users never
    // encounter a second axis after the interaction was removed.
    orientation: "vertical",
    split: typeof candidate.split === "number" && Number.isFinite(candidate.split) ? Math.min(78, Math.max(22, candidate.split)) : 50,
    panes: panes.length > 0 ? panes : emptyLayout().panes,
  };
}

function labelFor(t: (key: string, vars?: Record<string, string | number>) => string, view: WorkbenchView) {
  const meta = VIEW_META[view];
  const translated = t(meta.labelKey);
  return translated === meta.labelKey ? meta.fallback : translated;
}

function TemporarySideChat({ cwd }: { cwd: string | null }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Array<{ role: string; content: unknown }>>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setSessionId(null); setMessages([]); setInput(""); setRunning(false); setError(null); }, [cwd]);
  const start = useCallback(async () => {
    if (!cwd || sessionId) return sessionId;
    const id = await createTemporarySession(cwd);
    setSessionId(id);
    return id;
  }, [cwd, sessionId]);
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !cwd || running) return;
    setRunning(true); setError(null); setInput("");
    try {
      const sid = await start();
      if (!sid) throw new Error("临时 OMP 未就绪");
      await sendAgentCommand(sid, { type: "prompt", message: text });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setRunning(false);
    }
  }, [cwd, input, running, start]);
  useEffect(() => {
    if (!sessionId) return;
    const source = new EventSource("/api/agent/" + encodeURIComponent(sessionId) + "/events");
    source.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data) as { type?: string; message?: { role?: string; content?: unknown } };
        if (frame.type === "agent_end" || frame.type === "prompt_error") setRunning(false);
        if (frame.type !== "message_update" && frame.type !== "message_end" && frame.type !== "message_start") return;
        const message = frame.message;
        if (!message?.role) return;
        const role = message.role;
        setMessages((current) => { const next = [...current]; const last = next[next.length - 1]; if (last && last.role === role && frame.type === "message_update") next[next.length - 1] = { role, content: message.content }; else next.push({ role, content: message.content }); return next.slice(-80); });
      } catch { /* ignore heartbeat / malformed frame */ }
    };
    source.onerror = () => { if (running) setError("临时 OMP 连接中断，可重试发送。"); };
    return () => source.close();
  }, [running, sessionId]);
  if (!cwd) return <div style={{ height: "100%", display: "grid", placeItems: "center", padding: 20, color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>请先选择一个工作区，再启动临时 OMP 对话。</div>;
  return <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}><div style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", color: "var(--text-dim)", fontSize: 10.5 }}>临时 OMP · 独立会话，不打断主对话</div><div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 9, display: "grid", alignContent: "start", gap: 7 }}>{messages.length === 0 && !running && <div style={{ color: "var(--text-dim)", fontSize: 11, textAlign: "center", padding: 16 }}>输入问题，启动一个临时 OMP。</div>}{messages.map((message, index) => <div key={index} style={{ padding: "6px 8px", borderRadius: 7, background: message.role === "user" ? "var(--user-bg)" : "var(--bg-panel)", color: "var(--text)", fontSize: 11.5, lineHeight: 1.5 }}>{Array.isArray(message.content) ? (message.content as Array<{ type?: string; text?: string; toolName?: string; input?: unknown }>).map((block, blockIndex) => block.type === "toolCall" ? <pre key={blockIndex} style={{ margin: 0, whiteSpace: "pre-wrap", color: "var(--accent)", font: "10.5px/1.45 var(--font-mono)" }}>→ {block.toolName ?? "tool"} {JSON.stringify(block.input ?? {})}</pre> : <span key={blockIndex}>{block.text ?? ""}</span>) : String(message.content ?? "")}</div>)}{running && <div style={{ color: "var(--text-dim)", fontSize: 11 }}>临时 OMP 正在工作…</div>}{error && <div role="alert" style={{ color: "var(--status-error)", fontSize: 11 }}>{error}</div>}</div><form onSubmit={(event) => { event.preventDefault(); void send(); }} style={{ display: "flex", gap: 6, padding: 7, borderTop: "1px solid var(--border)", background: "var(--bg-panel)" }}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="询问临时 OMP…" aria-label="询问临时 OMP" style={{ minWidth: 0, flex: 1, height: 28, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text)", outline: 0, fontSize: 11.5 }} /><button type="submit" disabled={!input.trim() || running} title="发送到临时 OMP" aria-label="发送到临时 OMP" style={{ width: 44, border: 0, borderRadius: 6, background: "var(--accent)", color: "var(--bg)", cursor: input.trim() && !running ? "pointer" : "not-allowed", opacity: input.trim() && !running ? 1 : 0.5, fontSize: 11 }}>发送</button></form></div>;
}

function SideChatView({ cwd }: { cwd: string | null }) {
  return <TemporarySideChat cwd={cwd} />;
}

function BrowserView() {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [url, setUrl] = useState("");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = useCallback(async () => {
    const value = draft.trim();
    if (!/^https?:\/\//i.test(value)) return;
    setUrl(value);
    setLoading(true);
    setError(null);
    setPreviewHtml(null);
    try {
      const payload = await fetchBrowserPreview(value);
      const base = payload.finalUrl || value;
      const escapedBase = base.replace(/"/g, "&quot;");
      const html = /<head[\s>]/i.test(payload.html)
        ? payload.html.replace(/<head([^>]*)>/i, "<head$1><base href=\"" + escapedBase + "\">")
        : "<!doctype html><html><head><base href=\"" + escapedBase + "\"></head><body>" + payload.html + "</body></html>";
      setPreviewHtml(html);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [draft]);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, background: "var(--bg)" }}>
      <form onSubmit={(event) => { event.preventDefault(); submit(); }} style={{ display: "flex", gap: 6, padding: "7px 8px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
        <Search size={14} style={{ alignSelf: "center", color: "var(--text-dim)" }} aria-hidden="true" />
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("rightWorkbench.browserPlaceholder") === "rightWorkbench.browserPlaceholder" ? "输入 http(s) 地址…" : t("rightWorkbench.browserPlaceholder")} aria-label={t("rightWorkbench.browserPlaceholder")} style={{ minWidth: 0, flex: 1, border: 0, outline: 0, background: "transparent", color: "var(--text)", fontSize: 11.5 }} />
        <button type="submit" disabled={!/^https?:\/\//i.test(draft.trim())} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg)", color: "var(--text)", padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>{t("rightWorkbench.browserGo") === "rightWorkbench.browserGo" ? "打开" : t("rightWorkbench.browserGo")}</button>
      </form>
      {loading ? (
        <div role="status" style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--text-dim)", fontSize: 12 }}>{t("appShell.loading")}</div>
      ) : previewHtml ? (
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <iframe title={url} srcDoc={previewHtml} style={{ width: "100%", height: "100%", border: 0, background: "var(--bg)" }} sandbox="allow-forms allow-modals allow-popups allow-scripts" />
          <button type="button" onClick={() => window.open(url, "_blank", "noopener,noreferrer")} title={t("rightWorkbench.browserExternal") === "rightWorkbench.browserExternal" ? "在系统浏览器打开" : t("rightWorkbench.browserExternal")} style={{ position: "absolute", top: 8, right: 8, display: "inline-flex", gap: 4, alignItems: "center", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "color-mix(in srgb, var(--bg-panel) 90%, transparent)", color: "var(--text-muted)", padding: "4px 7px", cursor: "pointer", fontSize: 10.5 }}><ExternalLink size={12} aria-hidden="true" />{t("rightWorkbench.browserExternal") === "rightWorkbench.browserExternal" ? "外部打开" : t("rightWorkbench.browserExternal")}</button>
        </div>
      ) : error ? (
        <div role="alert" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--status-error)", fontSize: 12, textAlign: "center", padding: 20 }}><span>{error}</span><button type="button" onClick={() => void submit()} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-panel)", color: "var(--text)", padding: "5px 9px", cursor: "pointer", fontSize: 11 }}>重试</button></div>
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12, textAlign: "center", padding: 20 }}>{t("rightWorkbench.browserHint") === "rightWorkbench.browserHint" ? "输入网址后在工作区内预览" : t("rightWorkbench.browserHint")}</div>
      )}
    </div>
  );
}

export function RightWorkbench({
  storageKey,
  cwd,
  files,
  agents,
  requestedView,
}: {
  storageKey?: string;
  cwd: string | null;
  files: ReactNode;
  agents: ReactNode;
  requestedView?: { view: WorkbenchView; nonce: number } | null;
}) {
  const { t } = useI18n();
  const [layout, setLayout] = useState<Layout>(emptyLayout);
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 6, top: 36 });
  const plusRef = useRef<HTMLButtonElement>(null);
  const key = `${STORAGE_PREFIX}${storageKey || "global"}`;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(key);
      if (saved) setLayout(normalizeLayout(JSON.parse(saved)));
    } catch { /* private browsing / malformed old state */ }
    setReady(true);
  }, [key]);

  useEffect(() => {
    if (!ready) return;
    try { window.localStorage.setItem(key, JSON.stringify(layout)); } catch { /* ignore storage quota */ }
  }, [key, layout, ready]);

  const openView = useCallback((view: WorkbenchView) => {
    setLayout((current) => {
      const existingIndex = current.panes.findIndex((pane) => pane.tabs.includes(view));
      if (existingIndex >= 0) return { ...current, panes: current.panes.map((pane, index) => index === existingIndex ? { ...pane, active: view } : pane) };
      const targetIndex = current.panes.length - 1;
      return { ...current, panes: current.panes.map((pane, index) => index === targetIndex ? { ...pane, tabs: [...pane.tabs, view], active: view } : pane) };
    });
  }, []);

  useEffect(() => {
    if (!requestedView) return;
    openView(requestedView.view);
  }, [openView, requestedView]);

  const closeView = useCallback((paneId: string, view: WorkbenchView) => {
    setLayout((current) => {
      const ownerId = current.panes.some((pane) => pane.id === paneId && pane.tabs.includes(view))
        ? paneId
        : current.panes.find((pane) => pane.tabs.includes(view))?.id;
      if (!ownerId) return current;
      const nextPanes = current.panes.map((pane) => {
        if (pane.id !== ownerId) return pane;
        const tabs = pane.tabs.filter((tab) => tab !== view);
        return { ...pane, tabs, active: pane.active === view ? tabs[0] ?? null : pane.active };
      }).filter((pane, index) => current.panes.length > 1 && pane.tabs.length === 0 ? index === 0 : true);
      return { ...current, panes: nextPanes.length ? nextPanes : emptyLayout().panes };
    });
  }, []);

  const splitPane = useCallback(() => {
    setLayout((current) => current.panes.length >= 2 ? current : { ...current, orientation: "vertical", panes: [...current.panes, { id: `pane-${current.panes.length + 1}`, tabs: [], active: null }] });
  }, []);

  const renderView = useCallback((view: WorkbenchView) => {
    if (view === "files") return files;
    if (view === "agents") return agents;
    if (view === "sidechat") return <SideChatView cwd={cwd} />;
    return <BrowserView />;
  }, [agents, cwd, files]);

  const actions = useMemo(() => ["files", "agents", "sidechat", "browser"] as WorkbenchView[], []);
  const emptyActions = actions;

  const updateMenuPosition = useCallback(() => {
    const rect = plusRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Fixed positioning follows the exact clicked button while the clamps
    // keep the menu reachable at the viewport edges.
    const menuWidth = 166;
    const menuHeight = 190;
    setMenuPosition({
      left: Math.max(6, Math.min(rect.left, window.innerWidth - menuWidth - 6)),
      top: Math.max(6, Math.min(rect.bottom + 4, window.innerHeight - menuHeight - 6)),
    });
  }, []);
  const toggleMenu = useCallback(() => {
    setMenuOpen((current) => {
      const next = !current;
      if (next) updateMenuPosition();
      return next;
    });
  }, [updateMenuPosition]);

  useEffect(() => {
    if (!menuOpen) return;
    const reposition = () => updateMenuPosition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [menuOpen, updateMenuPosition]);

  // Keep the small plus menu attached to the button that opened it and close
  // it on an outside click/Escape.  This avoids a detached, screen-centred
  // popup when the right rail is resized or animated.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (plusRef.current?.contains(target)) return;
      if ((target as Element).closest("[data-right-workbench-menu]")) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setMenuOpen(false);
        plusRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);
  const anyTabs = layout.panes.some((pane) => pane.tabs.length > 0);
  if (!anyTabs) {
    return (
      <div data-testid="right-workbench-empty" style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, background: "var(--bg)", color: "var(--text-muted)" }}>
        <div style={{ width: "min(390px, 100%)", textAlign: "center" }}>
          <div style={{ width: 42, height: 42, margin: "0 auto 12px", display: "grid", placeItems: "center", borderRadius: 14, background: "var(--bg-selected)", color: "var(--accent)" }}><Columns2 size={20} aria-hidden="true" /></div>
          <h2 style={{ margin: "0 0 6px", fontSize: 16, color: "var(--text)", fontWeight: 650 }}>{t("rightWorkbench.emptyTitle") === "rightWorkbench.emptyTitle" ? "打开一个工作面" : t("rightWorkbench.emptyTitle")}</h2>
          <p style={{ margin: "0 0 18px", fontSize: 11.5, lineHeight: 1.55 }}>{t("rightWorkbench.emptyHint") === "rightWorkbench.emptyHint" ? "选择一个入口，工作区会在这里展开；需要时可增加一个上下分栏。" : t("rightWorkbench.emptyHint")}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, textAlign: "left" }}>
            {emptyActions.map((view) => { const meta = VIEW_META[view]; const Icon = meta.icon; return <button key={view} type="button" onClick={() => openView(view)} style={{ display: "flex", alignItems: "center", gap: 9, minHeight: 52, padding: "9px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--bg-panel)", color: "var(--text)", cursor: "pointer", textAlign: "left", transition: "border-color var(--dur-fast) var(--ease-out-warm), transform var(--dur-fast) var(--ease-out-warm)" }}><Icon size={17} style={{ color: "var(--accent)", flexShrink: 0 }} aria-hidden="true" /><span><strong style={{ display: "block", fontSize: 11.5 }}>{labelFor(t, view)}</strong><small style={{ display: "block", marginTop: 2, color: "var(--text-dim)", fontSize: 10 }}>{view === "files" ? "浏览工作区文件" : view === "agents" ? "查看任务进度" : view === "sidechat" ? "整理一个追问" : "预览网页"}</small></span></button>; })}
          </div>
        </div>
      </div>
    );
  }

  const openTabs = layout.panes.flatMap((pane) => pane.tabs.map((view) => ({ view, paneId: pane.id })));
  return <div data-testid="right-workbench" style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", background: "var(--bg)" }}>
    <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 3, minHeight: 34, padding: "3px 5px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0, overflow: "hidden" }}>
      <button ref={plusRef} type="button" onClick={toggleMenu} title="添加工作面" aria-label="添加工作面" aria-expanded={menuOpen} style={{ display: "grid", placeItems: "center", width: 26, height: 26, flexShrink: 0, border: 0, borderRadius: 5, background: menuOpen ? "var(--bg-selected)" : "transparent", color: menuOpen ? "var(--accent)" : "var(--text-muted)", cursor: "pointer" }}><Plus size={15} aria-hidden="true" /></button>
      <div role="tablist" aria-label="已打开工作面" style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0, flex: 1, overflowX: "auto" }}>
        {openTabs.map(({ view, paneId }) => { const meta = VIEW_META[view]; const Icon = meta.icon; const tabLabel = labelFor(t, view); const active = layout.panes.find((pane) => pane.id === paneId)?.active === view; return <div key={view} role="presentation" style={{ display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0, borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent", borderRadius: 5 }}><button type="button" role="tab" aria-selected={active} onClick={() => setLayout((current) => ({ ...current, panes: current.panes.map((pane) => pane.id === paneId ? { ...pane, active: view } : pane) }))} title={tabLabel} style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 25, padding: "0 6px", border: 0, background: "transparent", color: active ? "var(--text)" : "var(--text-muted)", cursor: "pointer", fontSize: 10.5, whiteSpace: "nowrap" }}><Icon size={12} aria-hidden="true" />{tabLabel}</button><button type="button" onClick={() => closeView(paneId, view)} aria-label={(t("rightWorkbench.close") === "rightWorkbench.close" ? "关闭" : t("rightWorkbench.close")) + " " + tabLabel} title={(t("rightWorkbench.close") === "rightWorkbench.close" ? "关闭" : t("rightWorkbench.close")) + " " + tabLabel} style={{ display: "grid", placeItems: "center", width: 18, height: 18, padding: 0, border: 0, borderRadius: 4, background: "transparent", color: "var(--text-dim)", cursor: "pointer" }}><X size={10} aria-hidden="true" /></button></div>; })}
      </div>
      <button
        type="button"
        data-testid="right-workbench-split"
        onClick={splitPane}
        title={t("rightWorkbench.split") === "rightWorkbench.split" ? "增加上下分栏" : t("rightWorkbench.split")}
        aria-label={t("rightWorkbench.split") === "rightWorkbench.split" ? "增加上下分栏" : t("rightWorkbench.split")}
        disabled={layout.panes.length >= 2}
        style={{ display: "grid", placeItems: "center", width: 24, height: 24, flexShrink: 0, border: 0, borderRadius: 5, background: "transparent", color: "var(--text-muted)", cursor: layout.panes.length >= 2 ? "not-allowed" : "pointer", opacity: layout.panes.length >= 2 ? 0.4 : 1 }}
      >
        <Split size={14} aria-hidden="true" />
      </button>
      {menuOpen && <div data-right-workbench-menu role="menu" style={{ position: "fixed", left: menuPosition.left, top: menuPosition.top, zIndex: 1000, minWidth: 150, padding: 5, border: "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--bg-panel)", boxShadow: "var(--shadow-pop)" }}>{actions.map((view) => { const Icon = VIEW_META[view].icon; return <button key={view} type="button" role="menuitem" onClick={() => { openView(view); setMenuOpen(false); }} title={labelFor(t, view)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", border: 0, borderRadius: 5, background: "transparent", color: "var(--text)", cursor: "pointer", textAlign: "left", fontSize: 11.5 }}><Icon size={14} style={{ color: "var(--accent)" }} aria-hidden="true" />{labelFor(t, view)}</button>; })}</div>}
    </div>
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {layout.panes.map((pane, index) => <div key={pane.id} style={{ position: "relative", minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", flex: index === 0 && layout.panes.length > 1 ? `0 0 ${layout.split}%` : 1 }}>
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}>
          {pane.tabs.map((view) => (
            <div key={view} aria-hidden={pane.active !== view} style={{ position: "absolute", inset: 0, visibility: pane.active === view ? "visible" : "hidden", pointerEvents: pane.active === view ? "auto" : "none", opacity: pane.active === view ? 1 : 0, transition: "opacity var(--dur-fast) var(--ease-out-warm)" }}>
              {renderView(view)}
            </div>
          ))}
          {!pane.active && <div style={{ height: "100%", display: "grid", placeItems: "center", color: "var(--text-dim)", fontSize: 11, padding: 16, textAlign: "center" }}>点击上方 + 添加工作面</div>}
        </div>
        {layout.panes.length > 1 && index === 0 && <div role="separator" aria-orientation="horizontal" aria-label="上下分栏" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, background: "var(--border)", zIndex: 3 }} />}
      </div>)}
    </div>
  </div>;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, SquareTerminal, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { TerminalPanel } from "../TerminalPanel";

export interface TerminalTab {
  id: string;
  cwd: string | null;
  /** Display label: directory base name, falls back to "Terminal N". */
  label: string;
}

const MAX_TERMINAL_TABS = 8;
const DEFAULT_DRAWER_HEIGHT = 280;

export function shouldAutoOpenInitialTab(input: {
  open: boolean;
  tabsLength: number;
  activeId: string | null;
  initialized: boolean;
  userClosedAll: boolean;
}): boolean {
  return input.open
    && input.tabsLength === 0
    && input.activeId === null
    && !input.initialized
    && !input.userClosedAll;
}

function initialDrawerHeight(): number {
  if (typeof window === "undefined") return DEFAULT_DRAWER_HEIGHT;
  try {
    const raw = Number(localStorage.getItem("omp-terminal-height"));
    return Number.isFinite(raw) && raw >= 140 ? raw : DEFAULT_DRAWER_HEIGHT;
  } catch {
    return DEFAULT_DRAWER_HEIGHT;
  }
}

let terminalTabSeq = 0;
function nextTabId(): string {
  terminalTabSeq += 1;
  return `term-${Date.now().toString(36)}-${terminalTabSeq}`;
}

function baseNameOf(cwd: string | null): string {
  if (!cwd) return "";
  const trimmed = cwd.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/**
 * Multi-tab terminal host (DSH-style). Every tab is a keep-mounted
 * TerminalPanel with preserveSession: switching tabs CSS-hides one panel and
 * shows the next, so PTYs stay alive server-side (30 min TTL reaps) and the
 * hidden panel reconnects with history replay when reactivated. Closing a tab
 * unmounts its panel, which reaps the PTY.
 *
 * Park semantics: AppShell keeps this host mounted while the drawer is hidden
 * so the surrounding layout does not churn. `open=false` returns null and
 * TerminalPanel children are removed (their PTYs reap); the refs are reset so
 * reopening starts a fresh shell lifecycle.
 *
 * Quick-script "run in terminal" commands arrive via runCommand and are
 * routed to a concrete tab: an existing tab with the same cwd is activated,
 * otherwise a fresh tab opens there — then the command is typed into that
 * tab's panel once. The host reports consumption via onRunCommandConsumed so
 * the parent can drop the command: a remount must not re-run it.
 */
export function TerminalTabs({ open, onClose, cwd, runCommand, onRunCommandConsumed, embedded = false }: {
  open: boolean;
  onClose: () => void;
  /** Default cwd for a newly created tab (project/active session). */
  cwd: string | null;
  /** Quick-script "run in terminal" — types into the matching tab. */
  runCommand?: { text: string; nonce: number } | null;
  /** Parent notification that the queued command was consumed (drop it). */
  onRunCommandConsumed?: () => void;
  /** Fill the parent workbench pane instead of owning a bottom-drawer height. */
  embedded?: boolean;
}) {
  const { t } = useI18n();
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drawerHeight, setDrawerHeight] = useState(initialDrawerHeight);
  // Ref mirrors so openTab (called from effects) never reads stale closures
  // nor forces itself to depend on array/active state (which would rebuild it
  // every render and re-trigger the first-tab effect).
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  // Opening the drawer initializes one shell once.  After the user closes the
  // final tab, keep the drawer genuinely empty instead of recreating a shell
  // on every render; closing the drawer and reopening it starts a fresh
  // initialization cycle because this host unmounts.
  const initializedRef = useRef(false);
  const userClosedAllRef = useRef(false);

  // AppShell keeps the host mounted while the drawer is hidden so the outer
  // layout does not churn.  Treat a closed drawer as a new lifecycle anyway:
  // PTYs are reaped by the child panels and the next open should initialize a
  // fresh shell.
  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      userClosedAllRef.current = false;
    }
  }, [open]);
  /** Per-tab queued command ({ text, nonce }) — delivered to the panel's
   *  runCommand prop while that tab is active; consumed once. */
  const [queued, setQueued] = useState<Record<string, { text: string; nonce: number }>>({});

  const openTab = useCallback((targetCwd: string | null, forceNew = false, activate = true): string => {
    // Reuse an existing tab with the same cwd when present (quick-script
    // routing); explicit "+" clicks force a new tab (forceNew).
    if (!forceNew) {
      const existing = tabsRef.current.find((tab) => tab.cwd === targetCwd);
      if (existing) {
        if (activate) setActiveId(existing.id);
        return existing.id;
      }
    }
    const id = nextTabId();
    const label = baseNameOf(targetCwd) || (t("terminal.untitled") ?? "Terminal");
    const active = activeIdRef.current;
    setTabs((prev) => {
      const next = [...prev, { id, cwd: targetCwd, label }];
      // Cap: never let stray tabs pile up past the backend PTY budget (12).
      if (next.length > MAX_TERMINAL_TABS) {
        const dropIdx = next.findIndex((tab) => tab.id !== active && tab.id !== id && next[0].id !== tab.id);
        const idx = dropIdx === -1 ? 0 : dropIdx;
        next.splice(idx, 1);
      }
      return next;
    });
    if (activate) setActiveId(id);
    return id;
  }, [t]);

  // Open a first tab when the host opens with none.
  useEffect(() => {
    if (shouldAutoOpenInitialTab({
      open,
      tabsLength: tabs.length,
      activeId,
      initialized: initializedRef.current,
      userClosedAll: userClosedAllRef.current,
    })) {
      initializedRef.current = true;
      openTab(cwd);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tabs.length, activeId, cwd]);

  // Route an incoming run command to its tab and queue it: an existing tab
  // with the same cwd is activated (VS Code-style "send to terminal"), else a
  // fresh tab opens there. Dedup is keyed on nonce only while this instance is
  // mounted; the parent drops the command on onRunCommandConsumed so a remount
  // (host closed → reopened) never re-runs it.
  const lastRunNonceRef = useRef(0);
  useEffect(() => {
    if (!runCommand || !open) return;
    if (runCommand.nonce === lastRunNonceRef.current) return;
    lastRunNonceRef.current = runCommand.nonce;
    const targetId = openTab(cwd);
    setQueued((prev) => ({ ...prev, [targetId]: { text: runCommand.text, nonce: runCommand.nonce } }));
    setActiveId(targetId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runCommand, open, cwd]);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((tab) => tab.id === id);
      if (idx === -1) return prev;
      const next = prev.filter((tab) => tab.id !== id);
      if (next.length === 0) userClosedAllRef.current = true;
      if (activeId === id) {
        const fallback = next[Math.min(idx, next.length - 1)];
        setActiveId(fallback ? fallback.id : null);
      }
      return next;
    });
    setQueued((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [activeId]);

  // Explicit "+" always creates a second terminal in the same cwd — the
  // reuse-by-cwd shortcut is reserved for quick-script routing.
  const newTab = useCallback(() => {
    openTab(cwd, true);
  }, [cwd, openTab]);

  const activeQueued = activeId ? queued[activeId] : undefined;
  const handleHeightChange = useCallback((nextHeight: number) => {
    if (embedded) return;
    const clamped = Math.max(140, Math.min(window.innerHeight * 0.85, nextHeight));
    setDrawerHeight(clamped);
  }, [embedded]);
  const consumeQueued = useCallback(() => {
    if (!activeId) return;
    setQueued((prev) => {
      if (!(activeId in prev)) return prev;
      const next = { ...prev };
      delete next[activeId];
      return next;
    });
  }, [activeId]);

  if (!open) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: embedded ? "100%" : `${drawerHeight + 36}px`, minHeight: 0, background: "var(--bg)", overflow: "hidden" }}>
      {/* Keep-mounted panels; only the active one is visible. */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            style={{
              position: "absolute", inset: 0,
              display: tab.id === activeId ? "block" : "none",
              background: "var(--bg)",
            }}
          >
            <TerminalPanel
              key={tab.id}
              open={tab.id === activeId}
              onClose={onClose}
              cwd={tab.cwd ?? undefined}
              preserveSession
              heightOverride={embedded ? undefined : drawerHeight}
              onHeightChange={handleHeightChange}
              embedded={embedded}
              runCommand={tab.id === activeId && activeQueued ? { ...activeQueued } : null}
            />
          </div>
        ))}
        {tabs.length === 0 && (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
            {t("terminal.empty") ?? "No terminal open."}
          </div>
        )}
      </div>

      {/* Terminal tabs live below the shell output so the drawer has one
          uninterrupted terminal surface above this compact switcher. */}
      <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "4px 6px", borderTop: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0, overflowX: "auto" }}>
        {tabs.map((tab) => {
          const selected = tab.id === activeId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveId(tab.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveId(tab.id); } }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "3px 4px 3px 8px", borderRadius: "var(--radius-control)",
                background: selected ? "var(--bg-selected)" : "transparent",
                border: "1px solid", borderColor: selected ? "color-mix(in srgb, var(--accent) 35%, var(--border))" : "transparent",
                cursor: "pointer", fontSize: 11, color: selected ? "var(--text)" : "var(--text-muted)",
                maxWidth: 180, flexShrink: 0, outline: "none",
              }}
              title={tab.cwd ?? tab.label}
            >
              <SquareTerminal size={11} strokeWidth={1.8} style={{ color: selected ? "var(--accent)" : "var(--text-dim)", flexShrink: 0 }} aria-hidden />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tab.label}</span>
              <button
                type="button"
                aria-label={`${t("terminal.closeTab") ?? "Close terminal"} ${tab.label}`}
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                style={{ display: "inline-flex", padding: 1, border: "none", background: "none", color: "var(--text-dim)", cursor: "pointer", flexShrink: 0 }}
              >
                <X size={10} strokeWidth={2} aria-hidden />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          aria-label={t("terminal.newTab") ?? "New terminal"}
          title={t("terminal.newTab") ?? "New terminal"}
          onClick={newTab}
          style={{ display: "inline-flex", padding: 3, border: "none", background: "none", color: "var(--text-dim)", cursor: "pointer", flexShrink: 0 }}
        >
          <Plus size={13} strokeWidth={2} aria-hidden />
        </button>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          aria-label={t("terminal.close") ?? "Close terminal"}
          onClick={onClose}
          style={{ display: "inline-flex", padding: 3, border: "none", background: "none", color: "var(--text-dim)", cursor: "pointer", flexShrink: 0 }}
        >
          <X size={13} strokeWidth={2} aria-hidden />
        </button>
      </div>

      {/* Consume the queued command after the panel received it (next tick). */}
      {activeQueued && (
        <QueuedCommandConsumer
          key={activeQueued.nonce}
          onConsumed={() => {
            consumeQueued();
            onRunCommandConsumed?.();
          }}
        />
      )}
    </div>
  );
}

/** Consumes the active queued command once the panel had a chance to run it
 *  (its own effect keys on nonce and fires immediately on prop change). */
function QueuedCommandConsumer({ onConsumed }: {
  onConsumed: () => void;
}) {
  useEffect(() => {
    // Let TerminalPanel's effect observe the queued command first.
    const timer = window.setTimeout(onConsumed, 0);
    return () => window.clearTimeout(timer);
  }, [onConsumed]);
  return null;
}

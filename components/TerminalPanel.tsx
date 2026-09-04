"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { TerminalSquare, RefreshCw, RotateCcw, Trash2, X, Maximize2, Minimize2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/hooks/useTheme";

import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { extractTerminalStreamFrames } from "@/lib/terminal-stream";

interface Props {
  open: boolean;
  onClose: () => void;
  cwd?: string | null;
  /** A shell command to run on next connect (quick-script "run in terminal").
   *  The panel writes it to the fresh PTY once the session is live. */
  runCommand?: { text: string; nonce: number } | null;
  /** Keep the backend PTY alive while hidden (multi-tab terminal). The panel
   *  instance stays mounted; hiding only closes the SSE stream, the session id
   *  survives and reconnects on the next open. False (default) preserves the
   *  old drawer behavior: hiding reaps the session. */
  preserveSession?: boolean;
  /** Optional host-controlled drawer height (used by the multi-tab bottom drawer). */
  heightOverride?: number;
  onHeightChange?: (height: number) => void;
  /** Fill a docked workbench pane. The host owns the pane splitter in this mode. */
  embedded?: boolean;
}

export function TerminalPanel({ open, onClose, cwd, runCommand, preserveSession = false, heightOverride, onHeightChange, embedded = false }: Props) {
  const { t } = useI18n();
  const { isDark, preference } = useTheme();
  // True between mount and unmount — lets the stream cleanup distinguish a
  // hide (open false, still mounted → park) from a real unmount (→ reap).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [height, setHeight] = useState<number>(() => {
    if (typeof window === "undefined") return 280;
    try {
      const raw = localStorage.getItem("omp-terminal-height");
      return raw ? Number(raw) : 280;
    } catch {
      return 280;
    }
  });
  const [maximized, setMaximized] = useState<boolean>(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [sessionCwd, setSessionCwd] = useState<string>(cwd || "");
  // Ref mirror of sessionId so queued/injected commands never read a stale
  // closure (runCommand effects run outside the render that created the id).
  const sessionIdRef = useRef<string | null>(null);

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const startYRef = useRef<number>(0);
  const startHeightRef = useRef<number>(280);
  // Stable ref for values read inside effects/stream loops.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  // Input POSTs are serialized: each keystroke is its own request, and
  // concurrent fetches can arrive out of order and scramble the shell input.
  const inputChainRef = useRef<Promise<void>>(Promise.resolve());

  const sendTerminalResize = useCallback((sid: string, cols: number, rows: number) => {
    void fetch("/api/terminal/resize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: sid, cols, rows }),
    }).catch(() => {
      // Best effort; the PTY keeps its previous size.
    });
  }, []);

  const sendTerminalInput = useCallback((sid: string, data: string) => {
    inputChainRef.current = inputChainRef.current.then(async () => {
      try {
        await fetch("/api/terminal/input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: sid, data }),
          // A hung input must not freeze the whole keystroke queue.
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        // Best effort; the next keystroke is still sent.
      }
    });
  }, []);

  // Output arriving before xterm finishes its async init is buffered here and
  // replayed once the terminal is ready. Without this the SSE stream (which
  // replays session history immediately on connect) races the dynamic xterm
  // import, and the banner + shell prompt are dropped — the panel looks dead.
  const pendingOutputRef = useRef<string>("");
  // A quick-script command queued to run on the next live session (the panel
  // may be opening, reconnecting, or already live when runCommand arrives).
  const queuedCommandRef = useRef<string | null>(null);

  // Initialize terminal session on backend
  const initSession = useCallback(async () => {
    try {
      setStatus("connecting");
      const res = await fetch("/api/terminal/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd }),
      });
      const data = await res.json();
      if (res.ok && data.sessionId) {
        setSessionId(data.sessionId);
        sessionIdRef.current = data.sessionId as string;
        setSessionCwd(data.cwd || cwd || "");
      } else {
        setStatus("disconnected");
      }
    } catch {
      setStatus("disconnected");
    }
  }, [cwd]);

  // Only create a backend terminal session while the panel is OPEN. A closed
  // panel used to spawn a PTY + SSE stream on every page load — with several
  // tabs open that exhausts the browser's per-host connection pool (HTTP/1.1
  // caps at 6, shared across tabs) and starves the session-load fetches.
  useEffect(() => {
    if (open && !sessionId) {
      void initSession();
    }
  }, [open, sessionId, initSession]);

  // Setup xterm.js instance
  useEffect(() => {
    if (!terminalRef.current) return;

    let isMounted = true;

    async function loadXterm() {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");

      if (!isMounted || !terminalRef.current) return;

      if (xtermInstanceRef.current) {
        xtermInstanceRef.current.dispose();
      }
      const isOled = preference === "oled";
      const isCodex = preference === "codex";
      const isNord = preference === "nord";
      const isDracula = preference === "dracula";
      const isPine = preference === "pine";
      const isNavy = preference === "navy";
      const isAurora = preference === "aurora-flow";

      const bg = (isOled || isCodex) ? "#000000" : isDracula ? "#282A36" : isNord ? "#2E3440" : isPine ? "#121B17" : isNavy ? "#0F172A" : isAurora ? "#0c1417" : isDark ? "#1B1916" : "#FAF9F6";
      const fg = isCodex ? "#EDEDED" : isOled ? "#F8FAFC" : isDark ? "#EBE6DC" : "#2B2823";
      const cursorColor = isCodex ? "#FFFFFF" : isOled ? "#38BDF8" : isDracula ? "#BD93F9" : isNord ? "#88C0D0" : isPine ? "#52B788" : isNavy ? "#60A5FA" : isAurora ? "#34d399" : "var(--accent)";

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'var(--font-mono), "SF Mono", Menlo, Consolas, monospace',
        theme: {
          background: bg,
          foreground: fg,
          cursor: cursorColor,
          selectionBackground: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)",
          black: isDark ? "#282828" : "#000000",
          red: "#FF5555",
          green: "#50FA7B",
          yellow: "#F1FA8C",
          blue: "#BD93F9",
          magenta: "#FF79C6",
          cyan: "#8BE9FD",
          white: "#BFBFBF",
        },
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);

      terminalRef.current.innerHTML = "";
      term.open(terminalRef.current);
      fitAddon.fit();
      if (sessionId) sendTerminalResize(sessionId, term.cols, term.rows);

      xtermInstanceRef.current = term;
      fitAddonRef.current = fitAddon;
      if (pendingOutputRef.current) {
        term.write(pendingOutputRef.current);
        pendingOutputRef.current = "";
      }

      term.onData((data: string) => {
        if (!sessionId) return;
        void sendTerminalInput(sessionId, data);
      });
    }

    void loadXterm();

    return () => {
      isMounted = false;
      if (xtermInstanceRef.current) {
        xtermInstanceRef.current.dispose();
        xtermInstanceRef.current = null;
      }
    };
  }, [isDark, preference, sessionId]);

  // Connect to the terminal output stream. Uses fetch + ReadableStream instead
  // of EventSource: EventSource proved unreliable here (after the initial
  // history replay its message handler silently stopped firing while the
  // connection stayed open), while the fetch stream path is the one verified
  // to deliver every frame. SSE frames are parsed manually ("data:" lines).
  useEffect(() => {
    if (!sessionId || !open) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;
    let streamDead = false;
    let reinits = 0;
    const controller = new AbortController();

    // New session (or reconnect): drop output buffered for the previous one.
    pendingOutputRef.current = "";

    const connect = async () => {
      if (cancelled) return;
      let staleSession = false;
      try {
        const res = await fetch(`/api/terminal/stream?id=${encodeURIComponent(sessionId)}`, { signal: controller.signal });
        if (res.status === 404) {
          // The session id is stale: the PTY was reaped server-side (idle TTL,
          // session cap) or the server restarted. Recreate the session ONCE by
          // clearing the id — the open-panel effect then spawns a fresh one.
          // Bounded so a systemic failure can't churn PTYs; past that the
          // header's reconnect button takes over.
          if (reinits < 1 && openRef.current) {
            reinits += 1;
            staleSession = true;
            retryTimer = setTimeout(() => {
              if (cancelled || !openRef.current) return;
              inputChainRef.current = Promise.resolve();
              setSessionId(null);
              sessionIdRef.current = null;
            }, retryDelay);
            retryDelay = Math.min(retryDelay * 2, 8000);
          } else {
            streamDead = true;
            setStatus("disconnected");
          }
          return;
        }
        if (!res.ok || !res.body) throw new Error(`terminal stream failed: ${res.status}`);
        setStatus("connected");
        // History replay has flushed to xterm — now run any queued quick
        // script (it arrived before this session became live).
        if (queuedCommandRef.current) {
          const text = queuedCommandRef.current;
          queuedCommandRef.current = null;
          sendTerminalInput(sessionId, `${text}\r`);
        }
        retryDelay = 1000;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // Protocol frames (event metadata, keep-alive comments, JSON data)
          // are parsed by the pure extractor; a trailing partial frame stays
          // in the buffer for the next read.
          const { chunks, rest } = extractTerminalStreamFrames(buffer);
          buffer = rest;
          for (const chunk of chunks) {
            if (chunk.includes("[Terminal closed")) {
              // The server reaped the session; stop reconnecting.
              streamDead = true;
              setStatus("disconnected");
            }
            if (xtermInstanceRef.current) {
              xtermInstanceRef.current.write(chunk);
            } else {
              pendingOutputRef.current += chunk;
            }
          }
        }
      } catch (err) {
        if (!cancelled && (err as Error)?.name !== "AbortError") {
          setStatus("disconnected");
        }
      } finally {
        if (!cancelled && !streamDead && !staleSession) {
          // Exponential backoff; only reconnect while the panel is open so a
          // hidden panel doesn't spam the server.
          if (openRef.current) {
            retryTimer = setTimeout(connect, retryDelay);
            retryDelay = Math.min(retryDelay * 2, 8000);
          }
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
      // preserveSession (multi-tab): a hide only parks the stream — the PTY
      // stays alive server-side (30 min TTL reaps it) and the next open
      // reconnects to the same session id with history replay. A real
      // unmount (tab closed) still reaps, exactly like the drawer default.
      if (preserveSession && mountedRef.current) return;
      // Reap the server-side session when the panel closes or the component
      // unmounts — never leave a PTY + SSE stream attached to a hidden panel.
      void fetch(`/api/terminal/session?id=${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
        keepalive: true,
      }).catch(() => {});
      // Drop the id so the next OPEN re-creates the session instead of
      // reconnecting to a reaped one. Harmless on unmount (React ignores it).
      setSessionId(null);
      sessionIdRef.current = null;
    };
  }, [sessionId, open, preserveSession]);

  // Handle auto-fit on resize or when drawer opens
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        fitAddonRef.current?.fit();
        // Keep the server-side PTY size in sync with the visible grid so
        // full-screen apps (vim, htop) wrap correctly.
        const term = xtermInstanceRef.current;
        if (term && sessionId) sendTerminalResize(sessionId, term.cols, term.rows);
        xtermInstanceRef.current?.focus();
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [open, height, maximized, sessionId, sendTerminalResize]);

  // Resize drag handler with drag-to-collapse
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = heightOverride ?? height;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = startYRef.current - ev.clientY;
      const newHeight = startHeightRef.current + delta;
      if (newHeight < 110) {
        onClose();
      } else {
        const clamped = Math.max(140, Math.min(window.innerHeight * 0.85, newHeight));
        setHeight(clamped);
        onHeightChange?.(clamped);
        try {
          localStorage.setItem("omp-terminal-height", String(clamped));
        } catch {}
        fitAddonRef.current?.fit();
      }
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [height, heightOverride, onClose, onHeightChange]);

  const effectiveHeight = heightOverride ?? height;

  const handleClear = useCallback(() => {
    xtermInstanceRef.current?.clear();
    xtermInstanceRef.current?.focus();
  }, []);

  const handleRestart = useCallback(async () => {
    if (sessionId) {
      await fetch(`/api/terminal/session?id=${encodeURIComponent(sessionId)}`, { method: "DELETE" }).catch(() => {});
    }
    // Old-session keystrokes queued behind a hung request must not stall the
    // new session's input.
    inputChainRef.current = Promise.resolve();
    setSessionId(null);
    sessionIdRef.current = null;
    xtermInstanceRef.current?.clear();
    await initSession();
  }, [sessionId, initSession]);

  // Quick-script "run in terminal": when a new runCommand arrives (nonce
  // bumps) and the panel is live, type the command + Enter; otherwise queue
  // it — the stream-connected flush or the next open runs it.
  const lastRunNonceRef = useRef(0);
  useEffect(() => {
    if (!runCommand || !open) return;
    if (runCommand.nonce === lastRunNonceRef.current) return;
    lastRunNonceRef.current = runCommand.nonce;
    const sid = sessionIdRef.current;
    if (sid && xtermInstanceRef.current) {
      queuedCommandRef.current = null;
      sendTerminalInput(sid, `${runCommand.text}\r`);
    } else {
      queuedCommandRef.current = runCommand.text;
    }
  }, [runCommand, open, sendTerminalInput]);

  return (
    <div
      className="terminal-panel-container"
      style={{
        position: "relative",
        width: "100%",
        // preserveSession: the instance is a keep-mounted multi-tab terminal —
        // it always renders at its own height and visibility is driven by the
        // tab host's display, never by collapsing to zero here.
        height: embedded ? "100%" : (open || preserveSession) ? (maximized ? "calc(100% - 40px)" : `${effectiveHeight}px`) : 0,
        maxHeight: embedded ? "none" : "85vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-panel)",
        borderTop: embedded ? "none" : (open || preserveSession) ? "1.5px solid var(--border)" : "none",
        boxShadow: embedded ? "none" : (open || preserveSession) ? "0 -4px 18px rgba(0,0,0,0.14)" : "none",
        zIndex: 45,
        overflow: "hidden",
        transition: embedded || isDraggingRef.current ? "none" : "height 240ms cubic-bezier(0.22, 1, 0.36, 1)",
        pointerEvents: (open || preserveSession) ? "auto" : "none",
        visibility: (open || preserveSession) ? "visible" : "hidden",
      }}
    >
      {/* Top drag handle */}
      {!embedded && (open || preserveSession) && (
        <div
          onMouseDown={handleMouseDown}
          title="拖拽调节终端高度，向下拉到底可收起"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 6,
            cursor: "row-resize",
            zIndex: 50,
          }}
        />
      )}

      {/* Header toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg)",
          userSelect: "none",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <TerminalSquare size={15} strokeWidth={2} style={{ color: "var(--accent)" }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
            {t("terminal.title") || "页面内嵌终端"}
          </span>
          <span
            style={{
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 4,
              background: status === "connected" ? "color-mix(in srgb, var(--status-success) 14%, transparent)" : "color-mix(in srgb, var(--status-warning) 14%, transparent)",
              color: status === "connected" ? "var(--status-success)" : "var(--status-warning)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {status === "connected" ? "ONLINE" : status === "connecting" ? "CONNECTING..." : "DISCONNECTED"}
          </span>
          {status === "disconnected" && (
            <button
              type="button"
              onClick={() => void handleRestart()}
              title={t("terminal.reconnect")}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text)", cursor: "pointer" }}
            >
              <RotateCcw size={10} strokeWidth={2} aria-hidden="true" />
              {t("terminal.reconnect")}
            </button>
          )}
          {sessionCwd && (
            <span
              style={{
                fontSize: 11,
                color: "var(--text-dim)",
                fontFamily: "var(--font-mono)",
                maxWidth: 320,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={sessionCwd}
            >
              {sessionCwd}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            onClick={handleClear}
            title={t("terminal.clear") || "清屏 (Clear)"}
            className="shell-toolbar-btn ui-focus-ring"
            style={{ width: 24, height: 24, borderRadius: 4 }}
          >
            <Trash2 size={13} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={handleRestart}
            title={t("terminal.restart") || "重启终端会话"}
            className="shell-toolbar-btn ui-focus-ring"
            style={{ width: 24, height: 24, borderRadius: 4 }}
          >
            <RefreshCw size={13} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => {
              setMaximized((m) => !m);
              setTimeout(() => fitAddonRef.current?.fit(), 100);
            }}
            title={maximized ? t("terminal.restore") || "还原" : t("terminal.maximize") || "最大化"}
            className="shell-toolbar-btn ui-focus-ring"
            style={{ width: 24, height: 24, borderRadius: 4 }}
          >
            {maximized ? <Minimize2 size={13} strokeWidth={1.8} /> : <Maximize2 size={13} strokeWidth={1.8} />}
          </button>
          <button
            type="button"
            onClick={onClose}
            title={t("terminal.close") || "收起终端"}
            className="shell-toolbar-btn ui-focus-ring"
            style={{ width: 24, height: 24, borderRadius: 4 }}
          >
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* Terminal Viewport */}
      <div
        ref={terminalRef}
        style={{
          flex: 1,
          padding: "8px 12px",
          background: "var(--bg)",
          overflow: "hidden",
        }}
      />
    </div>
  );
}

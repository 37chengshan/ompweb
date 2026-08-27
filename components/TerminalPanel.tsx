"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { TerminalSquare, RefreshCw, Trash2, X, Maximize2, Minimize2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/hooks/useTheme";

import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

interface Props {
  open: boolean;
  onClose: () => void;
  cwd?: string | null;
}

export function TerminalPanel({ open, onClose, cwd }: Props) {
  const { t } = useI18n();
  const { isDark, preference } = useTheme();
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

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const startYRef = useRef<number>(0);
  const startHeightRef = useRef<number>(280);
  const eventSourceRef = useRef<EventSource | null>(null);
  // Output arriving before xterm finishes its async init is buffered here and
  // replayed once the terminal is ready. Without this the SSE stream (which
  // replays session history immediately on connect) races the dynamic xterm
  // import, and the banner + shell prompt are dropped — the panel looks dead.
  const pendingOutputRef = useRef<string>("");

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
        setSessionCwd(data.cwd || cwd || "");
      } else {
        setStatus("disconnected");
      }
    } catch {
      setStatus("disconnected");
    }
  }, [cwd]);

  useEffect(() => {
    if (!sessionId) {
      void initSession();
    }
  }, [sessionId, initSession]);

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
      const isNord = preference === "nord";
      const isDracula = preference === "dracula";
      const isPine = preference === "pine";
      const isNavy = preference === "navy";
      const isAurora = preference === "aurora-flow";

      const bg = isOled ? "#000000" : isDracula ? "#282A36" : isNord ? "#2E3440" : isPine ? "#121B17" : isNavy ? "#0F172A" : isAurora ? "#0c1417" : isDark ? "#1B1916" : "#FAF9F6";
      const fg = isOled ? "#F8FAFC" : isDark ? "#EBE6DC" : "#2B2823";
      const cursorColor = isOled ? "#38BDF8" : isDracula ? "#BD93F9" : isNord ? "#88C0D0" : isPine ? "#52B788" : isNavy ? "#60A5FA" : isAurora ? "#34d399" : "var(--accent)";

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

      xtermInstanceRef.current = term;
      fitAddonRef.current = fitAddon;
      if (pendingOutputRef.current) {
        term.write(pendingOutputRef.current);
        pendingOutputRef.current = "";
      }

      term.onData((data: string) => {
        if (!sessionId) return;
        void fetch("/api/terminal/input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: sessionId, data }),
        });
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
    if (!sessionId) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    // New session (or reconnect): drop output buffered for the previous one.
    pendingOutputRef.current = "";

    const connect = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/terminal/stream?id=${encodeURIComponent(sessionId)}`, { signal: controller.signal });
        if (!res.ok || !res.body) throw new Error(`terminal stream failed: ${res.status}`);
        setStatus("connected");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let frameEnd: number;
          while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, frameEnd);
            buffer = buffer.slice(frameEnd + 2);
            const lines = frame.split("\n");
            // Named events (e.g. the server's `event: connected` frame) are
            // connection metadata, not terminal output — skip them.
            if (lines.some((line) => line.startsWith("event:"))) continue;
            const dataLine = lines.find((line) => line.startsWith("data:"));
            if (!dataLine) continue;
            const raw = dataLine.slice(5).trimStart();
            let chunk = raw;
            try {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed.data === "string") chunk = parsed.data;
            } catch {
              // Not JSON — treat the raw line as the chunk.
            }
            if (chunk) {
              if (xtermInstanceRef.current) {
                xtermInstanceRef.current.write(chunk);
              } else {
                pendingOutputRef.current += chunk;
              }
            }
          }
        }
      } catch (err) {
        if (!cancelled && (err as Error)?.name !== "AbortError") {
          setStatus("disconnected");
        }
      } finally {
        if (!cancelled) {
          // Auto-reconnect (the server replays history on every new stream).
          retryTimer = setTimeout(connect, 1000);
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [sessionId]);

  // Handle auto-fit on resize or when drawer opens
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        fitAddonRef.current?.fit();
        xtermInstanceRef.current?.focus();
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [open, height, maximized]);

  // Resize drag handler with drag-to-collapse
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = height;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = startYRef.current - ev.clientY;
      const newHeight = startHeightRef.current + delta;
      if (newHeight < 110) {
        onClose();
      } else {
        const clamped = Math.max(140, Math.min(window.innerHeight * 0.85, newHeight));
        setHeight(clamped);
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
  }, [height, onClose]);

  const handleClear = useCallback(() => {
    xtermInstanceRef.current?.clear();
    xtermInstanceRef.current?.focus();
  }, []);

  const handleRestart = useCallback(async () => {
    if (sessionId) {
      await fetch(`/api/terminal/session?id=${encodeURIComponent(sessionId)}`, { method: "DELETE" }).catch(() => {});
    }
    setSessionId(null);
    xtermInstanceRef.current?.clear();
    await initSession();
  }, [sessionId, initSession]);

  return (
    <div
      className="terminal-panel-container"
      style={{
        position: "relative",
        width: "100%",
        height: open ? (maximized ? "calc(100% - 40px)" : `${height}px`) : 0,
        maxHeight: "85vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-panel)",
        borderTop: open ? "1.5px solid var(--border)" : "none",
        boxShadow: open ? "0 -4px 18px rgba(0,0,0,0.14)" : "none",
        zIndex: 45,
        overflow: "hidden",
        transition: isDraggingRef.current ? "none" : "height 240ms cubic-bezier(0.22, 1, 0.36, 1)",
        pointerEvents: open ? "auto" : "none",
        visibility: open ? "visible" : "hidden",
      }}
    >
      {/* Top drag handle */}
      {open && (
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

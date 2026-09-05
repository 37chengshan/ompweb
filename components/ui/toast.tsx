"use client";

/**
 * Warm-paper toast system on @base-ui/react Toast.
 *
 * Usage anywhere (React or not):
 *   import { toast } from "./ui/toast";
 *   toast.success("已保存"); toast.error("保存失败", "请重试");
 *   toast.info("..."); toast.success("任务完成");
 *
 * Mount <ToastProvider> once near the app root (AppShell).
 */
import { Toast } from "@base-ui/react/toast";
import { AlertCircle, Check, Info, X } from "lucide-react";
import { useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import type React from "react";

type ToastKind = "success" | "error" | "info";

interface ToastData {
  kind?: ToastKind;
  variant?: "update";
  /** Clamp the description to 2 lines; click the description to expand it. */
  clamp?: boolean;
}

interface ToastOptions {
  /** Adds the update-specific arrival/exit treatment. */
  variant?: "update";
  /** Clamp the description to 2 lines; click the description to expand it. */
  clamp?: boolean;
  /**
   * Wall-clock lifetime before the toast auto-dismisses. Defaults per kind:
   * success/info 2000ms, error 3500ms. Update banners (variant: "update")
   * stay until dismissed. Unlike the base-ui hover/focus timer, this uses a
   * plain setTimeout so an unfocused window or hover never leaves a toast
   * stuck on screen.
   */
  durationMs?: number;
}

const manager = Toast.createToastManager<ToastData>();

// Default wall-clock lifetimes (ms). Kept short: these are confirmations, not
// announcements. Errors get slightly longer so the message is readable.
const DEFAULT_DURATION_MS: Record<ToastKind, number> = {
  success: 2000,
  info: 2000,
  error: 3500,
};
// Backstop for the base-ui timer: it pauses on hover/window-blur, so without
// this the toast could linger indefinitely. 30s is far beyond any default.
const BASE_UI_BACKSTOP_MS = 30_000;

function add(kind: ToastKind, title: React.ReactNode, description?: React.ReactNode, options?: ToastOptions) {
  const isUpdateBanner = options?.variant === "update";
  const id = manager.add({
    title,
    description,
    type: kind,
    // update banners are interactive announcements: keep them until the user
    // dismisses (no base-ui auto timer). Everything else auto-dismisses on a
    // wall clock that hover/blur cannot pause.
    timeout: isUpdateBanner ? 0 : (options?.durationMs ?? DEFAULT_DURATION_MS[kind]),
    data: { kind, clamp: options?.clamp, variant: options?.variant },
  });
  if (!isUpdateBanner) {
    // Force-close on a real timer: base-ui pauses its own countdown while the
    // toast is hovered or the window is blurred, which made toasts appear to
    // need a manual dismiss. This guarantees the configured lifetime.
    const lifetime = options?.durationMs ?? DEFAULT_DURATION_MS[kind];
    window.setTimeout(() => {
      manager.close(id);
    }, Math.min(lifetime, BASE_UI_BACKSTOP_MS));
  }
  return id;
}

export const toast = {
  success: (title: React.ReactNode, description?: React.ReactNode, options?: ToastOptions) =>
    add("success", title, description, options),
  error: (title: React.ReactNode, description?: React.ReactNode, options?: ToastOptions) =>
    add("error", title, description, options),
  info: (title: React.ReactNode, description?: React.ReactNode, options?: ToastOptions) =>
    add("info", title, description, options),
  close: (id?: string) => manager.close(id),
};

function KindIcon({ kind }: { kind?: ToastKind }) {
  const common = { size: 13, strokeWidth: 2, style: { flexShrink: 0, marginTop: 2 } } as const;
  if (kind === "success") return <Check {...common} style={{ ...common.style, color: "var(--accent)" }} aria-hidden />;
  if (kind === "error") return <AlertCircle {...common} style={{ ...common.style, color: "var(--accent-strong)" }} aria-hidden />;
  return <Info {...common} style={{ ...common.style, color: "var(--text-muted)" }} aria-hidden />;
}

const descriptionBaseStyle = {
  fontSize: 12,
  color: "var(--text-muted)",
  lineHeight: 1.5,
  marginTop: 2,
} as const;

/** Inline styles for a clamped description: 2-line ellipsis when collapsed, full content when expanded. */
export function clampDescriptionStyle(expanded: boolean): React.CSSProperties {
  return {
    ...descriptionBaseStyle,
    cursor: expanded ? "default" : "pointer",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    ...(expanded
      ? {}
      : {
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }),
  };
}

/**
 * Clamped text block: 2 lines with an ellipsis until clicked, then the full
 * content. Rendered inside a Toast.Description for long notices (e.g. the MCP
 * tool inventory) via toast.info(..., { clamp: true }).
 */
export function ClampedDescription({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <span
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      title={expanded ? undefined : "Click to expand"}
      style={clampDescriptionStyle(expanded)}
    >
      {children}
    </span>
  );
}

function Toaster() {
  const { toasts } = Toast.useToastManager<ToastData>();
  // All toasts live bottom-right, clear of the chat input bar / status area.
  // Bottom offset 24px on desktop, slightly higher on mobile so the on-screen
  // keyboard / input bar never covers the newest toast.
  const bottomOffset = 24;
  return (
    <Toast.Portal>
      <Toast.Viewport
        style={{
          position: "fixed",
          bottom: bottomOffset,
          right: 16,
          zIndex: 2100,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          width: "min(84vw, 280px)",
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <Toast.Root
            key={t.id}
            toast={t}
            className={`toast-card${t.data?.variant === "update" ? " toast-update" : ""}`}
            style={{
              pointerEvents: "auto",
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              background: "var(--bg)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-card)",
              boxShadow: "var(--shadow-pop)",
              padding: "8px 10px",
            }}
          >
            <KindIcon kind={t.type as ToastKind | undefined} />
            <Toast.Content style={{ flex: 1, minWidth: 0 }}>
              <Toast.Title className="display-serif" style={{ fontSize: 12.5, lineHeight: 1.35 }} />
              {t.data?.clamp ? (
                <Toast.Description render={<div />} style={descriptionBaseStyle}>
                  <ClampedDescription>{t.description}</ClampedDescription>
                </Toast.Description>
              ) : (
                // Rendered as a div (not base-ui's default <p>): descriptions can
                // carry block-level JSX (e.g. the update toasts' flex rows), and a
                // <div> inside <p> would throw a hydration error.
                <Toast.Description render={<div />} style={descriptionBaseStyle} />
              )}
            </Toast.Content>
            <Toast.Close
              aria-label="Dismiss"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                padding: 0,
                border: 0,
                borderRadius: "var(--radius-control)",
                background: "transparent",
                color: "var(--text-dim)",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <X size={12} strokeWidth={2} aria-hidden />
            </Toast.Close>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <Toast.Provider toastManager={manager} timeout={30_000} limit={4}>
      {children}
      <Toaster />
    </Toast.Provider>
  );
}

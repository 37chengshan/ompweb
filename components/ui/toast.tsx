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
import type React from "react";

type ToastKind = "success" | "error" | "info";

interface ToastData {
  kind?: ToastKind;
}

const manager = Toast.createToastManager<ToastData>();

function add(kind: ToastKind, title: React.ReactNode, description?: React.ReactNode) {
  return manager.add({
    title,
    description,
    type: kind,
    data: { kind },
  });
}

export const toast = {
  success: (title: React.ReactNode, description?: React.ReactNode) => add("success", title, description),
  error: (title: React.ReactNode, description?: React.ReactNode) => add("error", title, description),
  info: (title: React.ReactNode, description?: React.ReactNode) => add("info", title, description),
  close: (id?: string) => manager.close(id),
};

function KindIcon({ kind }: { kind?: ToastKind }) {
  const common = { size: 13, strokeWidth: 2, style: { flexShrink: 0, marginTop: 2 } } as const;
  if (kind === "success") return <Check {...common} style={{ ...common.style, color: "var(--accent)" }} aria-hidden />;
  if (kind === "error") return <AlertCircle {...common} style={{ ...common.style, color: "var(--accent-strong)" }} aria-hidden />;
  return <Info {...common} style={{ ...common.style, color: "var(--text-muted)" }} aria-hidden />;
}

function Toaster() {
  const { toasts } = Toast.useToastManager<ToastData>();
  return (
    <Toast.Portal>
      <Toast.Viewport
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
          zIndex: 2100,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          width: "min(92vw, 360px)",
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <Toast.Root
            key={t.id}
            toast={t}
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
              padding: "10px 12px",
            }}
          >
            <KindIcon kind={t.type as ToastKind | undefined} />
            <Toast.Content style={{ flex: 1, minWidth: 0 }}>
              <Toast.Title className="display-serif" style={{ fontSize: 13, lineHeight: 1.4 }} />
              <Toast.Description style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, marginTop: 2 }} />
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
    <Toast.Provider toastManager={manager} timeout={4000} limit={4}>
      {children}
      <Toaster />
    </Toast.Provider>
  );
}

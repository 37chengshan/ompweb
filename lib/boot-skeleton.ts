// Remove the pre-hydration boot skeleton (app/layout.tsx). AppShell does this
// on mount, but routes that render WITHOUT AppShell (e.g. /remote, /login)
// must remove it too — otherwise the opaque "正在启动…" overlay covers the
// page forever (reproduced on phone browsers via the LAN pairing flow).

export function removeBootSkeleton(options?: { fade?: boolean }): void {
  const skeleton = document.getElementById("boot-skeleton");
  if (!skeleton) return;
  if (!options?.fade) {
    skeleton.remove();
    return;
  }
  skeleton.style.opacity = "0";
  skeleton.style.pointerEvents = "none";
  skeleton.style.transition = "opacity var(--dur-fast, 150ms) var(--ease-out-warm, ease-out)";
  window.setTimeout(() => skeleton.remove(), 170);
}

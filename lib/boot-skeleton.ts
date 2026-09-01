// The root layout owns the boot skeleton. AppShell and standalone routes
// request dismissal through this event instead of removing its DOM node:
// native removal made React's next root-layout reconciliation throw
// insertBefore/removeChild NotFoundError.

export const BOOT_SKELETON_READY_EVENT = "ompweb:boot-skeleton-ready";

export type BootSkeletonDismissOptions = { fade?: boolean };

type BootSkeletonWindow = Window & {
  __ompwebBootSkeletonDismissal?: BootSkeletonDismissOptions;
};

function bootWindow(): BootSkeletonWindow | null {
  return typeof window === "undefined" ? null : window as BootSkeletonWindow;
}

export function getPendingBootSkeletonDismissal(): BootSkeletonDismissOptions | null {
  return bootWindow()?.__ompwebBootSkeletonDismissal ?? null;
}

export function removeBootSkeleton(options?: BootSkeletonDismissOptions): void {
  const target = bootWindow();
  if (!target) return;
  const detail = { fade: options?.fade === true };
  target.__ompwebBootSkeletonDismissal = detail;
  target.dispatchEvent(new CustomEvent<BootSkeletonDismissOptions>(BOOT_SKELETON_READY_EVENT, { detail }));
}

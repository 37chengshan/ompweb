/**
 * Client-side platform detection. Server components render nothing that
 * depends on this (SSR returns false).
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.userAgent);
}

/**
 * Canonical server-side path helpers (Node-only).
 *
 * - isWindowsAbsolutePath is the single source of truth for Windows-path
 *   detection (drive letter / UNC). lib/file-access.ts and
 *   lib/path-security.ts import it instead of duplicating the regex.
 * - samePath / normalizeForComparison handle server-side equality
 *   (normalize + strip trailing sep + case-fold on win32 via
 *   process.platform). For client-safe (no node:path) folding, use
 *   lib/comparable-path.ts:comparableProjectPath which sniffs the path form
 *   instead of process.platform.
 * - lib/project-identity.ts:projectIdentityKey is the stable grouping key
 *   for project roots and delegates to the same normalization; it exposes a
 *   platform param for testing.
 */
import path, { normalize } from "path";

const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

export function isWindowsAbsolutePath(filePath: string): boolean {
  return WINDOWS_ABSOLUTE_RE.test(filePath) || filePath.startsWith("\\\\") || filePath.startsWith("//");
}

/** Convert paths emitted by git to the host's native separator style. */
export function toNativePath(value: string): string {
  if (!value || process.platform !== "win32") return value;
  return normalize(value);
}

export function normalizeForComparison(value: string, platform: NodeJS.Platform = process.platform): string {
  if (!value) return value;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const nativeValue = platform === "win32" ? pathApi.normalize(toNativePath(value)) : value;
  const normalized = pathApi.normalize(nativeValue);
  const rootLength = pathApi.parse(normalized).root.length;
  let end = normalized.length;
  while (end > rootLength && normalized[end - 1] === pathApi.sep) end--;
  const withoutTrailing = normalized.slice(0, end);
  return platform === "win32" ? withoutTrailing.toLowerCase() : withoutTrailing;
}

export function samePath(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return normalizeForComparison(a) === normalizeForComparison(b);
}

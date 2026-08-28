import { realpathSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { isWindowsAbsolutePath } from "./paths";
import { listAllSessions } from "./session-reader";

export { isWindowsAbsolutePath } from "./paths";

// Allowed roots — in-memory plus session-derived, globalThis for hot-reload.
declare global {
  var __piAllowedRootsCache: { roots: Set<string>; expiresAt: number } | undefined;
  var __piAdditionalAllowedRoots: Set<string> | undefined;
}

export function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function getAdditionalAllowedRoots(): Set<string> {
  if (!globalThis.__piAdditionalAllowedRoots) globalThis.__piAdditionalAllowedRoots = new Set();
  return globalThis.__piAdditionalAllowedRoots;
}

export function allowFileRoot(root: string): void {
  if (!root) return;
  const n = normalizeSlashes(root);
  getAdditionalAllowedRoots().add(n);
  globalThis.__piAllowedRootsCache?.roots.add(n);
}

const ALLOWED_ROOTS_TTL_MS = 5_000;

export async function getAllowedFileRoots(): Promise<Set<string>> {
  const now = Date.now();
  const cached = globalThis.__piAllowedRootsCache;
  if (cached && cached.expiresAt > now) return cached.roots;
  const sessions = await listAllSessions();
  const roots = new Set<string>();
  for (const s of sessions) {
    if (s.cwd) roots.add(normalizeSlashes(s.cwd));
    if (s.projectRoot) roots.add(normalizeSlashes(s.projectRoot));
  }
  for (const root of getAdditionalAllowedRoots()) roots.add(root);
  globalThis.__piAllowedRootsCache = { roots, expiresAt: now + ALLOWED_ROOTS_TTL_MS };
  return roots;
}

export function isPathWithinRoots(target: string, roots: Set<string>): boolean {
  for (const root of roots) {
    const useWindowsRules = isWindowsAbsolutePath(target) || isWindowsAbsolutePath(root);
    const resolver = useWindowsRules ? path.win32 : path;
    const sep = useWindowsRules ? "\\" : path.sep;
    const n = resolver.resolve(target);
    const nr = resolver.resolve(root);
    const c = useWindowsRules ? n.toLowerCase() : n;
    const cr = useWindowsRules ? nr.toLowerCase() : nr;
    const withSep = cr.endsWith(sep) ? cr : cr + sep;
    if (c === cr || c.startsWith(withSep)) return true;
  }
  return false;
}

export const isFilePathAllowed = isPathWithinRoots;

export function isExistingPathWithinRoots(target: string, roots: Set<string>): boolean {
  let realTarget: string;
  try { realTarget = realpathSync(target); } catch { return false; }
  const realRoots = new Set<string>();
  for (const root of roots) { try { realRoots.add(realpathSync(root)); } catch { /* stale */ } }
  return isPathWithinRoots(realTarget, realRoots);
}

export function isExistingFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
  return isExistingPathWithinRoots(target, allowedRoots);
}
const OMP_IMAGE_NAME_RE = /^omp-image-[a-f0-9]+\.(png|jpe?g|webp|gif|mp4|m4v|mov|webm|ogv|mkv)$/i;

/**
 * omp's image-generation tool writes results to the system temp dir as
 * `omp-image-<hex>.<ext>`. Those files are not under any session root, so the
 * allowlist would 403 them — allow read access to exactly that generated
 * pattern (nothing else in the temp dir).
 */
export function isOmpGeneratedImagePath(filePath: string): boolean {
  const name = normalizeSlashes(filePath).slice(normalizeSlashes(filePath).lastIndexOf("/") + 1);
  if (!OMP_IMAGE_NAME_RE.test(name)) return false;
  // macOS /tmp is a symlink to /private/tmp and omp may report either form;
  // realpath both sides so string prefixes cannot miss the temp dir.
  try {
    const real = realpathSync(filePath);
    const realTmp = realpathSync(tmpdir());
    const prefix = normalizeSlashes(realTmp).replace(/\/+$/, "") + "/";
    return normalizeSlashes(real).startsWith(prefix);
  } catch {
    return false;
  }
}

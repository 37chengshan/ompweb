import type { SessionInfo } from "./types";

const STORAGE_KEY = "omp-web:last-open-by-project";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readEntries(storage: StorageLike): Record<string, string> {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, id]) => typeof id === "string" && id.length > 0)) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Treat legacy path spellings as aliases during workspace restoration. */
function comparableWorkspaceKey(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  const windowsForm = /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("//");
  return windowsForm ? normalized.toLowerCase() : normalized;
}

export function workspaceKeyOf(session: Pick<SessionInfo, "cwd" | "projectRoot" | "projectKey">): string {
  return session.projectKey ?? session.projectRoot ?? session.cwd;
}

export function getLastOpenSession(workspace: string, storage: StorageLike | null = browserStorage()): string | null {
  if (!storage) return null;
  const entries = readEntries(storage);
  if (entries[workspace]) return entries[workspace];
  const comparable = comparableWorkspaceKey(workspace);
  const alias = Object.entries(entries).find(([key]) => comparableWorkspaceKey(key) === comparable);
  return alias?.[1] ?? null;
}

export function setLastOpenSession(workspace: string, sessionId: string, storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    const entries = readEntries(storage);
    entries[workspace] = sessionId;
    storage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Workspace restoration is a best-effort convenience.
  }
}

export function clearLastOpenSession(workspace: string, storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    const entries = readEntries(storage);
    const comparable = comparableWorkspaceKey(workspace);
    const keys = Object.keys(entries).filter((key) => comparableWorkspaceKey(key) === comparable);
    if (keys.length === 0) return;
    keys.forEach((key) => delete entries[key]);
    if (Object.keys(entries).length === 0) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Workspace restoration is a best-effort convenience.
  }
}

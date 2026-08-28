/**
 * Update-notice state: remembers which versions the user has already seen,
 * records new ones, and honors the "show update notice" preference.
 * Pure helpers over localStorage so they are testable and SSR-safe.
 */

export interface UpdateRecord {
  version: string;
  seenAt: string; // ISO timestamp
}

const HISTORY_KEY = "omp-web:update-history";
const ENABLED_KEY = "omp-web:update-notice-enabled";
const MAX_HISTORY = 20;

export function loadUpdateHistory(): UpdateRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r): r is UpdateRecord => !!r && typeof r === "object"
        && typeof (r as UpdateRecord).version === "string"
        && typeof (r as UpdateRecord).seenAt === "string")
      .slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}

export function isUpdateNoticeEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setUpdateNoticeEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ENABLED_KEY, String(enabled));
  } catch {
    // best effort
  }
}

export interface RecordResult {
  history: UpdateRecord[];
  /** True when this version was not in the history before (a real update). */
  isNew: boolean;
}

/** Record the running version; returns whether it is a newly-seen update. */
export function recordCurrentVersion(version: string, now = new Date().toISOString()): RecordResult {
  const history = loadUpdateHistory();
  const existing = history.some((r) => r.version === version);
  const next = existing
    ? history
    : [...history, { version, seenAt: now }].slice(-MAX_HISTORY);
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable — the notice still shows this session
  }
  return { history: next, isNew: !existing };
}

export function clearUpdateHistory(): UpdateRecord[] {
  try {
    window.localStorage.removeItem(HISTORY_KEY);
  } catch {
    // best effort
  }
  return [];
}
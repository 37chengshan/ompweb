/**
 * Aggregate token usage across local session files. omp has no native
 * "today/week/month/total" token counter — the only data source is the
 * per-message usage recorded in each session .jsonl. Files are named
 * <iso-timestamp>_<uuid>.jsonl; only the last 90 days are scanned, and the
 * per-window buckets sum `input + output` (cache reads are excluded from the
 * "usage" numbers).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getSessionsDir } from "./omp/paths";

export const USAGE_SUMMARY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
export const USAGE_SUMMARY_TTL_MS = 2_000;

export interface UsageSummary {
  generatedAt: number;
  today: number;
  week: number;
  month: number;
  total: number;
  scannedFiles: number;
}

interface SummaryCache {
  expiresAt: number;
  summary: UsageSummary;
}

let cache: SummaryCache | null = null;

interface ParsedFileEntry {
  input: number;
  output: number;
  at: number;
}

interface FileParseCacheItem {
  mtimeMs: number;
  size: number;
  entries: ParsedFileEntry[];
}

const fileCache = new Map<string, FileParseCacheItem>();

/** Parse the leading ISO timestamp of a session file name, or null. */
export function sessionFileTime(fileName: string): number | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{3})?Z)/.exec(fileName);
  if (!match) return null;
  const iso = match[1].replace(/^(\d{4}-\d{2}-\d{2}T)(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, (_, date, h, m, s, ms) => `${date}${h}:${m}:${s}.${ms}Z`);
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : null;
}

export function parseUsageSummaryLine(line: string): { input: number; output: number; at: number } | null {
  let entry: { type?: string; timestamp?: string; message?: { usage?: { input?: unknown; output?: unknown } } };
  try {
    entry = JSON.parse(line) as typeof entry;
  } catch {
    return null;
  }
  if (entry.type !== "message") return null;
  const usage = entry.message?.usage;
  if (!usage) return null;
  const input = typeof usage.input === "number" ? usage.input : 0;
  const output = typeof usage.output === "number" ? usage.output : 0;
  if (input === 0 && output === 0) return null;
  const at = entry.timestamp ? Date.parse(entry.timestamp) : NaN;
  if (!Number.isFinite(at)) return null;
  return { input, output, at };
}

export function computeUsageSummary(
  files: Array<{ path: string; fileTime: number }>,
  now = Date.now(),
): UsageSummary {
  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  const weekStart = now - 7 * 24 * 60 * 60 * 1000;
  const monthStart = now - 30 * 24 * 60 * 60 * 1000;
  const windowStart = now - USAGE_SUMMARY_WINDOW_MS;
  let today = 0;
  let week = 0;
  let month = 0;
  let total = 0;
  let scannedFiles = 0;

  for (const file of files) {
    if (file.fileTime < windowStart) continue; // skip stale sessions by name

    let entries: ParsedFileEntry[];
    let fileStat: { mtimeMs: number; size: number } | null = null;
    try {
      const st = statSync(file.path);
      fileStat = { mtimeMs: st.mtimeMs, size: st.size };
    } catch {
      continue;
    }

    const cachedItem = fileCache.get(file.path);
    if (cachedItem && cachedItem.mtimeMs === fileStat.mtimeMs && cachedItem.size === fileStat.size) {
      entries = cachedItem.entries;
    } else {
      let body: string;
      try {
        body = readFileSync(file.path, "utf8");
      } catch {
        continue;
      }
      entries = [];
      let lineStart = 0;
      while (lineStart < body.length) {
        const newline = body.indexOf("\n", lineStart);
        const line = newline === -1 ? body.slice(lineStart) : body.slice(lineStart, newline);
        lineStart = newline === -1 ? body.length : newline + 1;
        const parsed = parseUsageSummaryLine(line);
        if (parsed) entries.push(parsed);
      }
      fileCache.set(file.path, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, entries });
    }

    scannedFiles += 1;
    for (const parsed of entries) {
      const tokens = parsed.input + parsed.output;
      total += tokens;
      if (parsed.at >= dayStart) today += tokens;
      if (parsed.at >= weekStart) week += tokens;
      if (parsed.at >= monthStart) month += tokens;
    }
  }

  return { generatedAt: now, today, week, month, total, scannedFiles };
}

/** Fast query from ~/.omp/stats.db if available */
export function getSummaryFromStatsDb(now = Date.now()): UsageSummary | null {
  try {
    const dbPath = join(homedir(), ".omp", "stats.db");
    if (!existsSync(dbPath)) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const dayStart = new Date(now).setHours(0, 0, 0, 0);
    const weekStart = now - 7 * 24 * 60 * 60 * 1000;
    const monthStart = now - 30 * 24 * 60 * 60 * 1000;
    const windowStart = now - USAGE_SUMMARY_WINDOW_MS;

    const row = db.prepare(`
      SELECT
        coalesce(sum(input_tokens + output_tokens), 0) as total,
        coalesce(sum(case when timestamp >= ? then input_tokens + output_tokens else 0 end), 0) as month,
        coalesce(sum(case when timestamp >= ? then input_tokens + output_tokens else 0 end), 0) as week,
        coalesce(sum(case when timestamp >= ? then input_tokens + output_tokens else 0 end), 0) as today,
        count(*) as count
      FROM messages
      WHERE timestamp >= ?
    `).get(monthStart, weekStart, dayStart, windowStart) as Record<string, number> | undefined;

    try { db.close(); } catch { /* ignore */ }

    if (!row) return null;
    return {
      generatedAt: now,
      today: Number(row.today) || 0,
      week: Number(row.week) || 0,
      month: Number(row.month) || 0,
      total: Number(row.total) || 0,
      scannedFiles: Number(row.count) || 0,
    };
  } catch {
    return null;
  }
}

/** List session files with their name-derived creation time. */
export function listSessionFilesWithTime(): Array<{ path: string; fileTime: number }> {
  const root = getSessionsDir();
  const out: Array<{ path: string; fileTime: number }> = [];
  let projectDirs: string[] = [];
  try {
    projectDirs = readdirSync(root);
  } catch {
    return out;
  }
  for (const project of projectDirs) {
    const projectPath = join(root, project);
    let files: string[] = [];
    try {
      files = readdirSync(projectPath);
    } catch {
      continue;
    }
    for (const fileName of files) {
      if (!fileName.endsWith(".jsonl")) continue;
      const fileTime = sessionFileTime(fileName);
      if (fileTime === null) continue;
      const full = join(projectPath, fileName);
      try {
        statSync(full); // existence check; skip unreadable
      } catch {
        continue;
      }
      out.push({ path: full, fileTime });
    }
  }
  return out;
}

export async function getUsageSummary(): Promise<UsageSummary> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.summary;

  const dbSummary = getSummaryFromStatsDb(now);
  if (dbSummary) {
    cache = { expiresAt: now + USAGE_SUMMARY_TTL_MS, summary: dbSummary };
    return dbSummary;
  }

  const files = listSessionFilesWithTime();
  const summary = computeUsageSummary(files, now);
  cache = { expiresAt: now + USAGE_SUMMARY_TTL_MS, summary };
  return summary;
}

export function clearUsageSummaryCache(): void {
  cache = null;
  fileCache.clear();
}

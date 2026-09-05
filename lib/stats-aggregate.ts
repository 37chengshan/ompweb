/**
 * Direct stats.db aggregation fallback for the usage dashboard.
 *
 * Mirrors the JSON shape of `omp stats --json` by reading ~/.omp/stats.db
 * directly with node:sqlite. The omp CLI (observed on omp/18.1.2 Windows)
 * can return zeroed aggregates (totalRequests: 0, empty byModel) even when
 * the database holds valid message rows; this module gives the UI correct
 * numbers without depending on that CLI behavior.
 */
import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";

export interface StatsOverall {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  errorRate: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  cacheRate: number;
  cacheSavings: number;
  totalCost: number;
  unpricedRequests: number;
  totalPremiumRequests: number;
  avgDuration: number | null;
  avgTtft: number | null;
  avgTokensPerSecond: number | null;
  firstTimestamp: number;
  lastTimestamp: number;
}

export interface StatsByModelItem {
  model: string;
  provider: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  errorRate: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  cacheRate: number;
  cacheSavings: number;
  totalCost: number;
  avgDuration: number | null;
  avgTtft: number | null;
  avgTokensPerSecond: number | null;
}

export interface StatsByFolderItem {
  folder: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  errorRate: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  cacheRate: number;
  totalCost: number;
}

export interface StatsByAgentTypeItem {
  agentType: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCost: number;
}

export interface StatsDbAggregate {
  overall: StatsOverall | null;
  byModel: StatsByModelItem[];
  byFolder: StatsByFolderItem[];
  byAgentType: StatsByAgentTypeItem[];
}

interface DbMessageRow {
  timestamp: number | null;
  model: string | null;
  provider: string | null;
  folder: string | null;
  agent_type: string | null;
  stop_reason: string | null;
  error_message: string | null;
  duration: number | null;
  ttft: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_total: number | null;
}


/**
 * Aggregate all usage rows from ~/.omp/stats.db into the dashboard shape.
 * Returns null when the database is absent/unreadable/empty so callers can
 * keep their own fallback chain intact.
 */
export async function aggregateFromStatsDb(): Promise<StatsDbAggregate | null> {
  const dbPath = join(homedir(), ".omp", "stats.db");
  if (!existsSync(dbPath)) return null;
  let db: InstanceType<typeof import("node:sqlite").DatabaseSync> | null = null;
  try {
    // Dynamic import (not require): Turbopack cannot externalize require("node:sqlite");
    // the same pattern is used by /api/usage/logs.
    const { DatabaseSync } = await import("node:sqlite") as typeof import("node:sqlite");
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare(
      [
        "SELECT timestamp, model, provider, folder, agent_type, stop_reason,",
        "       error_message, duration, ttft, input_tokens, output_tokens,",
        "       cache_read_tokens, cache_write_tokens, cost_total",
        "FROM messages"
      ].join(String.fromCharCode(32))
    ).all() as unknown as DbMessageRow[];
    if (rows.length === 0) return null;

    const num = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const isError = (row: DbMessageRow): boolean =>
      row.stop_reason === "error" || row.stop_reason === "aborted" || (row.error_message != null && row.error_message.length > 0);

    let totalRequests = 0;
    let successfulRequests = 0;
    let failedRequests = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheWriteTokens = 0;
    let totalCost = 0;
    let durationSum = 0;
    let durationCount = 0;
    let ttftSum = 0;
    let ttftCount = 0;
    let firstTimestamp = Number.POSITIVE_INFINITY;
    let lastTimestamp = 0;

    const modelMap = new Map<string, {
      model: string; provider: string; totalRequests: number; successfulRequests: number;
      failedRequests: number; totalInputTokens: number; totalOutputTokens: number;
      totalCacheReadTokens: number; totalCacheWriteTokens: number; totalCost: number;
      durationSum: number; durationCount: number; ttftSum: number; ttftCount: number; tokens: number[];
    }>();
    const folderMap = new Map<string, {
      folder: string; totalRequests: number; successfulRequests: number; failedRequests: number;
      totalInputTokens: number; totalOutputTokens: number; totalCacheReadTokens: number; totalCost: number;
    }>();
    const agentMap = new Map<string, {
      agentType: string; totalRequests: number; totalInputTokens: number; totalOutputTokens: number;
      totalCacheReadTokens: number; totalCost: number;
    }>();

    for (const row of rows) {
      const ts = num(row.timestamp);
      totalRequests += 1;
      if (isError(row)) failedRequests += 1; else successfulRequests += 1;
      totalInputTokens += num(row.input_tokens);
      totalOutputTokens += num(row.output_tokens);
      totalCacheReadTokens += num(row.cache_read_tokens);
      totalCacheWriteTokens += num(row.cache_write_tokens);
      totalCost += num(row.cost_total);
      if (ts > 0) {
        if (ts < firstTimestamp) firstTimestamp = ts;
        if (ts > lastTimestamp) lastTimestamp = ts;
      }
      const dur = num(row.duration);
      const ttft = num(row.ttft);
      if (row.duration != null && dur >= 0) { durationSum += dur; durationCount += 1; }
      if (row.ttft != null && ttft >= 0) { ttftSum += ttft; ttftCount += 1; }

      const model = (row.model || "unknown").trim() || "unknown";
      let m = modelMap.get(model);
      if (!m) {
        m = { model, provider: (row.provider || "").trim(), totalRequests: 0, successfulRequests: 0,
          failedRequests: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCacheReadTokens: 0,
          totalCacheWriteTokens: 0, totalCost: 0, durationSum: 0, durationCount: 0, ttftSum: 0,
          ttftCount: 0, tokens: [] };
        modelMap.set(model, m);
      }
      m.totalRequests += 1;
      if (isError(row)) m.failedRequests += 1; else m.successfulRequests += 1;
      m.totalInputTokens += num(row.input_tokens);
      m.totalOutputTokens += num(row.output_tokens);
      m.totalCacheReadTokens += num(row.cache_read_tokens);
      m.totalCacheWriteTokens += num(row.cache_write_tokens);
      m.totalCost += num(row.cost_total);
      if (row.duration != null && dur >= 0) { m.durationSum += dur; m.durationCount += 1; }
      if (row.ttft != null && ttft >= 0) { m.ttftSum += ttft; m.ttftCount += 1; }
      if (ts > 0) m.tokens.push(num(row.input_tokens) + num(row.output_tokens));

      const folder = (row.folder || "unknown").trim() || "unknown";
      let f = folderMap.get(folder);
      if (!f) {
        f = { folder, totalRequests: 0, successfulRequests: 0, failedRequests: 0, totalInputTokens: 0,
          totalOutputTokens: 0, totalCacheReadTokens: 0, totalCost: 0 };
        folderMap.set(folder, f);
      }
      f.totalRequests += 1;
      if (isError(row)) f.failedRequests += 1; else f.successfulRequests += 1;
      f.totalInputTokens += num(row.input_tokens);
      f.totalOutputTokens += num(row.output_tokens);
      f.totalCacheReadTokens += num(row.cache_read_tokens);
      f.totalCost += num(row.cost_total);

      const agentType = (row.agent_type || "main").trim() || "main";
      let a = agentMap.get(agentType);
      if (!a) {
        a = { agentType, totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0,
          totalCacheReadTokens: 0, totalCost: 0 };
        agentMap.set(agentType, a);
      }
      a.totalRequests += 1;
      a.totalInputTokens += num(row.input_tokens);
      a.totalOutputTokens += num(row.output_tokens);
      a.totalCacheReadTokens += num(row.cache_read_tokens);
      a.totalCost += num(row.cost_total);
    }


    const byModel: StatsByModelItem[] = [...modelMap.values()].map((m) => {
      const tokens = m.tokens;
      const sorted = [...tokens].sort((x, y) => x - y);
      const med = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
      const totalModelTokens = m.totalInputTokens + m.totalOutputTokens + m.totalCacheReadTokens;
      const avgPerSec = m.durationCount > 0 && m.durationSum > 0 ? totalModelTokens / (m.durationSum / 1000) : 0;
      const cacheTotal = m.totalCacheReadTokens + m.totalCacheWriteTokens;
      return {
        model: m.model,
        provider: m.provider,
        totalRequests: m.totalRequests,
        successfulRequests: m.successfulRequests,
        failedRequests: m.failedRequests,
        errorRate: m.totalRequests > 0 ? m.failedRequests / m.totalRequests : 0,
        totalInputTokens: m.totalInputTokens,
        totalOutputTokens: m.totalOutputTokens,
        totalCacheReadTokens: m.totalCacheReadTokens,
        totalCacheWriteTokens: m.totalCacheWriteTokens,
        cacheRate: cacheTotal > 0 ? m.totalCacheReadTokens / cacheTotal : 0,
        cacheSavings: m.totalCacheReadTokens > 0 ? med * m.totalRequests : 0,
        totalCost: m.totalCost,
        avgDuration: m.durationCount > 0 ? m.durationSum / m.durationCount : null,
        avgTtft: m.ttftCount > 0 ? m.ttftSum / m.ttftCount : null,
        avgTokensPerSecond: Number.isFinite(avgPerSec) ? avgPerSec : null,
      };
    });

    const byFolder: StatsByFolderItem[] = [...folderMap.values()].map((f) => {
      const cacheTotal = f.totalCacheReadTokens + f.totalOutputTokens;
      return {
        folder: f.folder,
        totalRequests: f.totalRequests,
        successfulRequests: f.successfulRequests,
        failedRequests: f.failedRequests,
        errorRate: f.totalRequests > 0 ? f.failedRequests / f.totalRequests : 0,
        totalInputTokens: f.totalInputTokens,
        totalOutputTokens: f.totalOutputTokens,
        totalCacheReadTokens: f.totalCacheReadTokens,
        cacheRate: cacheTotal > 0 ? f.totalCacheReadTokens / cacheTotal : 0,
        totalCost: f.totalCost,
      };
    });

    const byAgentType: StatsByAgentTypeItem[] = [...agentMap.values()].map((a) => ({
      agentType: a.agentType,
      totalRequests: a.totalRequests,
      totalInputTokens: a.totalInputTokens,
      totalOutputTokens: a.totalOutputTokens,
      totalCacheReadTokens: a.totalCacheReadTokens,
      totalCost: a.totalCost,
    }));

    const cacheTotal = totalCacheReadTokens + totalCacheWriteTokens;
    const overall: StatsOverall = {
      totalRequests,
      successfulRequests,
      failedRequests,
      errorRate: totalRequests > 0 ? failedRequests / totalRequests : 0,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheWriteTokens,
      cacheRate: cacheTotal > 0 ? totalCacheReadTokens / cacheTotal : 0,
      cacheSavings: totalCacheReadTokens,
      totalCost,
      unpricedRequests: 0,
      totalPremiumRequests: 0,
      avgDuration: durationCount > 0 ? durationSum / durationCount : null,
      avgTtft: ttftCount > 0 ? ttftSum / ttftCount : null,
      avgTokensPerSecond: durationSum > 0 ? (totalInputTokens + totalOutputTokens + totalCacheReadTokens) / (durationSum / 1000) : null,
      firstTimestamp: Number.isFinite(firstTimestamp) ? firstTimestamp : 0,
      lastTimestamp,
    };

    return { overall, byModel, byFolder, byAgentType };
  } catch (error) {
    console.warn("stats.db fallback aggregation failed:", error);
    return null;
  } finally {
    if (db) { try { db.close(); } catch { /* ignore */ } }
  }
}

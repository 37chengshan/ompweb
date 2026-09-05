import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { resolveOmpBin } from "@/lib/omp/omp-cli";
import { aggregateFromStatsDb } from "@/lib/stats-aggregate";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const STATS_CACHE_TTL_MS = 2_000;

interface CachedStatsData {
  expiresAt: number;
  data: Record<string, unknown>;
}

let cachedStats: CachedStatsData | null = null;
let inFlightPromise: Promise<Record<string, unknown>> | null = null;

/**
 * omp stats --json can return zeroed aggregates (observed with omp/18.1.2 on
 * Windows) even when ~/.omp/stats.db holds valid rows: the sync step reports
 * "Synced 0 new entries" and every aggregate is 0/empty. Treat that as a CLI
 * failure and fall back to a direct read-only aggregation of the sqlite db so
 * the usage dashboard always shows real numbers.
 */
function statsLookMeaningful(parsed: Record<string, unknown>): boolean {
  const overall = parsed.overall as Record<string, unknown> | null | undefined;
  if (!overall) return false;
  const reqs = typeof overall.totalRequests === "number" ? overall.totalRequests : 0;
  const inp = typeof overall.totalInputTokens === "number" ? overall.totalInputTokens : 0;
  const out = typeof overall.totalOutputTokens === "number" ? overall.totalOutputTokens : 0;
  const byModel = Array.isArray(parsed.byModel) ? parsed.byModel : [];
  return reqs > 0 || inp > 0 || out > 0 || byModel.length > 0;
}

async function fetchStatsData(): Promise<Record<string, unknown>> {
  const ompBin = resolveOmpBin();
  if (!ompBin) {
    throw new Error("omp binary not found on PATH or OMP_WEB_OMP_BIN");
  }

  const [statsResult, usageResult] = await Promise.allSettled([
    execFileAsync(ompBin, ["stats", "--json"], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }),
    execFileAsync(ompBin, ["usage", "--json"], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }),
  ]);

  let parsedStats: Record<string, unknown> = {};
  if (statsResult.status === "fulfilled") {
    const raw = statsResult.value.stdout;
    // Strip possible non-json log lines before {
    const jsonStart = raw.indexOf("{");
    if (jsonStart >= 0) {
      try {
        parsedStats = JSON.parse(raw.slice(jsonStart)) as Record<string, unknown>;
      } catch (e) {
        console.warn("Failed to parse omp stats --json output:", e);
      }
    }
  } else {
    console.warn("Failed to run omp stats --json:", statsResult.reason);
  }

  let parsedUsage: Record<string, unknown> = {};
  if (usageResult.status === "fulfilled") {
    const raw = usageResult.value.stdout;
    const jsonStart = raw.indexOf("{");
    if (jsonStart >= 0) {
      try {
        parsedUsage = JSON.parse(raw.slice(jsonStart)) as Record<string, unknown>;
      } catch (e) {
        console.warn("Failed to parse omp usage --json output:", e);
      }
    }
  } else {
    console.warn("Failed to run omp usage --json:", usageResult.reason);
  }

  if (!statsLookMeaningful(parsedStats)) {
    try {
      const db = await aggregateFromStatsDb();
      if (db && db.overall && (db.overall.totalRequests > 0 || db.overall.totalInputTokens > 0)) {
        console.warn("omp stats --json returned empty aggregates; fell back to stats.db aggregation");
        parsedStats = db as unknown as Record<string, unknown>;
      }
    } catch (error) {
      console.warn("stats.db fallback aggregation failed:", error);
    }
  }

  return {
    overall: parsedStats.overall ?? null,
    byModel: parsedStats.byModel ?? [],
    byFolder: parsedStats.byFolder ?? [],
    byAgentType: parsedStats.byAgentType ?? [],
    timeSeries: parsedStats.timeSeries ?? [],
    modelSeries: parsedStats.modelSeries ?? [],
    modelPerformanceSeries: parsedStats.modelPerformanceSeries ?? [],
    costSeries: parsedStats.costSeries ?? [],
    reports: parsedUsage.reports ?? [],
    capacity: parsedUsage.capacity ?? {},
    timestamp: Date.now(),
  };
}

export async function GET() {
  const now = Date.now();
  if (cachedStats && cachedStats.expiresAt > now) {
    return NextResponse.json(cachedStats.data);
  }

  if (!inFlightPromise) {
    inFlightPromise = fetchStatsData()
      .then((data) => {
        cachedStats = {
          expiresAt: Date.now() + STATS_CACHE_TTL_MS,
          data,
        };
        return data;
      })
      .finally(() => {
        inFlightPromise = null;
      });
  }

  try {
    const data = await inFlightPromise;
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to retrieve usage stats:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

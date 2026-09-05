import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { resolveOmpBin } from "@/lib/omp/omp-cli";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const STATS_CACHE_TTL_MS = 2_000;

interface CachedStatsData {
  expiresAt: number;
  data: Record<string, unknown>;
}

let cachedStats: CachedStatsData | null = null;
let inFlightPromise: Promise<Record<string, unknown>> | null = null;

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
    // Strip possible non-json log lines before '{'
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

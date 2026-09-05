import { NextResponse } from "next/server";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10)));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10));
  const errorsOnly = url.searchParams.get("errorsOnly") === "true";
  const model = url.searchParams.get("model")?.trim();
  const provider = url.searchParams.get("provider")?.trim();
  const q = url.searchParams.get("q")?.trim();

  const dbPath = join(homedir(), ".omp", "stats.db");
  if (!existsSync(dbPath)) {
    return NextResponse.json({ total: 0, logs: [] });
  }

  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });

    try {
      const conditions: string[] = [];
      const params: (string | number)[] = [];

      if (errorsOnly) {
        conditions.push("(stop_reason = 'error' OR stop_reason = 'aborted' OR error_message IS NOT NULL)");
      }
      if (model) {
        conditions.push("model = ?");
        params.push(model);
      }
      if (provider) {
        conditions.push("provider = ?");
        params.push(provider);
      }
      if (q) {
        conditions.push("(model LIKE ? OR provider LIKE ? OR error_message LIKE ? OR entry_id LIKE ? OR folder LIKE ?)");
        const like = `%${q}%`;
        params.push(like, like, like, like, like);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const countQuery = `SELECT count(*) as count FROM messages ${whereClause}`;
      const countStmt = db.prepare(countQuery);
      const countResult = countStmt.get(...params) as { count?: number } | undefined;
      const total = countResult?.count ?? 0;

      const dataQuery = `
        SELECT id, timestamp, model, provider, api, duration, ttft,
               stop_reason as stopReason, error_message as errorMessage,
               input_tokens as inputTokens, output_tokens as outputTokens,
               cache_read_tokens as cacheReadTokens, cache_write_tokens as cacheWriteTokens,
               total_tokens as totalTokens, cost_total as costTotal,
               agent_type as agentType, entry_id as entryId, session_file as sessionFile,
               folder
        FROM messages
        ${whereClause}
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `;
      const dataStmt = db.prepare(dataQuery);
      const logs = dataStmt.all(...params, limit, offset);

      return NextResponse.json({ total, logs });
    } finally {
      try { db.close(); } catch { /* ignore */ }
    }
  } catch (error) {
    console.error("Failed to query stats.db:", error);
    return NextResponse.json({ total: 0, logs: [], error: String(error) }, { status: 500 });
  }
}

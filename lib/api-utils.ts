import { NextResponse } from "next/server";
import { resolveSessionPath } from "./session-reader";

const SESSION_NOT_FOUND = { error: "Session not found", code: "session_not_found" } as const;

/** Resolve a session id to its file path, or a 404 JSON response. Replaces the
 * repeated `resolveSessionPath(id)` + "Session not found" guard across routes. */
export async function resolveSessionPathOr404(
  id: string,
): Promise<{ filePath: string } | { response: NextResponse }> {
  const filePath = await resolveSessionPath(id);
  if (!filePath) return { response: NextResponse.json(SESSION_NOT_FOUND, { status: 404 }) };
  return { filePath };
}

/** Uniform JSON error body used by most API routes. */
export function apiErrorResponse(error: unknown, status = 500): NextResponse {
  return NextResponse.json({ error: String(error) }, { status });
}

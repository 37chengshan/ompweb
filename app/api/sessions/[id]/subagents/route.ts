import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { extractSubagentHistory } from "@/lib/subagent-history";

export const dynamic = "force-dynamic";

/**
 * GET /api/sessions/[id]/subagents
 *
 * On-disk subagent roster for a session, recovered from the parent file's task
 * toolResults (works without a live RPC process — survives page reloads).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found", code: "session_not_found" }, { status: 404 });
    }
    const subagents = extractSubagentHistory(filePath);
    return NextResponse.json({ subagents });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

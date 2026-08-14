import { NextResponse } from "next/server";
import { resolveSessionPathOr404 } from "@/lib/api-utils";
import { extractSubagentHistory } from "@/lib/subagent-history";
import { getRpcSession } from "@/lib/rpc-manager";

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
    const resolved = await resolveSessionPathOr404(id);
    if ("response" in resolved) {
      // A brand-new session's file can land just after the prompt
      // acknowledgement; while its RPC wrapper is alive that is "no on-disk
      // history yet", not "unknown session". The client treats an empty
      // roster the same as a 404, so answer 200 to keep the console clean.
      if (getRpcSession(id)?.isAlive()) {
        return NextResponse.json({ subagents: [] });
      }
      return resolved.response;
    }
    const filePath = resolved.filePath;
    const subagents = extractSubagentHistory(filePath);
    return NextResponse.json({ subagents });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

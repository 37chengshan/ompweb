import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { resolveSessionPath } from "@/lib/session-reader";
import { readSubagentCompletion, readSubagentTranscriptPage, subagentTranscriptPath } from "@/lib/subagent-history";

export const dynamic = "force-dynamic";

// Subagent ids are AdjectiveNoun names ([A-Za-z0-9_-]); the regex both bounds
// the value and guarantees the joined path cannot escape the sibling dir.
const SUBAGENT_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * GET /api/sessions/[id]/subagents/[subagentId]?fromByte=N
 *
 * Default: paged transcript of one subagent, read directly from the parent
 * session's sibling artifacts dir. Mirrors the RPC get_subagent_messages
 * response shape so the dialog can fall back to it when no live RPC process
 * knows the file.
 *
 * ?mode=completion: the subagent's final output (`<id>.md`), without loading
 * the transcript — works even for transcripts beyond the readable size cap.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; subagentId: string }> }
) {
  const { id, subagentId } = await params;
  try {
    if (!SUBAGENT_ID_RE.test(subagentId)) {
      return NextResponse.json({ error: "Invalid subagent id", code: "invalid_subagent_id" }, { status: 400 });
    }
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found", code: "session_not_found" }, { status: 404 });
    }
    const searchParams = new URL(req.url).searchParams;
    if (searchParams.get("mode") === "completion") {
      const completion = readSubagentCompletion(filePath, subagentId);
      return NextResponse.json({
        sessionFile: subagentTranscriptPath(filePath, subagentId),
        completion: completion?.completion ?? null,
        truncated: completion?.truncated ?? false,
      });
    }
    const transcriptFile = subagentTranscriptPath(filePath, subagentId);
    if (!existsSync(transcriptFile)) {
      return NextResponse.json({ error: "Subagent transcript not found", code: "transcript_not_found" }, { status: 404 });
    }
    const fromByteRaw = searchParams.get("fromByte");
    const fromByte = fromByteRaw !== null ? Number(fromByteRaw) : 0;
    const page = readSubagentTranscriptPage(transcriptFile, fromByte);
    return NextResponse.json(page);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

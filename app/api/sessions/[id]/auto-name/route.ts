import { NextResponse } from "next/server";
import { scanSessionInfo, setSessionTitle } from "@/lib/omp/session-files";
import { deriveSessionTitleFromFirstMessage, sanitizeSessionTitle } from "@/lib/session-title";
import { getRpcSession } from "@/lib/rpc-manager";
import { invalidateSessionListCache, resolveSessionPath } from "@/lib/session-reader";

/**
 * POST /api/sessions/[id]/auto-name
 *
 * omp auto-generates session titles itself (persisted in the title slot), so
 * this endpoint no longer runs an LLM: it returns the live session's title
 * when the session is running, else the persisted title, else a fallback
 * derived from the first user message (persisted so the sidebar updates).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    // Running session: ask the live omp process (its in-memory title is newer
    // than the file's slot while a rewrite is pending). This runs before the
    // path check because omp does not create the session file until the history
    // holds an assistant message.
    const rpc = getRpcSession(id);
    const running = Boolean(rpc?.isAlive?.());
    if (running && typeof rpc?.send === "function") {
      try {
        const state = await rpc.send({ type: "get_state" }) as { sessionName?: string } | null;
        const liveTitle = sanitizeSessionTitle(state?.sessionName);
        if (liveTitle) {
          invalidateSessionListCache();
          return NextResponse.json({ title: liveTitle, usage: null });
        }
      } catch {
        // Fall through to the on-disk title.
      }
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found", code: "session_not_found" }, { status: 404 });
    }

    const info = scanSessionInfo(filePath, false);
    const storedTitle = sanitizeSessionTitle(info?.title);
    if (storedTitle) {
      return NextResponse.json({ title: storedTitle, usage: null });
    }

    const derived = deriveSessionTitleFromFirstMessage(info?.firstMessage);
    if (!derived) {
      return NextResponse.json(
        { error: "The session has no user messages to name", code: "session_no_messages_to_name" },
        { status: 409 },
      );
    }

    // Persist only when no live process owns the file; a running session will
    // title itself and would clobber our write on its next flush anyway.
    if (!running) {
      setSessionTitle(filePath, derived, "auto");
    }
    invalidateSessionListCache();
    return NextResponse.json({ title: derived, usage: null });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

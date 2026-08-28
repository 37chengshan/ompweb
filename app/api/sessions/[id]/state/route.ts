import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import { apiErrorResponse, resolveSessionPathOr404 } from "@/lib/api-utils";
import { isExternallyActive } from "@/lib/session-watcher";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    // A live process proves the session exists: omp does not create the session
    // file until the history holds an assistant message, so the path check
    // below would 404 a brand-new running session.
    const rpc = getRpcSession(id);
    if (rpc?.isAlive()) {
      try {
        const state = await rpc.send({ type: "get_state" }) as { isPromptRunning?: boolean; isStreaming?: boolean; isBashRunning?: boolean } | undefined;
        const externallyActive = (await isExternallyActive(id, 5000))
          && !state?.isPromptRunning && !state?.isStreaming && !state?.isBashRunning;
        if (externallyActive) {
          // The web-owned omp is idle but the session file keeps changing —
          // a terminal `omp` (or a harness) is writing it. Detach: report it
          // as externally running and let the file watcher drive updates,
          // instead of attaching a stale RPC stream that would silently miss
          // the external writes.
          return NextResponse.json({ running: true, external: true, state: null });
        }
        return NextResponse.json({ running: true, state });
      } catch {
        // RPC unavailable (e.g. the external CLI took over the session) —
        // fall through to file-based mode below.
      }
    }

    const resolved = await resolveSessionPathOr404(id);
    if ("response" in resolved) return resolved.response;
    const externallyActive = await isExternallyActive(id, 5000);
    return NextResponse.json({
      running: externallyActive,
      external: externallyActive,
      state: null,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

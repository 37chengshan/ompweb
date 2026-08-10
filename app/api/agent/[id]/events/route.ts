import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, resolveSpawnCwd, startRpcSession } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Fast path: already-running session. Otherwise only resolve the session file
  // here (cheap, and a miss must still answer 404); the omp spawn itself happens
  // inside the stream so it cannot race the client's connect timeout.
  const existing = getRpcSession(id);
  const alive = existing?.isAlive() ? existing : undefined;
  let filePath = "";
  if (!alive) {
    const resolved = await resolveSessionPath(id);
    if (!resolved) {
      return new Response("Session not found", { status: 404 });
    }
    filePath = resolved;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;

      const encode = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Heartbeat every 30s to prevent server/proxy timeout (Next.js default ~120-150s)
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          closed = true;
        }
      }, 30_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // controller already closed
        }
      };

      // Detect client disconnect via abort signal
      req.signal?.addEventListener("abort", cleanup);
      if (req.signal?.aborted) {
        cleanup();
        return;
      }

      // Announce the stream before starting omp: a cold spawn takes seconds
      // (extensions, LSP) and the client gives up waiting for `connected` long
      // before that. Commands sent right after this frame still block on the
      // same startRpcSession lock, so nothing runs against a missing process.
      encode({ type: "connected", sessionId: id });

      void (async () => {
        let session = alive;
        if (!session) {
          try {
            const cwd = resolveSpawnCwd(readSessionHeader(filePath)?.cwd);
            ({ session } = await startRpcSession(id, filePath, cwd));
          } catch (error) {
            encode({ type: "notice", level: "error", message: `Failed to start agent: ${error}` });
            cleanup();
            return;
          }
        }
        if (closed) return;
        unsubscribe = session.onEvent((event) => encode(event));
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

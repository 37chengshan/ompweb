import { getTerminalSession, subscribeToTerminal } from "@/lib/terminal-session-manager";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return new Response("Missing id parameter", { status: 400 });
  }

  const session = getTerminalSession(id);
  if (!session) {
    return new Response("Session not found or expired", { status: 404 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepAlive: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ sessionId: id, cwd: session.cwd })}\n\n`));

      // Idle SSE connections get dropped by proxies/dev servers; a periodic
      // comment frame keeps the stream alive so live output is never lost to
      // silent reconnects (browsers ignore ":" comment lines).
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          // Stream closed; the interval is cleared in cancel().
        }
      }, 15_000);

      unsubscribe = subscribeToTerminal(id, (chunk: string) => {
        try {
          const payload = JSON.stringify({ data: chunk });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch {
          // Stream might be closed
        }
      });
    },
    cancel() {
      if (keepAlive) {
        clearInterval(keepAlive);
        keepAlive = null;
      }
      if (unsubscribe) {
        unsubscribe();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

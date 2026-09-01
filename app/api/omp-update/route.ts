import { NextResponse } from "next/server";
import { checkOmpUpdate, runOmpUpdateNow } from "@/lib/omp/updates";
import { runOmpUpdateStream } from "@/lib/omp/updates";
import { restartAllRpcSessions } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: unknown; stream?: unknown };
    if (body.action === "check") return NextResponse.json(await checkOmpUpdate());
    if (body.action === "update") {
      if (body.stream === true) {
        const stream = new ReadableStream<string>({
          async start(controller) {
            const done = () => { try { controller.close(); } catch { /* already closed */ } };
            const fail = (error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);
              try { controller.enqueue(JSON.stringify({ type: "error", message }) + "\n"); } catch { /* closed */ }
              done();
            };
            try {
              await runOmpUpdateStream([], (line) => {
                try { controller.enqueue(JSON.stringify({ type: "out", text: line }) + "\n"); } catch { /* closed */ }
              });
              await restartAllRpcSessions();
              done();
            } catch (error) {
              fail(error);
            }
          },
        });
        return new NextResponse(stream, {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
          },
        });
      }
      const output = await runOmpUpdateNow();
      const sessionsRestarted = await restartAllRpcSessions();
      return NextResponse.json({ success: true, output: output.slice(-2000), sessionsRestarted });
    }
    if (body.action === "restart") {
      const sessionsRestarted = await restartAllRpcSessions();
      return NextResponse.json({ success: true, sessionsRestarted });
    }
    return NextResponse.json({ error: "action must be check or restart", code: "invalid_action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

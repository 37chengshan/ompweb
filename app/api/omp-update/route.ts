import { NextResponse } from "next/server";
import { checkOmpUpdate, runOmpUpdateNow } from "@/lib/omp/updates";
import { restartAllRpcSessions } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: unknown };
    if (body.action === "check") return NextResponse.json(await checkOmpUpdate());
    if (body.action === "update") {
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

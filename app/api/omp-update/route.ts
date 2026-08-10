import { NextResponse } from "next/server";
import { invalidateOmpCliCache } from "@/lib/omp/omp-cli";
import { checkOmpUpdate, installOmpUpdate } from "@/lib/omp/updates";
import { restartAllRpcSessions } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: unknown };
    if (body.action === "check") return NextResponse.json(await checkOmpUpdate());
    if (body.action === "update") {
      const output = await installOmpUpdate();
      invalidateOmpCliCache();
      return NextResponse.json({ success: true, output });
    }
    if (body.action === "restart") {
      const sessionsRestarted = await restartAllRpcSessions();
      return NextResponse.json({ success: true, sessionsRestarted });
    }
    return NextResponse.json({ error: "action must be check, update, or restart", code: "invalid_action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

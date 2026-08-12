import { NextResponse } from "next/server";
import { checkNpmUpdate, installNpmUpdate, readLastUpdateInfo } from "@/lib/npm-update";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";
  const status = await checkNpmUpdate(force);
  // Surface the last updater outcome so a restored app can explain why a
  // previous update attempt failed (see bin/omp-web-update.js).
  return NextResponse.json({ ...status, lastUpdate: readLastUpdateInfo() }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: unknown };
    if (body.action !== "update") {
      return NextResponse.json({ error: "action must be update", code: "invalid_action" }, { status: 400 });
    }
    // On success the updater takes over: this process schedules its own exit
    // shortly after responding, and the detached helper relaunches the app.
    // On failure this throws while the server is still healthy, so a bad
    // update can never take the app down.
    await installNpmUpdate();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

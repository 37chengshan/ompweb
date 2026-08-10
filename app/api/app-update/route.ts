import { NextResponse } from "next/server";
import { checkNpmUpdate, installNpmUpdate } from "@/lib/npm-update";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await checkNpmUpdate(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: unknown };
    if (body.action !== "update") {
      return NextResponse.json({ error: "action must be update", code: "invalid_action" }, { status: 400 });
    }
    await installNpmUpdate();
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

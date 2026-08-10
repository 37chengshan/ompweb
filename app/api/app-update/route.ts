import { NextResponse } from "next/server";
import { checkNpmUpdate, installNpmUpdate } from "@/lib/npm-update";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";
  return NextResponse.json(await checkNpmUpdate(force), {
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

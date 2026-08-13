import { NextResponse } from "next/server";
import { checkNpmUpdate } from "@/lib/npm-update";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";
  const status = await checkNpmUpdate(force);
  return NextResponse.json(status, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST() {
  return NextResponse.json(
    { error: "Automatic self-updating is disabled. Run the update command manually in your terminal.", code: "update_disabled" },
    { status: 400 }
  );
}

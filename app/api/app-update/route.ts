import { NextResponse } from "next/server";
import { checkNpmUpdate, runNpmUpdate } from "@/lib/npm-update";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";
  const status = await checkNpmUpdate(force);
  return NextResponse.json(status, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST() {
  try {
    const output = await runNpmUpdate();
    return NextResponse.json({
      success: true,
      output: output.slice(-2000),
      restartRequired: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error), code: "update_failed" },
      { status: 502 },
    );
  }
}

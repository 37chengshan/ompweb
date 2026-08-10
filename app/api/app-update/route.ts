import { NextResponse } from "next/server";
import { checkNpmUpdate } from "@/lib/npm-update";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await checkNpmUpdate(), {
    headers: { "Cache-Control": "no-store" },
  });
}

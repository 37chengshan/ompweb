import { NextResponse } from "next/server";
import { getUsageSummary } from "@/lib/usage-summary";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getUsageSummary());
  } catch {
    return NextResponse.json({ error: "usage summary unavailable", code: "usage_summary_unavailable" }, { status: 502 });
  }
}

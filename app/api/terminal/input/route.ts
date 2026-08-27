import { NextResponse } from "next/server";
import { writeToTerminal } from "@/lib/terminal-session-manager";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id, data } = body;

    if (!id || typeof data !== "string") {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const written = writeToTerminal(id, data);
    return NextResponse.json({ ok: written });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to write input";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

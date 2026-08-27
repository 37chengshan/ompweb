import { NextResponse } from "next/server";
import { createTerminalSession, closeTerminalSession } from "@/lib/terminal-session-manager";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id, cwd } = createTerminalSession(body?.cwd);
    return NextResponse.json({ ok: true, sessionId: id, cwd });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create terminal session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }
    const closed = closeTerminalSession(id);
    return NextResponse.json({ ok: closed });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to close terminal session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

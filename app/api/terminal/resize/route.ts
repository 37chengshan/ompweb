import { NextResponse } from "next/server";
import { resizeTerminal } from "@/lib/terminal-session-manager";

export const dynamic = "force-dynamic";

/** POST /api/terminal/resize  body: { id, cols, rows } — sync the PTY size. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id, cols, rows } = body as { id?: unknown; cols?: unknown; rows?: unknown };
    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    const c = Number(cols);
    const r = Number(rows);
    if (!Number.isFinite(c) || !Number.isFinite(r) || c < 2 || r < 1) {
      return NextResponse.json({ error: "Invalid cols/rows" }, { status: 400 });
    }
    const ok = resizeTerminal(id, Math.floor(c), Math.floor(r));
    return NextResponse.json({ ok });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to resize terminal";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

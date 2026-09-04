import { NextResponse } from "next/server";
import * as nodeManager from "@/lib/terminal-session-manager";
import * as hostManager from "@/lib/terminal-host-session";
import { rustBackendActive } from "@/lib/omp/host-client";

export const dynamic = "force-dynamic";

// Doc 16 route 8: backend-selected like the sibling terminal routes.
const manager = () => (rustBackendActive() ? hostManager : nodeManager);

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id, data } = body;

    if (!id || typeof data !== "string") {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const written = manager().writeToTerminal(id, data);
    return NextResponse.json({ ok: written });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to write input";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
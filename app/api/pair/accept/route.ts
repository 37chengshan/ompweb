import { NextResponse } from "next/server";
import { getPairingService } from "@/lib/remote-pairing-store";

export const dynamic = "force-dynamic";

/**
 * Exchange a one-time token for a paired-device cookie. The device is
 * registered with the User-Agent-derived name; the cookie is HttpOnly and
 * SameSite=Lax so gated /api requests from LAN/public hosts pass.
 */
export async function POST(request: Request) {
  let body: { token?: unknown; mobile?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body", code: "invalid_body" }, { status: 400 });
  }
  if (typeof body.token !== "string" || !body.token) {
    return NextResponse.json({ error: "token is required", code: "token_required" }, { status: 400 });
  }
  const service = getPairingService();
  const device = service.accept(body.token, request.headers.get("user-agent"), body.mobile === true);
  if (!device) {
    return NextResponse.json({ error: "invalid or expired token", code: "invalid_or_expired_token" }, { status: 403 });
  }
  const response = NextResponse.json({ device }, { status: 201 });
  response.cookies.set(service.getConfig().cookieName, device.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
  return response;
}

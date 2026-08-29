import { NextResponse } from "next/server";
import { getPairingService } from "@/lib/remote-pairing-store";
import { pairingBase } from "@/lib/remote-pairing";

export const dynamic = "force-dynamic";

/**
 * Issue (or refresh) a one-time pairing token. Any previous token is
 * immediately invalidated, so a refreshed QR kills the old link.
 * The returned URLs are derived from the request Host header so the QR
 * works for LAN IPs and public tunnels alike.
 */
export async function POST(request: Request) {
  const service = getPairingService();
  const { token, expiresAt } = service.issue();
  const base = pairingBase(request, service.getConfig().publicUrl);
  return NextResponse.json({
    token,
    expiresAt,
    qrData: `${base}/remote?token=${token}`,
    phoneUrl: `${base}/remote?token=${token}`,
    desktopUrl: base,
  });
}

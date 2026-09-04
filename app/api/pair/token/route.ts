import { NextResponse } from "next/server";
import { getPairingService } from "@/lib/remote-pairing-store";
import { pairingBase } from "@/lib/remote-pairing";
import { hostClient, rustBackendActive } from "@/lib/omp/host-client";

export const dynamic = "force-dynamic";

/**
 * Issue (or refresh) a one-time pairing token. Any previous token is
 * immediately invalidated, so a refreshed QR kills the old link.
 * The returned URLs are derived from the request Host header so the QR
 * works for LAN IPs and public tunnels alike.
 *
 * Doc 16 route 13: in Rust mode the token is issued by the Rust device
 * registry (single active token, consume-once, TTL); URL derivation stays
 * here (UI orchestration, not authority).
 */
export async function POST(request: Request) {
  const service = getPairingService();
  const issued = rustBackendActive()
    ? await hostClient.device.issue()
    : (() => { const { token, expiresAt } = service.issue(); return { token, expiresAt }; })();
  const base = pairingBase(request, service.getConfig().publicUrl);
  return NextResponse.json({
    token: issued.token,
    expiresAt: issued.expiresAt,
    qrData: `${base}/remote?token=${issued.token}`,
    phoneUrl: `${base}/remote?token=${issued.token}`,
    desktopUrl: base,
  });
}

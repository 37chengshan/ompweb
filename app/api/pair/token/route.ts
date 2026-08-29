import { networkInterfaces } from "os";
import { NextResponse } from "next/server";
import { getPairingService } from "@/lib/remote-pairing-store";

export const dynamic = "force-dynamic";

/**
 * Issue (or refresh) a one-time pairing token. Any previous token is
 * immediately invalidated, so a refreshed QR kills the old link.
 * The returned URLs are derived from the request Host header so the QR
 * works for LAN IPs and public tunnels alike.
 */
/** Host names / IP literals / ports are the only characters we reflect back
 *  into the pairing URL — anything else (CR/LF, path, scheme) is rejected so
 *  a crafted Host header cannot turn the QR into a phishing link. */
const HOST_RE = /^[A-Za-z0-9.:\-[\]]{1,255}$/;

const LOOPBACK_RE = /^127\.|^::1$|^\[::1\]$/;

/** First physical-NIC IPv4 address (skips loopback/link-local/virtuals). */
function lanAddress(): string | null {
  const seen = new Set<string>();
  for (const addrs of Object.values(networkInterfaces())) {
    for (const info of addrs ?? []) {
      if (info.family !== "IPv4" && (info.family as string | number) !== 4) continue;
      const addr = info.address;
      if (seen.has(addr)) continue;
      seen.add(addr);
      if (info.internal) continue;
      if (LOOPBACK_RE.test(addr)) continue;
      if (addr.startsWith("169.254.")) continue;
      return addr;
    }
  }
  return null;
}

/** The QR must be reachable from the phone. When the request came from
 *  localhost the Host header is useless (a phone scanning it would hit its
 *  own loopback), so fall back to the first accessible LAN address, then to
 *  the configured public URL. */
function pairingBase(request: Request, fallbackUrl: string | undefined): string {
  const rawHost = request.headers.get("host") ?? "";
  const host = HOST_RE.test(rawHost) ? rawHost : "";
  const scheme = request.headers.get("x-forwarded-proto") === "https" ? "https" : "http";
  const hostname = host.split(":")[0];
  const port = host.split(":")[1] ?? "30178";

  if (host && !LOOPBACK_RE.test(hostname) && hostname !== "localhost") {
    return `${scheme}://${host}`;
  }
  if (fallbackUrl) {
    return fallbackUrl.replace(/\/+$/, "");
  }
  const lan = lanAddress();
  if (lan) return `${scheme}://${lan}:${port}`;
  return `${scheme}://${host || "127.0.0.1"}`;
}

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

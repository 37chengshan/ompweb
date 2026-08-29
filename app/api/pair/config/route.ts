import { NextResponse } from "next/server";
import { getPairingService } from "@/lib/remote-pairing-store";
import type { PairingConfig } from "@/lib/remote-pairing";

export const dynamic = "force-dynamic";

const BOOL_KEYS = new Set(["requirePairingForLan", "autoTunnel", "mobileEnterToSend"] as const);
const NUM_KEYS = new Set(["tokenTtlMs", "offlineAfterMs", "maxDevices", "idleExpireMs"] as const);
const STRING_KEYS = new Set(["cookieName", "publicUrl"] as const);

function sanitizeConfig(raw: Record<string, unknown>): Partial<PairingConfig> {
  const out: Partial<PairingConfig> = {};
  for (const key of BOOL_KEYS) if (typeof raw[key] === "boolean") out[key] = raw[key];
  for (const key of NUM_KEYS) if (typeof raw[key] === "number" && Number.isFinite(raw[key])) out[key] = raw[key];
  for (const key of STRING_KEYS) if (typeof raw[key] === "string") out[key] = raw[key];
  return out;
}

export async function GET() {
  const service = getPairingService();
  const devices = service.listDevices().map((device) => ({ ...device, online: service.isOnline(device) }));
  return NextResponse.json({ devices, config: service.getConfig() });
}

export async function PUT(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid body", code: "invalid_body" }, { status: 400 });
  }
  const patch = sanitizeConfig(body);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no supported keys", code: "no_supported_keys" }, { status: 400 });
  }
  const service = getPairingService();
  service.updateConfig(patch);
  return NextResponse.json({ config: service.getConfig() });
}

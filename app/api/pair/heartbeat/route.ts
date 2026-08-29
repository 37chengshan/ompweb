import { NextResponse, type NextRequest } from "next/server";
import { getPairingService } from "@/lib/remote-pairing-store";

export const dynamic = "force-dynamic";

/** Presence heartbeat: refreshes the device's lastActiveAt from its cookie. */
export async function POST(request: NextRequest) {
  const service = getPairingService();
  const deviceId = request.cookies.get(service.getConfig().cookieName)?.value;
  if (!deviceId) {
    return NextResponse.json({ error: "not paired", code: "not_paired" }, { status: 401 });
  }
  const touched = service.touch(deviceId);
  return touched
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "unknown device", code: "unknown_device" }, { status: 401 });
}

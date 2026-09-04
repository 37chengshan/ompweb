import { NextResponse, type NextRequest } from "next/server";
import { getPairingService } from "@/lib/remote-pairing-store";
import { hostClient, rustBackendActive } from "@/lib/omp/host-client";
import { syncPairingMirror } from "@/lib/remote-pairing-mirror";

export const dynamic = "force-dynamic";

/** Presence heartbeat: refreshes the device's lastActiveAt from its cookie.
 *  Doc 16 route 13: presence lives in the Rust registry; the JSON mirror
 *  keeps the proxy pairing gate in sync. */
export async function POST(request: NextRequest) {
  const service = getPairingService();
  const deviceId = request.cookies.get(service.getConfig().cookieName)?.value;
  if (!deviceId) {
    return NextResponse.json({ error: "not paired", code: "not_paired" }, { status: 401 });
  }
  if (rustBackendActive()) {
    const { ok } = await hostClient.device.touch(deviceId);
    if (!ok) {
      return NextResponse.json({ error: "unknown device", code: "unknown_device" }, { status: 401 });
    }
    await syncPairingMirror();
    return NextResponse.json({ ok: true });
  }
  const touched = service.touch(deviceId);
  return touched
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "unknown device", code: "unknown_device" }, { status: 401 });
}
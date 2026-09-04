import { NextResponse } from "next/server";
import { getPairingService } from "@/lib/remote-pairing-store";
import { hostClient, rustBackendActive } from "@/lib/omp/host-client";
import { syncPairingMirror } from "@/lib/remote-pairing-mirror";

export const dynamic = "force-dynamic";

/** Revoke one device. Doc 16 route 13: revocation runs on the Rust registry. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    return NextResponse.json({ error: "invalid device id", code: "invalid_device_id" }, { status: 400 });
  }
  if (rustBackendActive()) {
    const { ok } = await hostClient.device.revoke(id);
    if (!ok) {
      return NextResponse.json({ error: "device not found", code: "device_not_found" }, { status: 404 });
    }
    await syncPairingMirror();
    return NextResponse.json({ success: true });
  }
  const removed = getPairingService().revoke(id);
  return removed
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: "device not found", code: "device_not_found" }, { status: 404 });
}
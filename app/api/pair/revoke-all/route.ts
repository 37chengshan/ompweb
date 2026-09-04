import { NextResponse } from "next/server";
import { getPairingService } from "@/lib/remote-pairing-store";
import { hostClient, rustBackendActive } from "@/lib/omp/host-client";
import { syncPairingMirror } from "@/lib/remote-pairing-mirror";

export const dynamic = "force-dynamic";

/** Revoke every paired device and clear the active token.
 *  Doc 16 route 13: revocation runs on the Rust registry. */
export async function POST() {
  if (rustBackendActive()) {
    await hostClient.device.revokeAll();
    await syncPairingMirror();
    getPairingService().stop();
    return NextResponse.json({ success: true });
  }
  getPairingService().stop();
  return NextResponse.json({ success: true });
}
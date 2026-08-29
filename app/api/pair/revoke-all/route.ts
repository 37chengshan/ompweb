import { NextResponse } from "next/server";
import { getPairingService } from "@/lib/remote-pairing-store";

export const dynamic = "force-dynamic";

/** Revoke every paired device and clear the active token. */
export async function POST() {
  getPairingService().stop();
  return NextResponse.json({ success: true });
}

import { NextResponse } from "next/server";
import { getPairingService } from "@/lib/remote-pairing-store";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    return NextResponse.json({ error: "invalid device id", code: "invalid_device_id" }, { status: 400 });
  }
  const removed = getPairingService().revoke(id);
  return removed
    ? NextResponse.json({ success: true })
    : NextResponse.json({ error: "device not found", code: "device_not_found" }, { status: 404 });
}

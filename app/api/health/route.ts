import { NextResponse } from "next/server";
import { getOmpVersion } from "@/lib/omp/omp-cli";
import pkg from "../../../package.json";

// Dedicated startup readiness endpoint (doc 14 T1.7 / S-4). The desktop main
// process polls THIS route — not the bare app URL — and only treats the
// server as ready when the body carries ok:true and the current app version.
// Any HTTP status (404/500), malformed body, or version mismatch stays
// not-ready, so navigation never lands on a half-initialized server.
export const dynamic = "force-dynamic";

export async function GET() {
  let ompVersion: string | null = null;
  try {
    ompVersion = await getOmpVersion();
  } catch {
    // Version probe failure is not fatal for readiness: the app can still
    // serve session browsing. The desktop log records ompReady=false.
  }
  return NextResponse.json({
    ok: true,
    app: pkg.version,
    ompReady: ompVersion !== null,
    ompVersion,
  });
}

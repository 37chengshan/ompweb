import { NextResponse, type NextRequest } from "next/server";
import { isApiRequestOriginAllowed, shouldCheckApiRequestOrigin } from "@/lib/request-security";
import { isValidWebSession, isWebPasswordEnabled, OMP_WEB_SESSION_COOKIE } from "@/lib/web-auth";
import { readFileSync } from "fs";
import { join } from "path";
import { isRemoteRequest } from "@/lib/remote-pairing";
import { getAgentDir } from "@/lib/omp/paths";

/**
 * Remote-access gate for /api/*: when pairing requires it, requests from a
 * non-loopback Host (LAN IP or public tunnel) must carry a valid
 * paired-device cookie — except the /api/pair/* endpoints themselves.
 *
 * The pairing state file is the source of truth (route handlers persist
 * atomically), so a fresh read per request avoids cross-worker staleness.
 * Device liveness is refreshed by /api/pair/heartbeat and paired-route
 * usage, not by this gate.
 */
function checkPairingGate(request: NextRequest): NextResponse | null {
  const host = request.headers.get("host");
  if (!isRemoteRequest(host)) return null;

  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/pair")) return null;

  let state: { config?: Record<string, unknown>; devices?: Array<{ id?: unknown; lastActiveAt?: unknown }> };
  try {
    state = JSON.parse(readFileSync(join(getAgentDir(), "remote-pairing.json"), "utf8")) as typeof state;
  } catch {
    // No state file: nothing can ever have been paired — deny remote access.
    return deny();
  }

  const rawConfig = state.config ?? {};
  if (rawConfig.requirePairingForLan !== true) return null;

  const cookieName = typeof rawConfig.cookieName === "string" ? rawConfig.cookieName : "dsh_pair";
  const deviceId = request.cookies.get(cookieName)?.value;
  if (!deviceId) return deny();

  const devices = Array.isArray(state.devices) ? state.devices : [];
  const device = devices.find((d) => d.id === deviceId);
  if (!device || typeof device.lastActiveAt !== "number") return deny();

  const idleExpireMs = typeof rawConfig.idleExpireMs === "number" ? rawConfig.idleExpireMs : 7 * 24 * 60 * 60 * 1000;
  if (Date.now() - device.lastActiveAt > idleExpireMs) return deny();

  return null;
}

function deny(): NextResponse {
  return NextResponse.json({ error: "Remote access requires a paired device", code: "pairing_required" }, { status: 401 });
}

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/") && shouldCheckApiRequestOrigin(request) && !isApiRequestOriginAllowed(request)) {
    return NextResponse.json({ error: "Cross-origin API requests are not allowed" }, { status: 403 });
  }
  const pairingDenied = checkPairingGate(request);
  if (pairingDenied) return pairingDenied;
  if (!isWebPasswordEnabled()) {
    return request.nextUrl.pathname === "/login"
      ? NextResponse.redirect(new URL("/", request.url))
      : NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const hasSession = isValidWebSession(request.cookies.get(OMP_WEB_SESSION_COOKIE)?.value);
  if (pathname === "/login") {
    return hasSession ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }
  if (pathname === "/api/web-auth/session") return NextResponse.next();
  if (hasSession) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Password required", code: "password_required" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

// The sign-in screen still needs its Next.js JavaScript and CSS before a
// session exists; these are public build assets, not workspace data.
export const config = { matcher: "/((?!_next/static|_next/image|favicon.ico).*)" };

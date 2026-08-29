import { NextResponse, type NextRequest } from "next/server";
import { isApiRequestOriginAllowed, shouldCheckApiRequestOrigin } from "@/lib/request-security";
import { isValidWebSession, isWebPasswordEnabled, OMP_WEB_SESSION_COOKIE } from "@/lib/web-auth";
import { readFileSync, statSync } from "fs";
import { join } from "path";
import { isRemoteRequest } from "@/lib/remote-pairing";
import { getAgentDir } from "@/lib/omp/paths";

/**
 * Remote-access gate for /api/*: when pairing requires it, requests from a
 * non-loopback Host (LAN IP or public tunnel) must carry a valid
 * paired-device cookie. Only the pairing FLOW itself is exempt — issuing
 * and consuming tokens — so an unpaired LAN attacker cannot reach
 * revoke-all, config (which could disable the gate), devices, or tunnel.
 */
const PAIRING_FLOW_PATHS = ["/api/pair/token", "/api/pair/accept"];

function isPairingFlowPath(pathname: string): boolean {
  return PAIRING_FLOW_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// The pairing file is small but the gate runs on every remote /api request;
// cache by mtime so the file is only read when it actually changed.
interface PairingFileState {
  config?: Record<string, unknown>;
  devices?: Array<{ id?: unknown; lastActiveAt?: unknown }>;
}

let pairingCache: { mtimeMs: number; state: PairingFileState } | null = null;

function readPairingState(): PairingFileState | null {
  const path = join(getAgentDir(), "remote-pairing.json");
  try {
    const mtimeMs = statSync(path).mtimeMs;
    if (pairingCache && pairingCache.mtimeMs === mtimeMs) return pairingCache.state;
    const state = JSON.parse(readFileSync(path, "utf8")) as PairingFileState;
    pairingCache = { mtimeMs, state };
    return state;
  } catch {
    pairingCache = null;
    return null;
  }
}

function checkPairingGate(request: NextRequest): NextResponse | null {
  const host = request.headers.get("host");
  if (!isRemoteRequest(host)) return null;

  const pathname = request.nextUrl.pathname;
  // Token ISSUANCE must stay loopback-only: the server now listens on
  // 0.0.0.0 (that is what makes LAN pairing possible), so without this a
  // LAN attacker could mint a token and pair themselves. The phone only
  // ever consumes tokens via /api/pair/accept, which stays reachable.
  if (pathname === "/api/pair/token") {
    return NextResponse.json({ error: "Pairing tokens can only be issued from this computer", code: "token_loopback_only" }, { status: 403 });
  }
  if (isPairingFlowPath(pathname)) return null;
  // The /remote landing page is part of the pairing FLOW itself (the phone
  // opens it from the QR and it performs the accept): it renders no data,
  // so it must stay reachable before any device is paired. Previously a
  // fresh phone hit this gate first and got a 401 JSON instead of the page.
  if (pathname === "/remote" || pathname.startsWith("/remote/")) return null;

  const state = readPairingState();
  if (!state) {
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
  // The pairing flow must stay reachable from a phone even when a web
  // password is enabled (the paired cookie is checked on every other
  // remote /api request; the password protects the session afterwards).
  // The /remote landing page performs the accept itself, so it is exempt
  // too; it renders no data.
  if (isPairingFlowPath(pathname) || pathname === "/remote") return NextResponse.next();
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

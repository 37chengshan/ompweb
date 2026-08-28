import { NextResponse } from "next/server";
import { detectProxy, readProxyConfig, saveProxyConfig, resolveEffectiveProxy } from "@/lib/proxy-config";

export const dynamic = "force-dynamic";

/**
 * GET /api/proxy — current config + live auto-detection (system proxy and
 *   common local ports). No secrets, pure reachability checks.
 * PUT /api/proxy — save { mode: "auto"|"manual"|"off", url? }.
 */
export async function GET() {
  const detection = await detectProxy();
  const effective = await resolveEffectiveProxy();
  return NextResponse.json({ config: readProxyConfig(), detection, effective });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({})) as { mode?: unknown; url?: unknown };
  const mode = body.mode;
  if (mode !== "auto" && mode !== "manual" && mode !== "off") {
    return NextResponse.json({ error: "mode must be auto|manual|off", code: "invalid_mode" }, { status: 400 });
  }
  if (mode === "manual") {
    if (typeof body.url !== "string" || !body.url.trim()) {
      return NextResponse.json({ error: "url required in manual mode", code: "missing_url" }, { status: 400 });
    }
    try {
      const parsed = new URL(body.url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol");
      if (!parsed.port) throw new Error("port");
    } catch {
      return NextResponse.json({ error: "url must be http(s)://host:port", code: "invalid_url" }, { status: 400 });
    }
  }
  const manualUrl = mode === "manual" && typeof body.url === "string" ? body.url.trim() : undefined;
  saveProxyConfig({ mode, url: manualUrl });
  const detection = await detectProxy();
  const effective = await resolveEffectiveProxy();
  return NextResponse.json({ ok: true, config: readProxyConfig(), detection, effective });
}
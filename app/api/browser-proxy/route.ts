import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_BROWSER_PREVIEW_BYTES = 2 * 1024 * 1024;

function validTarget(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Never forward credentials or non-web schemes through a server endpoint.
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url");
  const target = raw ? validTarget(raw) : null;
  if (!target) return NextResponse.json({ error: "A valid http(s) URL is required", code: "invalid_browser_url" }, { status: 400 });

  try {
    const response = await fetch(target, {
      headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.2" },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type") ?? "";
    const length = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(length) && length > MAX_BROWSER_PREVIEW_BYTES) {
      return NextResponse.json({ error: "Preview response is too large", code: "browser_preview_too_large" }, { status: 413 });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BROWSER_PREVIEW_BYTES) {
      return NextResponse.json({ error: "Preview response is too large", code: "browser_preview_too_large" }, { status: 413 });
    }
    const text = new TextDecoder().decode(bytes);
    return NextResponse.json({ html: text, finalUrl: response.url || target.toString(), contentType, status: response.status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), code: "browser_proxy_failed" }, { status: 502 });
  }
}

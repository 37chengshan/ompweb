import { NextResponse } from "next/server";
import { ProxyAgent, fetch as undiciFetch } from "undici";

export interface UpdateRelease {
  tagName: string;
  name: string;
  body: string;
  publishedAt: string | null;
}

let cachedProxyAgent: ProxyAgent | undefined;
function proxyDispatcher() {
  const url = process.env.OMP_WEB_PROXY_URL;
  if (!url) return undefined;
  if (!cachedProxyAgent) cachedProxyAgent = new ProxyAgent(url);
  return cachedProxyAgent;
}

/**
 * Proxy GitHub releases for the omp-web repo (37chengshan/ompweb).
 * Uses an explicit ProxyAgent so requests go through the configured proxy
 * (undici ignores system proxies). Latest 15 releases.
 */
export async function GET() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await undiciFetch("https://api.github.com/repos/37chengshan/ompweb/releases?per_page=15", {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "ompweb",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: controller.signal,
      dispatcher: proxyDispatcher(),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `GitHub API ${res.status}` }, { status: 502 });
    }
    const data = (await res.json()) as Array<{
      tag_name: string;
      name: string | null;
      body: string | null;
      published_at: string | null;
    }>;
    const releases: UpdateRelease[] = data.map((r) => ({
      tagName: r.tag_name,
      name: r.name ?? r.tag_name,
      body: r.body ?? "",
      publishedAt: r.published_at,
    }));
    return NextResponse.json({ releases });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

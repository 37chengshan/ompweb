import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { getPairingService } from "@/lib/remote-pairing-store";

export const dynamic = "force-dynamic";

const GLOBAL_KEY = "__ompWebTunnelChild__";

type GlobalWithTunnel = typeof globalThis & { [GLOBAL_KEY]?: ReturnType<typeof spawn> };

/**
 * Start/stop a cloudflared quick tunnel that exposes the local web UI on a
 * public trycloudflare.com URL. The assigned URL is read from the child's
 * stderr and returned once. A manually configured publicUrl in the pairing
 * config always wins over the tunnel.
 */
export async function POST(request: Request) {
  const g = globalThis as GlobalWithTunnel;
  const service = getPairingService();
  const config = service.getConfig();
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; port?: unknown };

  if (body.action === "stop") {
    g[GLOBAL_KEY]?.kill("SIGTERM");
    delete g[GLOBAL_KEY];
    return NextResponse.json({ running: false });
  }

  if (g[GLOBAL_KEY]) {
    return NextResponse.json({ error: "tunnel already running", code: "tunnel_running" }, { status: 409 });
  }

  // The dev server runs on 30178, CLI start on 30177 and the desktop app on
  // 30179 — the renderer knows its own origin, so it passes the real port.
  const requestedPort = typeof body.port === "number" ? String(body.port) : String(body.port ?? "").replace(/\D/g, "");
  const port = /^\d{2,5}$/.test(requestedPort) ? requestedPort : (process.env.PORT ?? "30178");
  const child = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  g[GLOBAL_KEY] = child;
  // Clear the stale handle when the tunnel dies so a later start attempt
  // does not hit a bogus "already running" 409.
  child.once("exit", () => {
    if (g[GLOBAL_KEY] === child) delete g[GLOBAL_KEY];
  });

  const url = await new Promise<string | null>((resolve) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buffer);
      if (match) {
        cleanup();
        resolve(match[0]);
      }
    };
    const onExit = () => {
      cleanup();
      resolve(null);
    };
    const cleanup = () => {
      child.stderr?.off("data", onData);
      child.stdout?.off("data", onData);
      child.off("exit", onExit);
    };
    child.stderr?.on("data", onData);
    child.stdout?.on("data", onData);
    child.once("exit", onExit);
    setTimeout(() => {
      cleanup();
      resolve(null);
    }, 20_000);
  });

  if (!url) {
    child.kill("SIGTERM");
    delete g[GLOBAL_KEY];
    return NextResponse.json(
      { error: "cloudflared did not report a tunnel URL (is it installed?)", code: "tunnel_failed" },
      { status: 502 },
    );
  }

  if (config.publicUrl) {
    return NextResponse.json({ url: config.publicUrl, manual: true });
  }
  return NextResponse.json({ url, manual: false });
}

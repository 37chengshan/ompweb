import { NextResponse } from "next/server";
import { resolveOmpBin, getOmpVersion } from "@/lib/omp/omp-cli";
import { readProxyConfig, resolveEffectiveProxy } from "@/lib/proxy-config";
import { getRpcSession } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

/**
 * GET /api/diagnostics — backend service health for the settings panel:
 * omp runtime, network proxy, RPC sessions, server identity.
 */
export async function GET() {
  const ompBin = resolveOmpBin();
  const ompVersion = await getOmpVersion();
  const proxyConfig = readProxyConfig();
  const effectiveProxy = await resolveEffectiveProxy();
  const rpcSessionCount = getRpcSessionIds().length;
  const activeRpc = rpcSessionCount;
  const webPort = process.env.OMP_WEB_PORT
    ?? process.env.PORT
    ?? (process.env.NODE_ENV === "production" ? "30177" : "30178");

  return NextResponse.json({
    server: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      uptimeSeconds: Math.round(process.uptime()),
    },
    omp: {
      installed: Boolean(ompBin),
      path: ompBin,
      version: ompVersion,
    },
    proxy: {
      config: proxyConfig,
      effective: effectiveProxy,
    },
    rpc: {
      activeSessions: activeRpc,
    },
    web: {
      port: webPort,
      url: `http://127.0.0.1:${webPort}`,
    },
  });
}

function getRpcSessionIds(): string[] {
  try {
    // rpc-manager keeps the registry private; expose via getRunningRpcSessionIds.
    return getRunningRpcSessionIds();
  } catch {
    return [];
  }
}

// Import lazily to avoid circular imports at module load.
import { getRunningRpcSessionIds } from "@/lib/rpc-manager";

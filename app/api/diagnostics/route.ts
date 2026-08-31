import { NextResponse } from "next/server";
import { resolveOmpBin, getOmpVersion } from "@/lib/omp/omp-cli";
import { readProxyConfig, resolveEffectiveProxy } from "@/lib/proxy-config";
import { getRpcSession } from "@/lib/rpc-manager";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import YAML from "yaml";

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

  // Installer dependency probes (ompSetup): which download/exec tools exist on
  // this host. The wizard uses these to suggest alternatives when e.g. curl
  // is absent. Never blocks: a probe failure simply marks the tool missing.
  const tools = {
    curl: hasTool("curl"),
    wget: hasTool("wget"),
    powershell: hasTool("powershell") || hasTool("pwsh"),
    bun: hasTool("bun"),
    node: hasTool("node"),
  };

  return NextResponse.json({
    server: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      uptimeSeconds: Math.round(process.uptime()),
      tools,
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
    // Backend Ownership dashboard (doc 15 / v4 P40): per-domain authority so
    // development/testing can see at a glance what has migrated to Rust.
    backendOwnership: getBackendOwnership(),
  });
}

function hasTool(name: string): boolean {
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    execFileSync(cmd, [name], { stdio: "ignore", timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

function getBackendOwnership(): Record<string, string> {
  try {
    const raw = readFileSync(join(process.cwd(), "backend-ownership.yaml"), "utf8");
    const doc = YAML.parse(raw);
    const domains: Record<string, string> = {};
    if (doc && typeof doc === "object" && "domains" in doc && doc.domains && typeof doc.domains === "object") {
      for (const [name, entry] of Object.entries(doc.domains)) {
        if (entry && typeof entry === "object" && "authority" in entry) {
          const authority = entry.authority;
          domains[name] = typeof authority === "string" ? authority : "unknown";
        } else {
          domains[name] = "unknown";
        }
      }
    }
    return domains;
  } catch {
    return {};
  }
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

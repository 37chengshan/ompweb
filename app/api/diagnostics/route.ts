import { NextResponse } from "next/server";
import { resolveOmpBin, getOmpVersion } from "@/lib/omp/omp-cli";
import { readProxyConfig, resolveEffectiveProxy } from "@/lib/proxy-config";
import { recentRpcFailures } from "@/lib/rpc-manager";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { listOrphanRustHosts } from "@/lib/omp/rust-rpc-process";
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
  const webPort = process.env.OMP_WEB_PORT ?? process.env.OMP_WEB_APP_PORT
    ?? process.env.PORT
    ?? (process.env.NODE_ENV === "production" ? "30177" : "30178");

  // RPC 健康信号：最近 60s 内的 omp 子进程异常退出 / 会话分裂——这些直接
  // 导致"消息发不出去"，必须纳入健康判断（仅看 omp 是否安装是不够的）。
  const recentFailures = recentRpcFailures(60_000);
  const orphanRustHostPids = listOrphanRustHosts();

  // 其他 ompweb 实例探测：旧实例（残留的开发服务/旧 app）会持有会话锁、
  // 扰乱 --resume，是"服务异常但健康显示正常"的主要来源。扫描本机常见端口。
  const selfPort = Number(webPort);
  const otherInstances: Array<{ port: number; alive: boolean }> = [];
  // Include the historical dev port as well: an old `next-server` on 30180
  // can still hold session locks even though the current App runs on 30179.
  for (const port of [30177, 30178, 30179, 30180]) {
    if (port === selfPort) continue;
    // eslint-disable-next-line no-await-in-loop
    otherInstances.push({ port, alive: await probeOmpWebPort(port) });
  }

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
      recentFailures: recentFailures.map((f) => f.detail),
      orphanRustHosts: orphanRustHostPids.length,
    },
    instances: {
      selfPort,
      others: otherInstances.filter((instance) => instance.alive).map((instance) => instance.port),
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

/** 探测本机另一端口上是否有 ompweb 服务（快速 GET，1s 超时）。 */
async function probeOmpWebPort(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/diagnostics`, { signal: controller.signal });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
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

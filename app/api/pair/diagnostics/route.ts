import { execFile } from "child_process";
import { networkInterfaces } from "os";
import { NextResponse } from "next/server";
import { isRemoteRequest } from "@/lib/remote-pairing";

export const dynamic = "force-dynamic";

const LOOPBACK_RE = /^127\.|^::1$|^\[::1\]$/;
const VIRTUAL_IFACE_RE = /vEthernet|VirtualBox|VMware|vboxnet|tap\d|tun\d|docker|tailscale|zerotier|virbr/i;

function allLanAddresses(): Array<{ name: string; address: string }> {
  const out: Array<{ name: string; address: string }> = [];
  const seen = new Set<string>();
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const info of addrs ?? []) {
      if (info.family !== "IPv4" && (info.family as string | number) !== 4) continue;
      const addr = info.address;
      if (seen.has(addr)) continue;
      seen.add(addr);
      if (info.internal) continue;
      if (LOOPBACK_RE.test(addr) || addr.startsWith("169.254.")) continue;
      out.push({ name: name || "unknown", address: addr });
    }
  }
  return out;
}

/** Check whether a Windows firewall rule for the given port exists. */
function firewallRuleExists(port: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("netsh", ["advfirewall", "firewall", "show", "rule", `name=OmpWeb-${port}`], {
      timeout: 8000,
      windowsHide: true,
    }, (error) => resolve(!error));
  });
}

/**
 * Pairing diagnostics for the desktop host: which addresses/port the phone
 * should reach, whether the server is listening, and (Windows) whether a
 * firewall rule exists. Loopback-only — remote hosts get 403.
 */
export async function GET(request: Request) {
  const host = request.headers.get("host") ?? "";
  if (isRemoteRequest(host)) {
    return NextResponse.json({ error: "diagnostics are loopback-only", code: "loopback_only" }, { status: 403 });
  }

  // The launcher injects OMP_WEB_PORT (bin/omp-web.js); next dev/start get
  // the port via -p, so PORT is only set when the host exported it. Prefer
  // OMP_WEB_PORT or the port would be wrong for CLI installs (30177).
  const port = process.env.OMP_WEB_PORT ?? process.env.PORT ?? "30178";
  // The bind hostname is only known when the ompweb launcher set it; a null
  // hostname (plain next dev/start) means the UI cannot infer the binding.
  const hostname = process.env.OMP_WEB_HOSTNAME ?? null;
  const lanAddresses = allLanAddresses();
  const virtualAddresses = lanAddresses.filter(({ name }) => VIRTUAL_IFACE_RE.test(name));
  const physicalAddresses = lanAddresses.filter(({ name }) => !VIRTUAL_IFACE_RE.test(name));
  const firewallRule = process.platform === "win32" ? await firewallRuleExists(port) : null;

  return NextResponse.json({
    port,
    hostname,
    serverListening: true, // this handler only runs when the server is up
    lanAddresses,
    physicalAddresses,
    virtualAddresses,
    firewallRuleExists: firewallRule,
    platform: process.platform,
  });
}

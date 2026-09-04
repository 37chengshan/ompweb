import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import net from "net";

/**
 * Network proxy configuration for omp-web. Without TUN mode, neither Node's
 * fetch (undici) nor Bun's fetch (used by the omp child) picks up the system
 * proxy automatically — so the app can auto-detect a local proxy (e.g.
 * Clash on 127.0.0.1:7890) or accept a manual one, and injects it into the
 * omp child env and the GitHub API client.
 */

export type ProxyMode = "auto" | "manual" | "off";

export interface ProxyConfig {
  mode: ProxyMode;
  /** Manual proxy URL, e.g. http://127.0.0.1:7890. */
  url?: string;
}

export interface ProxyDetection {
  /** Proxies found on the system (auto-detection). */
  candidates: Array<{ url: string; source: string }>;
  /** The best candidate (system HTTP(S) proxy, else first reachable). */
  recommended: string | null;
  /** Manual proxy actually reachable, if any. */
  manualReachable: boolean;
}

const CONFIG_PATH = join(homedir(), ".omp", "agent", "proxy.json");
const COMMON_PORTS = [7890, 7897, 1087, 1080, 8118, 8888];

export function readProxyConfig(): ProxyConfig {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<ProxyConfig>;
    if (raw.mode === "auto" || raw.mode === "manual" || raw.mode === "off") {
      return { mode: raw.mode, url: typeof raw.url === "string" ? raw.url : undefined };
    }
  } catch {
    // Missing/corrupt — default to auto-detect.
  }
  return { mode: "auto" };
}

export function saveProxyConfig(config: ProxyConfig): void {
  const file = CONFIG_PATH;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n");
  renameSync(tmp, file);
}

function isPortOpen(port: number, host = "127.0.0.1", timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

function readSystemProxy(): Array<{ url: string; source: string }> {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      // macOS: scutil --proxy (system network settings)
      const out = execFileSync("scutil", ["--proxy"], { encoding: "utf8", timeout: 3000 });
      const entries: Array<{ url: string; source: string }> = [];
      const httpHost = /HTTPProxy\s*:\s*(\S+)/.exec(out)?.[1];
      const httpPort = /HTTPPort\s*:\s*(\d+)/.exec(out)?.[1];
      const httpsHost = /HTTPSProxy\s*:\s*(\S+)/.exec(out)?.[1];
      const httpsPort = /HTTPSPort\s*:\s*(\d+)/.exec(out)?.[1];
      if (httpHost && httpPort) entries.push({ url: `http://${httpHost}:${httpPort}`, source: "system-http" });
      if (httpsHost && httpsPort) entries.push({ url: `http://${httpsHost}:${httpsPort}`, source: "system-https" });
      return entries;
    }
    if (platform === "win32") {
      // Windows: HKCU Internet Settings (ProxyEnable + ProxyServer)
      const out = execFileSync("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"], { encoding: "utf8", timeout: 3000 });
      const enabled = /ProxyEnable\s+REG_DWORD\s+0x(\d+)/i.exec(out)?.[1];
      if (enabled === "1") {
        const server = /ProxyServer\s+REG_SZ\s+(\S+)/i.exec(out)?.[1];
        if (server) {
          const url = /^https?:\/\//i.test(server) ? server : `http://${server}`;
          return [{ url, source: "system-proxy" }];
        }
      }
      return [];
    }
    if (platform === "linux") {
      // Linux: env vars first (most portable), then GNOME gsettings.
      const entries: Array<{ url: string; source: string }> = [];
      for (const key of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]) {
        const value = process.env[key];
        if (value) {
          const url = /^https?:\/\//i.test(value) ? value : `http://${value}`;
          if (!entries.some((e) => e.url === url)) entries.push({ url, source: "env" });
        }
      }
      try {
        const mode = execFileSync("gsettings", ["get", "org.gnome.system.proxy", "mode"], { encoding: "utf8", timeout: 2000 }).trim();
        if (mode === "'manual'") {
          const host = execFileSync("gsettings", ["get", "org.gnome.system.proxy.http", "host"], { encoding: "utf8", timeout: 2000 }).trim().replace(/^'|'$/g, "");
          const port = execFileSync("gsettings", ["get", "org.gnome.system.proxy.http", "port"], { encoding: "utf8", timeout: 2000 }).trim();
          if (host && port) entries.push({ url: `http://${host}:${port}`, source: "gnome" });
        }
      } catch {
        // gsettings not available — env is enough.
      }
      return entries;
    }
  } catch {
    // Fall through.
  }
  return [];
}

/** Auto-detect a local proxy: system proxy first, then common local ports. */
export async function detectProxy(): Promise<ProxyDetection> {
  const candidates: Array<{ url: string; source: string }> = [];
  const systemEntries = readSystemProxy();
  const systemResults = await Promise.all(systemEntries.map(async (entry) =>
    (await isPortOpen(Number(new URL(entry.url).port))) ? entry : null,
  ));
  candidates.push(...systemResults.filter((entry): entry is { url: string; source: string } => entry !== null));
  const localResults = await Promise.all(COMMON_PORTS.map(async (port) =>
    (await isPortOpen(port)) ? `http://127.0.0.1:${port}` : null,
  ));
  for (const url of localResults) {
    if (url && !candidates.some((c) => c.url === url)) candidates.push({ url, source: "local-port" });
  }
  const manual = readProxyConfig();
  let manualReachable = false;
  if (manual.mode === "manual" && manual.url) {
    try {
      const port = Number(new URL(manual.url).port);
      manualReachable = await isPortOpen(port, new URL(manual.url).hostname);
    } catch {
      manualReachable = false;
    }
  }
  const recommended = candidates[0]?.url ?? (manualReachable && manual.url ? manual.url : null);
  return { candidates, recommended, manualReachable };
}

/** Effective proxy URL for the current config (null = no proxy). */
export async function resolveEffectiveProxy(): Promise<string | null> {
  const config = readProxyConfig();
  if (config.mode === "off") return null;
  if (config.mode === "manual") {
    if (!config.url) return null;
    try {
      const port = Number(new URL(config.url).port);
      return (await isPortOpen(port, new URL(config.url).hostname)) ? config.url : null;
    } catch {
      return null;
    }
  }
  const detected = await detectProxy();
  return detected.recommended;
}

/** Proxy env vars to inject into child processes (omp, scripts, terminals). */
export function proxyEnv(url: string | null): Record<string, string> {
  if (!url) return {};
  return { HTTP_PROXY: url, HTTPS_PROXY: url, ALL_PROXY: url, http_proxy: url, https_proxy: url, all_proxy: url };
}

/** Undici-compatible proxy dispatcher env marker (GitHub client reads this). */
export function proxyEnvForFetch(url: string | null): { OMP_WEB_PROXY_URL?: string } {
  return url ? { OMP_WEB_PROXY_URL: url } : {};
}

/**
 * Remote-access pairing state machine for omp-web, re-implemented from the
 * semantics of @linxin666/dsh-remote-web-ui (which is Cordis-coupled):
 * one active one-time token, a device-session table, presence tracking.
 *
 * Security invariants (mirror the plugin):
 * - One active token at a time; issue() replaces it, so a refreshed QR
 *   immediately invalidates the previous link.
 * - A token is consumed by the first successful accept() — reuse refused.
 * - Tokens expire; accept() on an expired token is refused like an unknown
 *   one (no validity oracle).
 * - stop() revokes every device session and clears the token.
 * - revoke() drops one session; idle sessions older than idleExpireMs are
 *   deleted on sweep/load/next gated request.
 * - Device id is a random 128-bit hex; the device name is inferred from the
 *   User-Agent and never rendered raw.
 */
import { randomBytes } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";
import { isRecord } from "./type-guards";

export const DEFAULT_IDLE_EXPIRE_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_TOKEN_TTL_MS = 600_000;
export const DEFAULT_MAX_DEVICES = 4;
export const DEFAULT_OFFLINE_AFTER_MS = 25_000;
const MAX_USER_AGENT_CHARS = 180;

export interface PairingConfig {
  tokenTtlMs: number;
  offlineAfterMs: number;
  maxDevices: number;
  idleExpireMs: number;
  /** Cookie name carrying the paired-device id. */
  cookieName: string;
  /** When true, non-loopback /api requests require a paired cookie. */
  requirePairingForLan: boolean;
  /** Manual public URL (e.g. Cloudflare Tunnel). Empty = LAN only. */
  publicUrl?: string;
  /** Auto-start cloudflared quick tunnel. */
  autoTunnel: boolean;
  mobileEnterToSend: boolean;
}

export const DEFAULT_PAIRING_CONFIG: PairingConfig = {
  tokenTtlMs: DEFAULT_TOKEN_TTL_MS,
  offlineAfterMs: DEFAULT_OFFLINE_AFTER_MS,
  maxDevices: DEFAULT_MAX_DEVICES,
  idleExpireMs: DEFAULT_IDLE_EXPIRE_MS,
  cookieName: "dsh_pair",
  requirePairingForLan: true,
  autoTunnel: false,
  mobileEnterToSend: false,
};

export interface PairedDevice {
  id: string;
  name: string;
  pairedAt: number;
  lastActiveAt: number;
  /** Raw UA is stored truncated for diagnostics only; never rendered. */
  userAgent?: string;
  /** True when the device was paired from a mobile surface. */
  mobile: boolean;
}

export interface PairingSnapshot {
  token: { value: string; expiresAt: number } | null;
  devices: PairedDevice[];
}

export interface PairingStore {
  now: () => number;
  randomToken: () => string;
}

export const defaultClock: PairingStore = {
  now: () => Date.now(),
  randomToken: () => randomBytes(16).toString("hex"),
};

/** Infer a short device name from the User-Agent. */
export function deviceNameFromUserAgent(userAgent: string | null | undefined, mobile: boolean): string {
  const ua = (userAgent ?? "").slice(0, MAX_USER_AGENT_CHARS);
  if (mobile) return "Phone";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Macintosh|Mac OS/i.test(ua)) return "Mac";
  if (/Linux/i.test(ua)) return "Linux PC";
  if (/iPhone|iPad|Android/i.test(ua)) return "Phone";
  return "Paired device";
}

export class PairingService {
  private config: PairingConfig;
  private store: PairingStore;
  private tokens = new Map<string, number>(); // token -> expiresAt
  private devices = new Map<string, PairedDevice>();
  private persistPath: string | null = null;
  private stopped = false;
  private tokenSerial = 0;

  constructor(config: Partial<PairingConfig> = {}, store: PairingStore = defaultClock, persistPath: string | null = null) {
    this.config = { ...DEFAULT_PAIRING_CONFIG, ...config };
    this.store = store;
    this.persistPath = persistPath;
    if (persistPath && existsSync(persistPath)) this.load();
  }

  private load(): void {
    try {
      const data = JSON.parse(readFileSync(this.persistPath!, "utf8")) as unknown;
      if (!isRecord(data)) return;
      if (isRecord(data.config)) {
        this.config = { ...this.config, ...pickPairingConfig(data.config) };
      }
      if (isRecord(data.token) && typeof data.token.value === "string" && typeof data.token.expiresAt === "number") {
        if (data.token.expiresAt > this.store.now()) {
          this.tokens.set(data.token.value, data.token.expiresAt);
        }
      }
      if (Array.isArray(data.devices)) {
        for (const raw of data.devices) {
          if (!isRecord(raw) || typeof raw.id !== "string") continue;
          const device: PairedDevice = {
            id: raw.id,
            name: typeof raw.name === "string" ? raw.name : "Paired device",
            pairedAt: typeof raw.pairedAt === "number" ? raw.pairedAt : this.store.now(),
            lastActiveAt: typeof raw.lastActiveAt === "number" ? raw.lastActiveAt : this.store.now(),
            ...(typeof raw.userAgent === "string" ? { userAgent: raw.userAgent } : {}),
            mobile: raw.mobile === true,
          };
          this.devices.set(device.id, device);
        }
      }
      this.sweep();
    } catch {
      // Corrupt store: start empty.
    }
  }

  private persist(): void {
    if (!this.persistPath) return;
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      const tmp = `${this.persistPath}.tmp`;
      writeFileSync(tmp, JSON.stringify({ config: this.config, token: this.activeToken(), devices: [...this.devices.values()] }));
      renameSync(tmp, this.persistPath);
    } catch {
      // Best effort; in-memory state remains authoritative.
    }
  }

  updateConfig(patch: Partial<PairingConfig>): PairingConfig {
    this.config = { ...this.config, ...patch };
    this.persist();
    return this.config;
  }

  getConfig(): PairingConfig {
    return { ...this.config };
  }

  /** Issue a fresh one-time token, invalidating any previous one. */
  issue(): { token: string; expiresAt: number } {
    const now = this.store.now();
    const value = `${this.store.randomToken()}${this.tokenSerial++}`;
    const expiresAt = now + this.config.tokenTtlMs;
    this.tokens.clear();
    this.tokens.set(value, expiresAt);
    this.persist();
    return { token: value, expiresAt };
  }

  /** Consume a token; returns the paired device or null on any refusal. */
  accept(token: string, userAgent: string | null, mobile: boolean): PairedDevice | null {
    const now = this.store.now();
    const expiresAt = this.tokens.get(token);
    if (expiresAt === undefined || expiresAt < now) return null; // unknown/expired/used
    this.tokens.delete(token);
    const device: PairedDevice = {
      id: this.store.randomToken(),
      name: deviceNameFromUserAgent(userAgent, mobile),
      pairedAt: now,
      lastActiveAt: now,
      ...(userAgent ? { userAgent: userAgent.slice(0, MAX_USER_AGENT_CHARS) } : {}),
      mobile,
    };
    this.devices.set(device.id, device);
    // Enforce the cap AFTER inserting so the newest device survives.
    this.sweepDevices(now);
    this.persist();
    return device;
  }

  /** Mark a paired device active (heartbeat / gated request). */
  touch(deviceId: string): boolean {
    const device = this.devices.get(deviceId);
    if (!device) return false;
    device.lastActiveAt = this.store.now();
    this.sweepDevices(device.lastActiveAt);
    return this.devices.has(deviceId);
  }

  revoke(deviceId: string): boolean {
    const removed = this.devices.delete(deviceId);
    if (removed) this.persist();
    return removed;
  }

  /** Revoke every device and clear the token (Stop). */
  stop(): void {
    this.tokens.clear();
    this.devices.clear();
    this.stopped = true;
    this.persist();
  }

  isStopped(): boolean {
    return this.stopped;
  }

  getDevice(deviceId: string): PairedDevice | null {
    const device = this.devices.get(deviceId);
    if (!device) return null;
    // Idle expiry enforced on read, like the plugin's next-gated-request rule.
    const now = this.store.now();
    if (now - device.lastActiveAt > this.config.idleExpireMs) {
      this.devices.delete(deviceId);
      this.persist();
      return null;
    }
    return { ...device };
  }

  listDevices(): PairedDevice[] {
    this.sweep();
    return [...this.devices.values()].map((d) => ({ ...d }));
  }

  isOnline(device: PairedDevice): boolean {
    return this.store.now() - device.lastActiveAt <= this.config.offlineAfterMs;
  }

  activeToken(): { value: string; expiresAt: number } | null {
    const now = this.store.now();
    for (const [value, expiresAt] of this.tokens) {
      if (expiresAt >= now) return { value, expiresAt };
      this.tokens.delete(value);
    }
    return null;
  }

  private sweep(): void {
    const now = this.store.now();
    this.sweepDevices(now);
    for (const [value, expiresAt] of this.tokens) {
      if (expiresAt < now) this.tokens.delete(value);
    }
  }

  /** Enforce max-device cap (drop oldest) and idle expiry. */
  private sweepDevices(now: number): void {
    const idleExpired: string[] = [];
    for (const [id, device] of this.devices) {
      if (now - device.lastActiveAt > this.config.idleExpireMs) idleExpired.push(id);
    }
    for (const id of idleExpired) this.devices.delete(id);
    if (this.devices.size > this.config.maxDevices) {
      const sorted = [...this.devices.values()].sort((a, b) => a.lastActiveAt - b.lastActiveAt);
      for (const device of sorted.slice(0, sorted.length - this.config.maxDevices)) {
        this.devices.delete(device.id);
      }
    }
  }
}

/** Adopt only known PairingConfig keys from untrusted JSON. */
function pickPairingConfig(raw: Record<string, unknown>): Partial<PairingConfig> {
  const out: Partial<PairingConfig> = {};
  if (typeof raw.tokenTtlMs === "number") out.tokenTtlMs = raw.tokenTtlMs;
  if (typeof raw.offlineAfterMs === "number") out.offlineAfterMs = raw.offlineAfterMs;
  if (typeof raw.maxDevices === "number") out.maxDevices = raw.maxDevices;
  if (typeof raw.idleExpireMs === "number") out.idleExpireMs = raw.idleExpireMs;
  if (typeof raw.cookieName === "string") out.cookieName = raw.cookieName;
  if (typeof raw.requirePairingForLan === "boolean") out.requirePairingForLan = raw.requirePairingForLan;
  if (typeof raw.publicUrl === "string") out.publicUrl = raw.publicUrl;
  if (typeof raw.autoTunnel === "boolean") out.autoTunnel = raw.autoTunnel;
  if (typeof raw.mobileEnterToSend === "boolean") out.mobileEnterToSend = raw.mobileEnterToSend;
  return out;
}

/** True when the request came from a non-loopback host (LAN/public). */
export function isRemoteRequest(host: string | null | undefined): boolean {
  if (!host) return false;
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.startsWith("localhost:")) return false;
  const hostname = lower.split(":")[0];
  if (hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]") return false;
  return true;
}

// ---------------------------------------------------------------------------
// QR base-URL derivation (shared with app/api/pair/token/route.ts).
// ---------------------------------------------------------------------------

/** Host names / IP literals / ports are the only characters reflected into
 *  a pairing URL — anything else (CR/LF, path, scheme) is rejected so a
 *  crafted Host header cannot turn the QR into a phishing link. */
export const PAIRING_HOST_RE = /^[A-Za-z0-9.:\-[\]]{1,255}$/;

export const PAIRING_LOOPBACK_RE = /^127\.|^::1$|^\[::1\]$/;

/** Virtual adapters whose addresses a phone can never reach (WSL/Hyper-V
 *  vEthernet, VirtualBox/VMware host-only, Docker, Tailscale, ZeroTier...).
 *  Mirrors bin/network-addresses.js isVirtualBridge. */
const VIRTUAL_IFACE_RE = /vEthernet|VirtualBox|VMware|vboxnet|tap\d|tun\d|docker|tailscale|zerotier|virbr/i;

type NetIfaces = Record<string, Array<{ address: string; family: string | number; internal?: boolean }>>;

/** First physical-NIC IPv4 address (skips loopback/link-local/virtuals). */
export function lanAddress(interfaces: NetIfaces = networkInterfaces0()): string | null {
  const seen = new Set<string>();
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (VIRTUAL_IFACE_RE.test(name)) continue;
    for (const info of addrs ?? []) {
      if (info.family !== "IPv4" && (info.family as string | number) !== 4) continue;
      const addr = info.address;
      if (seen.has(addr)) continue;
      seen.add(addr);
      if (info.internal) continue;
      if (PAIRING_LOOPBACK_RE.test(addr)) continue;
      if (addr.startsWith("169.254.")) continue;
      return addr;
    }
  }
  return null;
}

function networkInterfaces0(): NetIfaces {
  // Injected lazily so tests can pass fixtures without the os module.
  return require("os").networkInterfaces() as NetIfaces;
}

/** The QR base URL must be reachable from the phone. A request coming from
 *  localhost advertises a LAN address (or the configured public URL); a
 *  request that already arrived over the LAN/public host keeps its Host. */
export function pairingBase(
  request: { headers: { get(name: string): string | null } },
  fallbackUrl: string | undefined,
  portFallback = "30178",
): string {
  const rawHost = request.headers.get("host") ?? "";
  const host = PAIRING_HOST_RE.test(rawHost) ? rawHost : "";
  const scheme = request.headers.get("x-forwarded-proto") === "https" ? "https" : "http";
  const hostname = host.split(":")[0];
  const port = host.split(":")[1] ?? portFallback;

  if (host && !PAIRING_LOOPBACK_RE.test(hostname) && hostname !== "localhost") {
    return `${scheme}://${host}`;
  }
  if (fallbackUrl) {
    return fallbackUrl.replace(/\/+$/, "");
  }
  const lan = lanAddress();
  if (lan) return `${scheme}://${lan}:${port}`;
  return `${scheme}://${host || "127.0.0.1"}`;
}

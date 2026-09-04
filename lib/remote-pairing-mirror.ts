/**
 * Legacy pairing-JSON mirror (doc 16 route 13 transition).
 *
 * The device registry authority now lives in the Rust host (device.* IPC);
 * the OS-level pairing gate in proxy.ts still reads ~/.omp/agent/remote-pairing.json
 * (mtime-cached). After every host-side device mutation this module rewrites
 * that JSON as an adapter mirror so the gate keeps working without changing
 * the HTTP surface. Config values (cookieName / publicUrl / ...) are read
 * from the existing JSON and preserved.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "./omp/paths";
import { hostClient } from "./omp/host-client";

const MIRROR_PATH = () => join(getAgentDir(), "remote-pairing.json");

interface PairingJsonShape {
  config?: Record<string, unknown>;
  token?: { value?: string; expiresAt?: number } | null;
  devices?: Array<{ id: string; name: string; pairedAt: number; lastActiveAt: number; userAgent?: string; mobile?: boolean }>;
}

function readExisting(): PairingJsonShape {
  try {
    const parsed = JSON.parse(readFileSync(MIRROR_PATH(), "utf8")) as PairingJsonShape;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Best-effort: rewrite the mirror from the host registry. Never throws —
 * the gate falls back to deny on a missing file, which is the safe side. */
export async function syncPairingMirror(): Promise<void> {
  try {
    const existing = readExisting();
    const devices = await hostClient.device.list();
    const next: PairingJsonShape = {
      config: existing.config,
      token: null,
      devices: devices.map((device) => ({
        id: device.id,
        name: device.name,
        pairedAt: device.pairedAt,
        lastActiveAt: device.lastActiveAt,
        mobile: device.platform === "mobile",
      })),
    };
    const path = MIRROR_PATH();
    const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(temp, JSON.stringify(next, null, 2), "utf8");
    renameSync(temp, path);
  } catch (error) {
    console.warn("[pairing-mirror] sync failed (gate will deny remote requests):", error instanceof Error ? error.message : error);
  }
}

export { existsSync as mirrorExists };
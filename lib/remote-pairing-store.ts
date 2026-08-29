/**
 * Process-wide singleton for the remote-access pairing service. Uses
 * globalThis so the state survives Next.js hot reloads (same pattern as
 * lib/rpc-manager.ts). State + config persist to a JSON file next to the
 * omp agent directory (survives restarts; middleware and route handlers
 * share the same instance).
 */
import { join } from "path";
import { PairingService, type PairingConfig } from "./remote-pairing";
import { getAgentDir } from "./omp/paths";

const GLOBAL_KEY = "__ompWebPairingService__";

type GlobalWithPairing = typeof globalThis & { [GLOBAL_KEY]?: PairingService };

export function getPairingService(): PairingService {
  const g = globalThis as GlobalWithPairing;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new PairingService({}, undefined, join(getAgentDir(), "remote-pairing.json"));
  }
  return g[GLOBAL_KEY];
}

export function updatePairingConfig(patch: Partial<PairingConfig>): PairingConfig {
  return getPairingService().updateConfig(patch);
}

export function getPairingConfig(): PairingConfig {
  return getPairingService().getConfig();
}

/** Reset the singleton (used by tests and the settings UI on demand). */
export function resetPairingService(): PairingService {
  const g = globalThis as GlobalWithPairing;
  delete g[GLOBAL_KEY];
  return getPairingService();
}

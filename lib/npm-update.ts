import packageJson from "../package.json";

const NPM_PACKAGE = "@kahme247/ompweb";
const CHECK_TTL_MS = 60 * 60 * 1000;

export interface NpmUpdateStatus {
  currentVersion: string;
  availableVersion: string | null;
  updateAvailable: boolean;
}

let cached: { checkedAt: number; status: NpmUpdateStatus } | null = null;

function parseVersion(version: string): { parts: number[]; prerelease: boolean } | null {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)(-.+)?$/);
  if (!match) return null;
  return { parts: match.slice(1, 4).map(Number), prerelease: Boolean(match[4]) };
}

export function isNewerVersion(availableVersion: string, currentVersion: string): boolean {
  const available = parseVersion(availableVersion);
  const current = parseVersion(currentVersion);
  if (!available || !current) return false;

  for (let index = 0; index < available.parts.length; index += 1) {
    if (available.parts[index] !== current.parts[index]) {
      return available.parts[index] > current.parts[index];
    }
  }
  return !available.prerelease && current.prerelease;
}

export async function checkNpmUpdate(): Promise<NpmUpdateStatus> {
  if (cached && Date.now() - cached.checkedAt < CHECK_TTL_MS) return cached.status;

  const currentVersion = packageJson.version;
  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(NPM_PACKAGE)}/latest`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const data = response.ok ? await response.json() as { version?: unknown } : null;
    const availableVersion = typeof data?.version === "string" ? data.version : null;
    const status = {
      currentVersion,
      availableVersion,
      updateAvailable: Boolean(availableVersion && isNewerVersion(availableVersion, currentVersion)),
    };
    cached = { checkedAt: Date.now(), status };
    return status;
  } catch {
    return { currentVersion, availableVersion: null, updateAvailable: false };
  }
}

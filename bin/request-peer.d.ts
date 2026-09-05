export function installRequestPeerTracking(): void;
export function verifiedRequestPeer(headers: Pick<Headers, "get">): string | null;

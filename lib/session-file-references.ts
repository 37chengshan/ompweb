import { getSessionEntries, resolveSessionPath } from "./session-reader";
import {
  isBashOutputPathReferencedByEntries,
  isFilePathReferencedByEntries,
  isValidSessionId,
} from "./session-file-references-core";

export { isFilePathReferencedByEntries } from "./session-file-references-core";

async function isPathReferencedBySession(
  filePath: string,
  sessionId: string | null,
  check: (p: string, entries: import("./types").SessionEntry[]) => boolean,
): Promise<boolean> {
  if (!isValidSessionId(sessionId)) return false;
  try {
    const sessionPath = await resolveSessionPath(sessionId);
    if (!sessionPath) return false;
    return check(filePath, getSessionEntries(sessionPath));
  } catch {
    return false;
  }
}

export function isFilePathReferencedBySession(filePath: string, sessionId: string | null): Promise<boolean> {
  return isPathReferencedBySession(filePath, sessionId, isFilePathReferencedByEntries);
}

export function isBashOutputPathReferencedBySession(filePath: string, sessionId: string | null): Promise<boolean> {
  return isPathReferencedBySession(filePath, sessionId, isBashOutputPathReferencedByEntries);
}

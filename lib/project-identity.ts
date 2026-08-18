import { normalizeForComparison } from "./paths";

/**
 * Stable, internal identity for a project path.
 *
 * The original path remains the display/filesystem value. This key is only
 * used for grouping and equality; Windows paths are normalized and folded
 * because the filesystem is case-insensitive.
 *
 * Delegates to lib/paths.ts:normalizeForComparison on the host platform;
 * when a synthetic platform is injected (tests), it normalizes with the
 * corresponding path.win32 / path.posix API so behavior is deterministic
 * on any OS. For client-side grouping use lib/comparable-path.ts instead.
 */
export function projectIdentityKey(
  projectRoot: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return normalizeForComparison(projectRoot, platform);
}

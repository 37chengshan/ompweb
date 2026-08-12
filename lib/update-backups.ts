import { cp, mkdir, opendir, readdir, readFile, rm, stat, writeFile } from "fs/promises";
import { homedir } from "os";
import { join, relative, sep } from "path";

/**
 * Snapshot/restore support for the self-update flows.
 *
 * Both updaters (the omp runtime via `omp update` and the ompweb npm/bun
 * package) mutate a global install in place. If that mutation fails partway
 * (interrupted install, broken shim, version mismatch), the app used to be
 * left with a half-written install and no way back. These helpers give both
 * flows the same contract:
 *
 *   1. snapshot the owning package dirs BEFORE the mutation,
 *   2. verify the result AFTER it,
 *   3. restore the snapshot when verification fails.
 *
 * Backups live under `~/.omp-web/backups/<label>/<timestamp>-<nonce>/` and are
 * pruned per label so a long history of updates cannot fill the disk.
 */

export const BACKUPS_ROOT = join(homedir(), ".omp-web", "backups");

interface BackupMeta {
  /** Absolute path of the directory this snapshot was copied from. */
  target: string;
  createdAt: number;
}

/** Exclude NESTED node_modules trees, measured relative to the source root —
 * the root itself may live under a global `node_modules` dir (bun/npm
 * globals), which must be copied, not excluded. */
function makeExcludeNestedNodeModules(sourceRoot: string): (sourcePath: string) => boolean {
  return (sourcePath) => !relative(sourceRoot, sourcePath).split(sep).includes("node_modules");
}

/** Snapshot `target` (a directory) into `~/.omp-web/backups/<label>/…`.
 * node_modules trees are excluded — they are hoisted to the global root in
 * both npm and bun layouts and are never part of the package being replaced.
 * Returns the backup directory. */
export async function createBackup(target: string, label: string): Promise<string> {
  const nonce = Math.random().toString(36).slice(2, 8);
  const backupDir = join(BACKUPS_ROOT, label, `${Date.now()}-${nonce}`);
  await mkdir(backupDir, { recursive: true });
  await cp(target, backupDir, {
    recursive: true,
    filter: makeExcludeNestedNodeModules(target),
    // Windows: allow overwriting anything a previous interrupted run left
    // behind instead of failing on a stale file.
    force: true,
  });
  const meta: BackupMeta = { target, createdAt: Date.now() };
  await writeFile(join(backupDir, "backup.json"), JSON.stringify(meta, null, 2), "utf8");
  return backupDir;
}

/** Read the meta of one backup dir (null when it is not a valid snapshot). */
export async function readBackupMeta(backupDir: string): Promise<BackupMeta | null> {
  try {
    const parsed = JSON.parse(await readFile(join(backupDir, "backup.json"), "utf8")) as Partial<BackupMeta>;
    return typeof parsed.target === "string" && typeof parsed.createdAt === "number"
      ? { target: parsed.target, createdAt: parsed.createdAt }
      : null;
  } catch {
    return null;
  }
}

/** List snapshots for a label, newest first. */
export async function listBackups(label: string): Promise<string[]> {
  const labelDir = join(BACKUPS_ROOT, label);
  try {
    const entries = await readdir(labelDir, { withFileTypes: true });
    const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => join(labelDir, entry.name));
    const withMeta = await Promise.all(
      dirs.map(async (dir) => ({ dir, meta: await readBackupMeta(dir) })),
    );
    return withMeta
      .filter((entry): entry is { dir: string; meta: BackupMeta } => entry.meta !== null)
      .sort((a, b) => b.meta.createdAt - a.meta.createdAt)
      .map((entry) => entry.dir);
  } catch {
    return [];
  }
}

/** Delete snapshots for a label beyond the newest `keep`. Returns removed dirs. */
export async function pruneBackups(label: string, keep = 2): Promise<string[]> {
  const snapshots = await listBackups(label);
  const removed: string[] = [];
  for (const dir of snapshots.slice(keep)) {
    try {
      await rm(dir, { recursive: true, force: true });
      removed.push(dir);
    } catch {
      // A locked snapshot is not worth failing the update over; skip it.
    }
  }
  return removed;
}

/** Replace `meta.target` with the snapshot contents. */
export async function restoreBackup(backupDir: string): Promise<string> {
  const meta = await readBackupMeta(backupDir);
  if (!meta) throw new Error(`backup metadata missing in ${backupDir}`);
  const metaFile = join(backupDir, "backup.json");
  const excludeNested = makeExcludeNestedNodeModules(backupDir);
  await rm(meta.target, { recursive: true, force: true });
  await cp(backupDir, meta.target, {
    recursive: true,
    filter: (sourcePath) => sourcePath !== metaFile && excludeNested(sourcePath),
    force: true,
  });
  return meta.target;
}

/** Human-readable size of a snapshot dir, for logs. */
export async function backupSize(backupDir: string): Promise<string> {
  let bytes = 0;
  const walk = async (dir: string): Promise<void> => {
    const entries = await opendir(dir);
    for await (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        await walk(full);
      } else if (entry.isFile()) {
        bytes += (await stat(full)).size;
      }
    }
  };
  try {
    await walk(backupDir);
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } catch {
    return "unknown";
  }
}

/** Relative display path of a snapshot (e.g. "omp/1710000000000-abc123"). */
export function backupLabel(backupDir: string): string {
  return relative(BACKUPS_ROOT, backupDir).split(sep).join("/");
}

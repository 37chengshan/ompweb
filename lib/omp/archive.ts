import { createReadStream } from "fs";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "fs";
import { createGunzip, gunzipSync } from "zlib";
import path from "path";
import type { Dirent } from "fs";
import type { SessionHeader } from "../types";
import { getArchivedSessionsDir, getSessionsDir } from "./paths";
import { invalidateSessionFileListCache, loadSessionFile, type SessionStatus } from "./session-files";

export interface ArchivedSessionRecord {
  key: string;
  id: string;
  cwd: string;
  title?: string;
  created: Date;
  archivedAt: Date;
  messageCount: number;
  firstMessage: string;
  size: number;
  status?: SessionStatus;
}

const ARCHIVE_PREFIX_BYTES = 128 * 1024;
const MAX_ARCHIVE_COMPRESSED_BYTES = 256 * 1024 * 1024;

function archiveRootPath(root: string): string {
  return path.resolve(root);
}

function normalizeArchiveKey(key: string): string {
  if (!key || key.includes("\\") || path.isAbsolute(key)) throw new Error("Invalid archive key");
  const normalized = path.posix.normalize(key.replaceAll("\\", "/"));
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || normalized.endsWith("/..") || !normalized.endsWith(".jsonl.gz")) {
    throw new Error("Invalid archive key");
  }
  return normalized;
}

function collectArchives(directory: string, files: string[] = []): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectArchives(fullPath, files);
    else if (entry.isFile() && entry.name.endsWith(".jsonl.gz")) files.push(fullPath);
  }
  return files;
}

async function readGzipPrefix(filePath: string, limit: number): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  const input = createReadStream(filePath);
  const gunzip = createGunzip();
  const chunks: Buffer[] = [];
  let length = 0;
  let settled = false;
  const finish = (error?: unknown) => {
    if (settled) return;
    settled = true;
    if (error) reject(error);
    else resolve(Buffer.concat(chunks, length));
  };
  input.on("error", finish);
  gunzip.on("error", finish);
  gunzip.on("data", (chunk: Buffer) => {
    if (settled) return;
    const remaining = limit - length;
    if (remaining <= 0) {
      input.destroy();
      gunzip.destroy();
      finish();
      return;
    }
    const part = chunk.subarray(0, Math.min(chunk.length, remaining));
    chunks.push(part);
    length += part.length;
    if (length >= limit) {
      input.destroy();
      gunzip.destroy();
      finish();
    }
  });
  gunzip.on("end", () => finish());
  input.pipe(gunzip);
  return promise;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type?: unknown; text?: unknown } => typeof block === "object" && block !== null)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join(" ");
}

function parseArchivePrefix(prefix: Buffer, filePath: string, archiveRoot: string): ArchivedSessionRecord | undefined {
  const lines = prefix.toString("utf8").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return undefined;
  let title: string | undefined;
  let headerIndex = 0;
  try {
    const first = JSON.parse(lines[0]) as Record<string, unknown>;
    if (first.type === "title" && typeof first.title === "string") {
      title = first.title || undefined;
      headerIndex = 1;
    }
    const header = JSON.parse(lines[headerIndex]) as SessionHeader;
    if (header.type !== "session" || typeof header.id !== "string") return undefined;
    let messageCount = 0;
    let firstMessage = "";
    for (const line of lines.slice(headerIndex + 1)) {
      try {
        const entry = JSON.parse(line) as { type?: string; message?: { role?: string; content?: unknown } };
        if (entry.type !== "message" || !entry.message) continue;
        messageCount++;
        if (!firstMessage && entry.message.role === "user") firstMessage = textFromContent(entry.message.content);
      } catch {
        // The final prefix line may be truncated; earlier metadata remains valid.
      }
    }
    const fileStat = statSync(filePath);
    const created = header.timestamp && !Number.isNaN(new Date(header.timestamp).getTime()) ? new Date(header.timestamp) : fileStat.mtime;
    return {
      key: path.relative(archiveRoot, filePath).split(path.sep).join("/"),
      id: header.id,
      cwd: typeof header.cwd === "string" ? header.cwd : "",
      title: title ?? (typeof header.title === "string" ? header.title : undefined),
      created,
      archivedAt: fileStat.mtime,
      messageCount,
      firstMessage: firstMessage || "(no messages)",
      size: fileStat.size,
      status: "unknown",
    };
  } catch {
    return undefined;
  }
}

export async function listArchivedSessions(archiveRoot = getArchivedSessionsDir()): Promise<ArchivedSessionRecord[]> {
  const root = archiveRootPath(archiveRoot);
  const files = collectArchives(root);
  const records = await Promise.all(files.map(async (filePath) => {
    try {
      if (statSync(filePath).size > MAX_ARCHIVE_COMPRESSED_BYTES) return undefined;
      return parseArchivePrefix(await readGzipPrefix(filePath, ARCHIVE_PREFIX_BYTES), filePath, root);
    } catch {
      return undefined;
    }
  }));
  return records.filter((record): record is ArchivedSessionRecord => Boolean(record)).sort((a, b) => b.archivedAt.getTime() - a.archivedAt.getTime());
}

export function restoreArchivedSession(key: string, sessionsRoot = getSessionsDir(), archiveRoot = getArchivedSessionsDir()): string {
  const activeRoot = archiveRootPath(sessionsRoot);
  const archiveBase = archiveRootPath(archiveRoot);
  const relative = normalizeArchiveKey(key);
  const source = path.resolve(archiveBase, relative);
  const destination = path.resolve(activeRoot, relative.slice(0, -3));
  const sourceArtifacts = source.slice(0, -3);
  const destinationArtifacts = destination.slice(0, -6);
  if (!source.startsWith(`${archiveBase}${path.sep}`) || !destination.startsWith(`${activeRoot}${path.sep}`)) throw new Error("Invalid archive key");
  if (!existsSync(source) || !lstatSync(source).isFile()) throw new Error("Archived session not found");
  if (existsSync(destination) || existsSync(destinationArtifacts)) throw new Error("Active session destination already exists");

  const restored = gunzipSync(readFileSync(source));
  const tempDir = mkdtempSync(path.join(path.dirname(destination), ".omp-web-restore-"));
  const tempFile = path.join(tempDir, path.basename(destination));
  let destinationCreated = false;
  let artifactsMoved = false;
  try {
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(tempFile, restored);
    renameSync(tempFile, destination);
    destinationCreated = true;
    if (existsSync(sourceArtifacts)) {
      if (!lstatSync(sourceArtifacts).isDirectory()) throw new Error("Archived artifacts are invalid");
      mkdirSync(path.dirname(destinationArtifacts), { recursive: true });
      renameSync(sourceArtifacts, destinationArtifacts);
      artifactsMoved = true;
    }
    const loaded = loadSessionFile(destination);
    if (!loaded.header?.id) throw new Error("Archived session is invalid");
    unlinkSync(source);
    invalidateSessionFileListCache();
    return loaded.header.id;
  } catch (error) {
    if (artifactsMoved) {
      try { renameSync(destinationArtifacts, sourceArtifacts); } catch { /* preserve original failure */ }
    }
    if (destinationCreated) {
      try { unlinkSync(destination); } catch { /* preserve original failure */ }
    }
    throw error;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

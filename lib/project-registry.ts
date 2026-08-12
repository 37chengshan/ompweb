import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, type Stats } from "fs";
import { homedir } from "os";
import { isAbsolute, resolve } from "path";
import { getAgentDir } from "./omp/paths";
import type { ManagedProject } from "./types";

// ============================================================================
// Project registry: which directories the user explicitly manages, and which
// of them are hidden from the sidebar. Stored as ~/.omp/agent/projects.json
// (the same agent dir as sessions), written atomically so a crash can never
// leave a half-written registry. Hiding is reversible: the entry (and its
// sessions) is restored by adding the directory again.
//
// Paths are stored in their canonical (worktree-resolved) projectRoot form so
// worktrees always group under their main repository.
// ============================================================================

export interface ProjectRegistryEntry {
  /** Canonical project path (worktrees resolve to their main repo root). */
  path: string;
  /** ISO timestamp of the most recent explicit add. Used to order projects by
   *  most-recently-added (stable; never session activity). */
  addedAt: string;
  /** True when the user removed the project from the sidebar. Hidden entries
   *  suppress session re-discovery until the project is added again. */
  hidden: boolean;
}

export interface ProjectRegistryFile {
  version: 1;
  projects: ProjectRegistryEntry[];
}

/** Error carrying a stable code (errors.* key) for client localization. */
export class ProjectPathError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ProjectPathError";
    this.code = code;
  }
}

const EMPTY_REGISTRY: ProjectRegistryFile = { version: 1, projects: [] };

/** Case-insensitive comparable form on Windows (NTFS is case-insensitive);
 *  case-sensitive elsewhere. */
export function comparableProjectPath(value: string): string {
  const normalized = resolve(value).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/** Parse registry JSON; missing, corrupt, or foreign-shaped input yields an
 *  empty registry rather than failing the whole sidebar. */
export function parseProjectRegistry(raw: string): ProjectRegistryFile {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return EMPTY_REGISTRY;
    if (!("projects" in parsed) || !Array.isArray(parsed.projects)) return EMPTY_REGISTRY;
    const entries: ProjectRegistryEntry[] = [];
    for (const item of parsed.projects) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      if (!("path" in item) || typeof item.path !== "string" || !item.path.trim()) continue;
      entries.push({
        path: resolve(item.path.trim()),
        addedAt: "addedAt" in item && typeof item.addedAt === "string"
          ? item.addedAt
          : new Date(0).toISOString(),
        hidden: "hidden" in item && item.hidden === true,
      });
    }
    return { version: 1, projects: entries };
  } catch {
    return EMPTY_REGISTRY;
  }
}

export function loadProjectRegistry(): ProjectRegistryFile {
  const registryPath = resolve(getAgentDir(), "projects.json");
  if (!existsSync(registryPath)) return EMPTY_REGISTRY;
  try {
    return parseProjectRegistry(readFileSync(registryPath, "utf8"));
  } catch {
    return EMPTY_REGISTRY;
  }
}

/** Atomic persistence: write a temp file in the same directory, then rename
 *  over the registry. A crash mid-write leaves the previous registry intact. */
export function saveProjectRegistry(registry: ProjectRegistryFile): void {
  const registryPath = resolve(getAgentDir(), "projects.json");
  mkdirSync(resolve(registryPath, ".."), { recursive: true });
  const temp = `${registryPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(temp, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    renameSync(temp, registryPath);
  } finally {
    // Best-effort cleanup if the rename never happened (e.g. EACCES).
    try {
      if (existsSync(temp)) rmSync(temp);
    } catch {
      // ignore cleanup failures
    }
  }
}

/** Register a project (or restore a hidden one). Re-adding refreshes addedAt,
 *  which moves the project to the front of the most-recently-added ordering. */
export function upsertProject(
  registry: ProjectRegistryFile,
  path: string,
  now = new Date().toISOString(),
): ProjectRegistryFile {
  const canonical = resolve(path);
  const key = comparableProjectPath(canonical);
  const projects = registry.projects.filter((p) => comparableProjectPath(p.path) !== key);
  projects.push({ path: canonical, addedAt: now, hidden: false });
  return { version: 1, projects };
}

/** Mark a project hidden (or add a hidden entry for a session-discovered
 *  project that was never explicitly added). Reversible via upsertProject. */
export function hideProject(registry: ProjectRegistryFile, path: string): ProjectRegistryFile {
  const canonical = resolve(path);
  const key = comparableProjectPath(canonical);
  const existing = registry.projects.some((p) => comparableProjectPath(p.path) === key);
  const projects = registry.projects.map((p) =>
    comparableProjectPath(p.path) === key ? { ...p, hidden: true } : p,
  );
  if (!existing) {
    projects.push({ path: canonical, addedAt: new Date().toISOString(), hidden: true });
  }
  return { version: 1, projects };
}

/** Merge registered projects with session-discovered ones, excluding hidden
 *  entries. A hidden registry entry suppresses re-discovery, so hiding a
 *  project keeps its sessions off the sidebar until it is added again.
 *  Registered projects come first in most-recently-added order; discovered
 *  projects follow sorted by path. */
export function mergeProjects(registry: ProjectRegistryFile, discovered: Iterable<string>): ManagedProject[] {
  const hidden = new Set(
    registry.projects.filter((p) => p.hidden).map((p) => comparableProjectPath(p.path)),
  );
  const registered: ManagedProject[] = [];
  const registeredSeen = new Set<string>();
  for (const p of registry.projects
    .filter((entry) => !entry.hidden)
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt))) {
    const key = comparableProjectPath(p.path);
    if (registeredSeen.has(key)) continue; // tolerate hand-edited duplicates
    registeredSeen.add(key);
    registered.push({ path: p.path, addedAt: p.addedAt });
  }
  const extra: ManagedProject[] = [];
  const extraSeen = new Set<string>();
  for (const raw of new Set([...discovered].filter(Boolean).map((d) => resolve(d)))) {
    const key = comparableProjectPath(raw);
    if (hidden.has(key) || registeredSeen.has(key) || extraSeen.has(key)) continue;
    extraSeen.add(key);
    extra.push({ path: raw });
  }
  extra.sort((a, b) => a.path.localeCompare(b.path));
  return [...registered, ...extra];
}

/** Normalize a user-supplied path: ~ and ~/ expand to the home directory,
 *  relative paths resolve against the server cwd (mirrors /api/cwd/validate). */
function normalizeCwd(cwd: string): string {
  if (cwd === "~") return homedir();
  if (cwd.startsWith("~/")) return resolve(homedir(), cwd.slice(2));
  return isAbsolute(cwd) ? cwd : resolve(cwd);
}

/** Validate and canonicalize a candidate project path. Throws ProjectPathError
 *  with a stable code on failure (path_required / directory_not_found /
 *  not_a_directory). */
export function validateProjectPath(cwd: string): string {
  const trimmed = typeof cwd === "string" ? cwd.trim() : "";
  if (!trimmed) throw new ProjectPathError("path_required", "Path is required");

  const normalized = normalizeCwd(trimmed);
  let stat: Stats;
  try {
    stat = statSync(normalized);
  } catch {
    throw new ProjectPathError("directory_not_found", `Directory does not exist: ${cwd}`);
  }
  if (!stat.isDirectory()) {
    throw new ProjectPathError("not_a_directory", `Path is not a directory: ${cwd}`);
  }
  return normalized;
}

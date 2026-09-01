import { realpathSync } from "fs";
import { homedir } from "os";
import { isAbsolute, resolve } from "path";
import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { comparableProjectPath } from "@/lib/comparable-path";
import { allowFileRoot } from "@/lib/file-access";
import {
  hideProject,
  existingDiscoveredProjectPaths,
  loadProjectRegistry,
  mergeProjects,
  ProjectPathError,
  saveProjectRegistry,
  upsertProject,
  updateProjectsPresentation,
  validateProjectPath,
} from "@/lib/project-registry";
import { listAllSessions } from "@/lib/session-reader";
import { resolveProject } from "@/lib/worktree";
import type { ManagedProject } from "@/lib/types";

// GET /api/projects  →  { projects: ManagedProject[] }
// Registered (non-hidden) projects plus session-discovered projects, excluding
// hidden entries. Session-discovered paths get no addedAt; the client orders
// the merged list by most-recently-added (registration order), then by path —
// deliberately not by session activity, which would reorder rows on refresh.
export async function GET() {
  try {
    const registry = loadProjectRegistry();
    const sessions = await listAllSessions();
    const discovered = existingDiscoveredProjectPaths(
      sessions
        .map((s) => s.projectRoot ?? s.cwd)
        .filter((path): path is string => Boolean(path)),
    );
    const projects = mergeProjects(registry, discovered);
    // Keep the in-memory browse allowlist warm for registered projects that
    // have no sessions (the in-memory list does not survive restarts, and an
    // empty managed project derives no root from sessions).
    for (const project of projects) allowFileRoot(project.path);
    return NextResponse.json({ projects });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// POST /api/projects  body: { cwd }  →  { project: ManagedProject }
// Validates the directory, resolves Git worktrees to their main projectRoot,
// registers and authorizes it, and unhides it if it was previously hidden.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd : "";
    const normalized = validateProjectPath(cwd);
    const { projectRoot } = await resolveProject(normalized);

    const registry = loadProjectRegistry();
    const next = upsertProject(registry, projectRoot);
    saveProjectRegistry(next);
    allowFileRoot(projectRoot);

    const entry = next.projects.find((p) => comparableProjectPath(p.path) === comparableProjectPath(projectRoot))!;
    return NextResponse.json({ project: { path: entry.path, addedAt: entry.addedAt } satisfies ManagedProject });
  } catch (error) {
    if (error instanceof ProjectPathError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    return apiErrorResponse(error);
  }
}

// PATCH /api/projects
// Single shape: { cwd, alias?, sortOrder? }   Batch shape: { updates: [{ cwd, alias?, sortOrder? }, ...] }
// Applied atomically in one registry load/save so a drag reorder (one request,
// many entries) can never interleave with another writer and lose updates.
// Renaming or ordering a project is an explicit act of managing it: paths that
// were only session-discovered get registered and their root authorized in the
// same cycle instead of silently no-oping.
const MAX_PRESENTATION_UPDATES = 500;

export async function PATCH(req: Request) {
  try {
    const body = await req.json() as {
      cwd?: unknown;
      alias?: unknown;
      sortOrder?: unknown;
      updates?: unknown;
    };
    const rawUpdates: unknown[] = Array.isArray(body.updates)
      ? body.updates
      : body.cwd !== undefined || body.alias !== undefined || body.sortOrder !== undefined
        ? [{ cwd: body.cwd, alias: body.alias, sortOrder: body.sortOrder }]
        : [];
    if (rawUpdates.length === 0) {
      return NextResponse.json({ error: "Path is required", code: "path_required" }, { status: 400 });
    }
    if (rawUpdates.length > MAX_PRESENTATION_UPDATES) {
      return NextResponse.json({ error: "Too many updates", code: "too_many_updates" }, { status: 400 });
    }

    // Pre-load registry so we can distinguish "already managed but now
    // deleted" (allow reorder/alias) from "session-discovered ghost" (must not
    // auto-register a deleted path). validateProjectPath is still required for
    // the latter.
    const earlyRegistry = loadProjectRegistry();
    const isAlreadyManaged = (cwd: string): string | null => {
      // Cheap check without stat: resolve ~ and relative, then compare.
      // Mirrors validateProjectPath's normalizeCwd + canonicalProjectPath fallback.
      let probe = cwd.trim();
      if (probe === "~") probe = homedir();
      else if (probe.startsWith("~/")) probe = resolve(homedir(), probe.slice(2));
      else if (!isAbsolute(probe)) probe = resolve(probe);
      try { probe = realpathSync(probe); } catch { /* deleted dirs fall back to resolved */ }
      const key = comparableProjectPath(probe);
      const match = earlyRegistry.projects.find((p) => comparableProjectPath(p.path) === key);
      return match ? match.path : null;
    };

    const parsed: Array<{ path: string; alias?: string | null; sortOrder?: number | null }> = [];
    const skipped: Array<{ cwd: string; code: string; error: string }> = [];
    for (const item of rawUpdates) {
      const entry = item as { cwd?: unknown; alias?: unknown; sortOrder?: unknown };
      const cwd = typeof entry.cwd === "string" ? entry.cwd.trim() : "";
      if (!cwd) return NextResponse.json({ error: "Path is required", code: "path_required" }, { status: 400 });
      const alias = entry.alias === null ? null : typeof entry.alias === "string" ? entry.alias : undefined;
      const sortOrder = entry.sortOrder === null ? null : typeof entry.sortOrder === "number" && Number.isFinite(entry.sortOrder) ? entry.sortOrder : undefined;
      if (entry.alias !== undefined && alias === undefined) return NextResponse.json({ error: "Alias must be a string", code: "invalid_alias" }, { status: 400 });
      if (entry.sortOrder !== undefined && sortOrder === undefined) return NextResponse.json({ error: "Sort order must be a number", code: "invalid_sort_order" }, { status: 400 });
      // Same existence/directory checks as POST: an auto-registering endpoint
      // must never persist ghost entries for deleted paths, plain files, or
      // unexpanded "~"/relative paths. For bulk reorder (multiple entries),
      // a single ghost (e.g. a session-discovered directory that was deleted
      // on disk) must not abort the entire batch — skip it instead.
      // Already-managed projects bypass the check so a user's explicitly added
      // workspace stays reorderable/renamable even after its directory is removed.
      const managedPath = isAlreadyManaged(cwd);
      if (managedPath) {
        parsed.push({ path: managedPath, alias, sortOrder });
        continue;
      }
      let normalized: string;
      try {
        normalized = validateProjectPath(cwd);
      } catch (error) {
        if (error instanceof ProjectPathError) {
          if (rawUpdates.length > 1) {
            skipped.push({ cwd, code: error.code, error: error.message });
            continue;
          }
          return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
        }
        throw error;
      }
      let projectRoot: string;
      try {
        ({ projectRoot } = await resolveProject(normalized));
      } catch (error) {
        if (rawUpdates.length > 1) {
          const message = error instanceof Error ? error.message : String(error);
          skipped.push({ cwd, code: "resolve_failed", error: message });
          continue;
        }
        throw error;
      }
      parsed.push({ path: projectRoot, alias, sortOrder });
    }
    // Bulk path: every entry was a ghost — propagate the first failure so the
    // client gets a meaningful 400 instead of a misleading 200 with no changes.
    if (parsed.length === 0 && skipped.length > 0) {
      const first = skipped[0]!;
      return NextResponse.json({ error: first.error, code: first.code }, { status: 400 });
    }

    // Duplicate targets within one batch merge per-field (later defined
    // fields win) instead of the whole later update replacing the earlier.
    const merged = new Map<string, { path: string; alias?: string | null; sortOrder?: number | null }>();
    for (const update of parsed) {
      const key = comparableProjectPath(update.path);
      const previous = merged.get(key);
      merged.set(key, previous ? {
        path: previous.path,
        alias: update.alias !== undefined ? update.alias : previous.alias,
        sortOrder: update.sortOrder !== undefined ? update.sortOrder : previous.sortOrder,
      } : update);
    }

    let registry = loadProjectRegistry();
    const newRoots: string[] = [];
    for (const update of merged.values()) {
      const key = comparableProjectPath(update.path);
      if (!registry.projects.some((p) => comparableProjectPath(p.path) === key)) {
        registry = upsertProject(registry, update.path);
        newRoots.push(update.path);
      }
    }
    // Hidden entries are invisible management-wise: user actions target rows
    // on screen, so their stored display data stays untouched.
    const updates = [...merged.values()].filter((update) => {
      const entry = registry.projects.find((p) => comparableProjectPath(p.path) === comparableProjectPath(update.path));
      return !entry?.hidden;
    });
    const next = updateProjectsPresentation(registry, updates);
    saveProjectRegistry(next);
    // Only after a successful save: a failed write must not leave an orphaned
    // in-memory browse authorization behind.
    for (const root of newRoots) allowFileRoot(root);

    const updatedKeys = new Set(updates.map((update) => comparableProjectPath(update.path)));
    const projects = next.projects
      .filter((entry) => updatedKeys.has(comparableProjectPath(entry.path)))
      .map((entry) => ({ path: entry.path, addedAt: entry.addedAt, hidden: entry.hidden, alias: entry.alias, sortOrder: entry.sortOrder }));
    return NextResponse.json({ projects });
  } catch (error) { return apiErrorResponse(error); }
}

// DELETE /api/projects  body: { cwd }  →  { success: true }
// Hides the project from the sidebar without touching its directory or
// sessions. Re-adding the directory (POST) restores it.
export async function DELETE(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    if (!cwd) {
      return NextResponse.json({ error: "Path is required", code: "path_required" }, { status: 400 });
    }
    // Canonicalize worktree paths so hiding a worktree hides its whole project.
    const { projectRoot } = await resolveProject(cwd);
    const registry = loadProjectRegistry();
    saveProjectRegistry(hideProject(registry, projectRoot));
    return NextResponse.json({ success: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

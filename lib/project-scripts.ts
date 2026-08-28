import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

/**
 * Project quick scripts (build / publish / start ...). Stored per project in
 * `<projectRoot>/.omp/scripts.json`, optionally merged with a global set in
 * `~/.omp/agent/scripts.json`. Atomic writes (temp file + rename).
 */

export const QUICK_SCRIPT_ICONS = ["play", "rocket", "wrench"] as const;
export type QuickScriptIcon = (typeof QUICK_SCRIPT_ICONS)[number];

export interface QuickScript {
  name: string;
  command: string;
  description?: string;
  /** One of the preset icons; undefined defaults to "play". */
  icon?: QuickScriptIcon;
}

interface ScriptsFile {
  scripts?: QuickScript[];
}

const GLOBAL_SCRIPTS_PATH = join(homedir(), ".omp", "agent", "scripts.json");

export function validateQuickScripts(value: unknown): QuickScript[] | null {
  if (!Array.isArray(value)) return null;
  const out: QuickScript[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const name = (item as { name?: unknown }).name;
    const command = (item as { command?: unknown }).command;
    if (typeof name !== "string" || !name.trim() || typeof command !== "string" || !command.trim()) return null;
    const icon = (item as { icon?: unknown }).icon;
    out.push({
      name: name.trim(),
      command: command.trim(),
      ...(typeof (item as { description?: unknown }).description === "string" ? { description: (item as { description: string }).description } : {}),
      ...(typeof icon === "string" && (QUICK_SCRIPT_ICONS as readonly string[]).includes(icon) ? { icon: icon as QuickScriptIcon } : {}),
    });
  }
  return out;
}

function readScriptsFile(filePath: string): QuickScript[] {
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as ScriptsFile;
    return validateQuickScripts(raw.scripts) ?? [];
  } catch {
    return [];
  }
}

function writeScriptsFile(filePath: string, scripts: QuickScript[]): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify({ scripts }, null, 2) + "\n");
  renameSync(tmp, filePath);
}

export function getGlobalScripts(): QuickScript[] {
  return readScriptsFile(GLOBAL_SCRIPTS_PATH);
}

export function getProjectScripts(projectRoot: string): QuickScript[] {
  return readScriptsFile(join(projectRoot, ".omp", "scripts.json"));
}

/** Global + project scripts; project wins on name collisions. */
export function listQuickScripts(projectRoot: string): QuickScript[] {
  const byName = new Map<string, QuickScript>();
  for (const s of getGlobalScripts()) byName.set(s.name, s);
  for (const s of getProjectScripts(projectRoot)) byName.set(s.name, s);
  return [...byName.values()];
}

export function saveProjectScripts(projectRoot: string, scripts: QuickScript[]): void {
  const file = join(projectRoot, ".omp", "scripts.json");
  if (scripts.length === 0) {
    // Remove the file when the list is emptied (a nonexistent file reads []).
    try { if (existsSync(file)) writeFileSync(file, JSON.stringify({ scripts: [] }, null, 2) + "\n"); } catch { /* best effort */ }
    return;
  }
  writeScriptsFile(file, scripts);
}
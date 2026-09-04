import fs from "fs";
import path from "path";
import { resolveDirentIsDirectory } from "./file-dirent";

/**
 * Pure directory-listing semantics shared by the /api/files route and the
 * Rust-parity test: ignore lists, symlink dir resolution, dirs-first order.
 * Extracted from app/api/files/[...path]/route.ts so the Rust `files.list`
 * (crates/ompweb-host/src/file_service.rs) can be tested 1:1 against it.
 */

export const IGNORED_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".DS_Store",
]);

export const IGNORED_SUFFIXES = [".pyc"];

export interface DirectoryEntry {
  name: string;
  isDir: boolean;
  size: 0;
  modified: "";
}

/** readdir with ignore filters, symlink-dir resolution and dirs-first sort. */
export function listDirectoryEntries(dirPath: string): DirectoryEntry[] {
  const dirents = fs.readdirSync(dirPath, { withFileTypes: true });
  return dirents
    .filter((d) => !IGNORED_NAMES.has(d.name) && !IGNORED_SUFFIXES.some((s) => d.name.endsWith(s)))
    .flatMap((d) => {
      const isDir = resolveDirentIsDirectory(d, path.join(dirPath, d.name));
      return isDir === null
        ? []
        : [{ name: d.name, isDir, size: 0 as const, modified: "" as const }];
    })
    .sort((a, b) => {
      // Dirs first, then files, both alphabetically
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}
/**
 * Build the platform-specific shell command that reveals a file or directory
 * in the system file manager. Pure: no child_process, no fs — the caller
 * (app/api/reveal/route.ts) does the path checks and executes the command.
 *
 *   macOS:  Finder — `open <dir>` for directories, `open -R <file>` reveals a file
 *   Windows: Explorer — `explorer /select,<file>` selects a file, `explorer <dir>` opens a directory
 *   Linux:  xdg-open on the directory itself; files open their parent directory
 */

export function buildRevealCommand(platform: string, target: string, isDirectory: boolean): string {
  if (platform === "darwin") {
    return isDirectory ? `open ${shellQuote(target)}` : `open -R ${shellQuote(target)}`;
  }
  if (platform === "win32") {
    return isDirectory ? `explorer ${winQuote(target)}` : `explorer /select,${winQuote(target)}`;
  }
  if (platform === "linux") {
    if (isDirectory) return `xdg-open ${shellQuote(target)}`;
    const parent = target.slice(0, target.lastIndexOf("/")) || "/";
    return `xdg-open ${shellQuote(parent)}`;
  }
  throw new Error(`unsupported platform: ${platform}`);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function winQuote(value: string): string {
  // Explorer's /select, takes a comma-separated argument; quotes around the
  // whole path keep spaces intact.
  return `"${value.replace(/"/g, '""')}"`;
}
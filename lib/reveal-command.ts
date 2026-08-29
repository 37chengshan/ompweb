/**
 * Build the platform-specific launcher for revealing a file or directory in
 * the system file manager. Pure: no child_process, no fs — the caller
 * (app/api/reveal/route.ts) does the path checks and spawns the process.
 *
 * The launcher is returned as an argv array (command + args), never a shell
 * string: paths are single argv elements, so quotes, `&`, or spaces in a
 * directory name can never become command injection.
 *
 *   macOS:   Finder — `open <dir>` for directories, `open -R <file>` reveals a file
 *   Windows: Explorer — `explorer /select,<file>` selects a file, `explorer <dir>` opens a directory
 *   Linux:   xdg-open on the directory itself; files open their parent directory
 */

export function buildRevealSpawn(platform: string, target: string, isDirectory: boolean): { command: string; args: string[] } {
  if (platform === "darwin") {
    return isDirectory
      ? { command: "open", args: [target] }
      : { command: "open", args: ["-R", target] };
  }
  if (platform === "win32") {
    // Explorer's /select, takes a comma-separated argument; the path stays a
    // single argv element, so no quoting is needed.
    return { command: "explorer", args: [isDirectory ? target : `/select,${target}`] };
  }
  if (platform === "linux") {
    if (isDirectory) return { command: "xdg-open", args: [target] };
    // A slash-less relative file resolves against the server cwd; opening its
    // parent means the current directory, never the filesystem root.
    const idx = target.lastIndexOf("/");
    const parent = idx === -1 ? "." : (idx === 0 ? "/" : target.slice(0, idx));
    return { command: "xdg-open", args: [parent] };
  }
  throw new Error(`unsupported platform: ${platform}`);
}

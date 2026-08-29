import { NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";

export const dynamic = "force-dynamic";

/**
 * POST /api/terminal/open  body: { cwd? }
 * Launch the OS terminal app at the requested directory. Same path policy as
 * /api/files and /api/reveal: the directory must exist under an allowed file
 * root. Each platform launcher is spawned with an argument array — the path
 * is never interpolated into a shell string, so directory names containing
 * quotes, `&`, or spaces cannot turn into command injection.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    let targetDir = body?.cwd;
    if (!targetDir || typeof targetDir !== "string" || !fs.existsSync(targetDir)) {
      targetDir = process.cwd();
    }
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(targetDir, allowedRoots)) {
      return NextResponse.json({ error: "Path not allowed", code: "path_not_allowed" }, { status: 403 });
    }
    const realTargetDir = fs.realpathSync(targetDir);

    const spawnOpts = { stdio: "ignore" as const, detached: true, cwd: realTargetDir };
    let terminalName: string;

    if (process.platform === "darwin") {
      terminalName = "Terminal.app";
      const child = spawn("open", ["-a", "Terminal", realTargetDir], spawnOpts);
      child.on("error", () => { /* best effort */ });
      child.unref();
    } else if (process.platform === "win32") {
      // A detached console child of a GUI/CLI host gets its own console
      // window; `cwd` does what `start cmd.exe /K "cd /d ..."` used to do,
      // without routing the path through a shell.
      terminalName = "Command Prompt";
      const child = spawn("cmd.exe", [], spawnOpts);
      child.on("error", () => { /* best effort */ });
      child.unref();
    } else {
      // Try the standard terminal emulators in order; the directory is a
      // single argv element, so no shell quoting is involved.
      terminalName = "Terminal";
      const candidates: Array<[string, string[]]> = [
        ["x-terminal-emulator", ["--working-directory", realTargetDir]],
        ["gnome-terminal", ["--working-directory", realTargetDir]],
        ["xterm", []],
      ];
      const tryNext = (index: number): void => {
        if (index >= candidates.length) return;
        const [command, args] = candidates[index];
        const child = spawn(command, args, spawnOpts);
        child.on("error", () => tryNext(index + 1));
        child.unref();
      };
      tryNext(0);
    }

    return NextResponse.json({ ok: true, cwd: realTargetDir, terminal: terminalName });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to open terminal";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

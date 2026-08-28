import { NextResponse } from "next/server";
import { exec } from "child_process";
import { statSync } from "fs";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { buildRevealCommand } from "@/lib/reveal-command";

export const dynamic = "force-dynamic";

/**
 * POST /api/reveal  body: { path }
 * Reveal a file or directory in the system file manager:
 *   - macOS:  Finder (`open -R` selects the item)
 *   - Windows: Explorer (`explorer /select,` selects the item)
 *   - Linux:  xdg-open on the parent directory (no native select flag)
 * Only paths under the allowed file roots are accepted.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const target = typeof body?.path === "string" ? body.path : "";
    if (!target) {
      return NextResponse.json({ error: "Missing path", code: "missing_path" }, { status: 400 });
    }
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(target, allowedRoots)) {
      return NextResponse.json({ error: "Path not allowed", code: "path_not_allowed" }, { status: 403 });
    }
    let stat;
    try {
      stat = statSync(target);
    } catch {
      return NextResponse.json({ error: "Path does not exist", code: "path_not_found" }, { status: 404 });
    }

    let command: string;
    try {
      command = buildRevealCommand(process.platform, target, stat.isDirectory());
    } catch {
      return NextResponse.json(
        { error: `Reveal unsupported on ${process.platform}`, code: "unsupported_platform" },
        { status: 501 },
      );
    }

    const isWindows = process.platform === "win32";
    await new Promise<void>((resolve, reject) => {
      // Cap the command so a hanging file manager never wedges the request.
      exec(command, { timeout: 8000 }, (error) => {
        // explorer.exe returns a nonzero exit code even on success in some
        // Windows versions; treat exit as best-effort there.
        if (error && !isWindows) reject(error);
        else resolve();
      });
    });

    return NextResponse.json({ ok: true, path: target });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to reveal path";
    return NextResponse.json({ error: message, code: "reveal_failed" }, { status: 500 });
  }
}

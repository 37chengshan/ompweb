import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { statSync } from "fs";
import { getAllowedFileRoots, isExistingFilePathAllowed, normalizeSlashes } from "@/lib/file-access";
import { buildRevealSpawn } from "@/lib/reveal-command";
import { getConfigRoot, getAgentDir, getSessionsDir } from "@/lib/omp/paths";
import { resolveOmpBin } from "@/lib/omp/omp-cli";
import { hostClient } from "@/lib/omp/host-client";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * POST /api/reveal  body: { path }
 * Reveal a file or directory in the system file manager:
 *   - macOS:  Finder (`open -R` selects the item)
 *   - Windows: Explorer (`explorer /select,` selects the item)
 *   - Linux:  xdg-open on the parent directory (no native select flag)
 * Only paths under the allowed file roots are accepted. The launcher is
 * spawned from an argv array (see lib/reveal-command.ts) — the target path is
 * never interpolated into a shell string.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const target = typeof body?.path === "string" ? body.path : "";
    if (!target) {
      return NextResponse.json({ error: "Missing path", code: "missing_path" }, { status: 400 });
    }
    const allowedRoots = await getAllowedFileRoots();
    try {
      allowedRoots.add(normalizeSlashes(getConfigRoot()));
      allowedRoots.add(normalizeSlashes(getAgentDir()));
      allowedRoots.add(normalizeSlashes(getSessionsDir()));
    } catch {
      // ignore path resolution failure in restricted environments
    }

    const ompBin = resolveOmpBin();
    const rustHost = hostClient.host.status();
    const normalizedTarget = path.resolve(target);
    const isSpecialAllowed =
      (ompBin && normalizedTarget === path.resolve(ompBin)) ||
      (rustHost?.path && normalizedTarget === path.resolve(rustHost.path));

    if (!isSpecialAllowed && !isExistingFilePathAllowed(target, allowedRoots)) {
      return NextResponse.json({ error: "Path not allowed", code: "path_not_allowed" }, { status: 403 });
    }
    let stat;
    try {
      stat = statSync(target);
    } catch {
      return NextResponse.json({ error: "Path does not exist", code: "path_not_found" }, { status: 404 });
    }

    let launcher: { command: string; args: string[] };
    try {
      launcher = buildRevealSpawn(process.platform, target, stat.isDirectory());
    } catch {
      return NextResponse.json(
        { error: `Reveal unsupported on ${process.platform}`, code: "unsupported_platform" },
        { status: 501 },
      );
    }

    await new Promise<void>((resolve, reject) => {
      const child = spawn(launcher.command, launcher.args, { stdio: "ignore" });
      // Cap the wait so a hanging file manager never wedges the request.
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* already gone */ }
        resolve();
      }, 8000);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      // Exit codes are not meaningful here (explorer.exe returns nonzero even
      // on success in some Windows versions); exiting at all is success enough.
      child.on("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    return NextResponse.json({ ok: true, path: target });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to reveal path";
    return NextResponse.json({ error: message, code: "reveal_failed" }, { status: 500 });
  }
}

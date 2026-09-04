import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { getGitFileDiff } from "@/lib/git-changes";
import { recordBackendError } from "@/lib/backend-errors";
import { hostClient, rustBackendActive } from "@/lib/omp/host-client";

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    const filePath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path", code: "cwd_must_be_absolute" }, { status: 400 });
    }
    if (!filePath || (!filePath.startsWith("/") && !isWindowsAbsolutePath(filePath))) {
      return NextResponse.json({ error: "path must be an absolute path", code: "path_must_be_absolute" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots) || !isFilePathAllowed(filePath, allowedRoots)) {
      return NextResponse.json({ error: "Access denied", code: "access_denied" }, { status: 403 });
    }
    if (!isExistingFilePathAllowed(cwd, allowedRoots) || !isExistingFilePathAllowed(filePath, allowedRoots)) {
      return NextResponse.json({ error: "Access denied", code: "access_denied" }, { status: 403 });
    }

    // Doc 16 route 10: in Rust mode the host owns single-file diff previews
    // (read-only parity frozen by lib/git-parity.test.mjs); the Node path
    // exists only for the explicit OMPWEB_BACKEND=node rollback.
    if (rustBackendActive()) {
      try {
        return NextResponse.json(await hostClient.git.diff([...allowedRoots], cwd, filePath));
      } catch (error) {
        recordBackendError("git_diff_failed", error instanceof Error ? error.message : String(error));
        const code = typeof (error as { code?: unknown } | null)?.code === "string" ? (error as { code: string }).code : "git_diff_failed";
        return NextResponse.json({ error: error instanceof Error ? error.message : String(error), code }, { status: 500 });
      }
    }

    return NextResponse.json(await getGitFileDiff(cwd, filePath));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

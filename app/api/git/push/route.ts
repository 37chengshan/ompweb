import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { recordBackendError } from "@/lib/backend-errors";
import { hostClient, rustBackendActive } from "@/lib/omp/host-client";
import { pushGitChanges } from "@/lib/git-changes";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { cwd?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    if (!cwd) return NextResponse.json({ error: "cwd is required", code: "cwd_required" }, { status: 400 });
    const roots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, roots)) return NextResponse.json({ error: "Access denied", code: "access_denied" }, { status: 403 });
    // Doc 16 route 10: push runs on the host in Rust mode; the Node
    // implementation exists only for OMPWEB_BACKEND=node.
    if (rustBackendActive()) {
      try {
        return NextResponse.json({ success: true, ...(await hostClient.git.push([...roots], cwd)) });
      } catch (error) {
        recordBackendError("git_push_failed", error instanceof Error ? error.message : String(error));
        const code = typeof (error as { code?: unknown } | null)?.code === "string" ? (error as { code: string }).code : "git_push_failed";
        return NextResponse.json({ error: error instanceof Error ? error.message : String(error), code }, { status: 400 });
      }
    }
    const result = await pushGitChanges(cwd);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), code: "git_push_failed" }, { status: 400 });
  }
}

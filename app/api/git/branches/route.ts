import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { recordBackendError } from "@/lib/backend-errors";
import { hostClient, rustBackendActive } from "@/lib/omp/host-client";
import { listGitBranches } from "@/lib/git-changes";

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    const roots = await getAllowedFileRoots();
    if (!cwd || !isExistingFilePathAllowed(cwd, roots)) return NextResponse.json({ error: "Access denied", code: "access_denied" }, { status: 403 });
    // Doc 16 route 10: in Rust mode the host owns git — branch listing runs
    // there; the Node implementation exists only for OMPWEB_BACKEND=node.
    if (rustBackendActive()) {
      try {
        return NextResponse.json({ branches: await hostClient.git.branches([...roots], cwd) });
      } catch (error) {
        recordBackendError("git_branches_failed", error instanceof Error ? error.message : String(error));
        const code = typeof (error as { code?: unknown } | null)?.code === "string" ? (error as { code: string }).code : "git_branches_failed";
        return NextResponse.json({ error: error instanceof Error ? error.message : String(error), code }, { status: 400 });
      }
    }
    return NextResponse.json({ branches: await listGitBranches(cwd) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), code: "git_branches_failed" }, { status: 400 });
  }
}
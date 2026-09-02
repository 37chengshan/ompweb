import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { commitGitChanges } from "@/lib/git-changes";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { cwd?: unknown; message?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!cwd) return NextResponse.json({ error: "cwd is required", code: "cwd_required" }, { status: 400 });
    if (!message) return NextResponse.json({ error: "Commit message is required", code: "commit_message_required" }, { status: 400 });
    if (message.length > 200) return NextResponse.json({ error: "Commit message is too long", code: "commit_message_too_long" }, { status: 400 });
    const roots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, roots)) return NextResponse.json({ error: "Access denied", code: "access_denied" }, { status: 403 });
    const result = await commitGitChanges(cwd, message);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error), code: "git_commit_failed" }, { status: 400 });
  }
}

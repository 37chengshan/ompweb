import { NextResponse } from "next/server";
import { resolveProject } from "@/lib/worktree";
import { listQuickScripts, saveProjectScripts, validateQuickScripts } from "@/lib/project-scripts";

export const dynamic = "force-dynamic";

/**
 * GET /api/scripts?cwd=<dir>  → merged quick scripts (global + project)
 * PUT /api/scripts?cwd=<dir>  → replace the PROJECT scripts (body { scripts })
 */
export async function GET(req: Request) {
  const cwd = new URL(req.url).searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "Missing cwd", code: "missing_cwd" }, { status: 400 });
  try {
    const project = await resolveProject(cwd);
    return NextResponse.json({ scripts: listQuickScripts(project.projectRoot) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list scripts";
    return NextResponse.json({ error: message, code: "scripts_list_failed" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const cwd = new URL(req.url).searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "Missing cwd", code: "missing_cwd" }, { status: 400 });
  try {
    const body = await req.json().catch(() => ({})) as { scripts?: unknown };
    const scripts = validateQuickScripts(body.scripts);
    if (!scripts) {
      return NextResponse.json({ error: "scripts must be an array of {name, command}", code: "invalid_scripts" }, { status: 400 });
    }
    const project = await resolveProject(cwd);
    saveProjectScripts(project.projectRoot, scripts);
    return NextResponse.json({ ok: true, scripts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save scripts";
    return NextResponse.json({ error: message, code: "scripts_save_failed" }, { status: 500 });
  }
}
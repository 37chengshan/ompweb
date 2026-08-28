import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { mkdirSync, openSync } from "fs";
import { dirname, join } from "path";
import { resolveProject } from "@/lib/worktree";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { proxyEnv } from "@/lib/proxy-config";

export const dynamic = "force-dynamic";

const WAIT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 20 * 1024;

/**
 * POST /api/scripts/run  body: { cwd, command, mode?: "wait" | "detach" }
 * - wait (default): run to completion (60s cap), return exitCode + output.
 * - detach: spawn in the background writing to a log file, return { pid, logPath }.
 * The command runs in a shell in the project root. Only allowed-root cwds pass.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { cwd?: unknown; command?: unknown; mode?: unknown };
    if (typeof body.cwd !== "string" || typeof body.command !== "string" || !body.command.trim()) {
      return NextResponse.json({ error: "cwd and command are required", code: "invalid_request" }, { status: 400 });
    }
    const mode = body.mode === "detach" ? "detach" : "wait";
    const command: string = body.command;
    const targetCwd: string = body.cwd;

    const project = await resolveProject(targetCwd);
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(project.projectRoot, allowedRoots)) {
      return NextResponse.json({ error: "Path not allowed", code: "path_not_allowed" }, { status: 403 });
    }

    if (mode === "detach") {
      const logPath = join(project.projectRoot, ".omp", "scripts-logs", `${Date.now()}.log`);
      mkdirSync(dirname(logPath), { recursive: true });
      const out = openSync(logPath, "a");
      const child = spawn(command, { cwd: project.projectRoot, shell: true, detached: true, stdio: ["ignore", out, out], env: { ...process.env, ...proxyEnv(process.env.OMP_WEB_PROXY_URL || null) } });
      child.unref();
      return NextResponse.json({ ok: true, mode: "detach", pid: child.pid, logPath });
    }

    return await new Promise<NextResponse>((resolve) => {
      const child = spawn(command, { cwd: project.projectRoot, shell: true, env: { ...process.env, ...proxyEnv(process.env.OMP_WEB_PROXY_URL || null) } });
      let output = "";
      let settled = false;
      const finish = (code: number | null, timedOut: boolean) => {
        if (settled) return;
        settled = true;
        resolve(NextResponse.json({ ok: true, mode: "wait", exitCode: code, timedOut, output }));
      };
      const timer = setTimeout(() => {
        try { child.kill("SIGTERM"); } catch { /* already dead */ }
        finish(null, true);
      }, WAIT_TIMEOUT_MS);
      child.stdout?.on("data", (d: Buffer) => {
        if (output.length < MAX_OUTPUT_BYTES) output += d.toString();
      });
      child.stderr?.on("data", (d: Buffer) => {
        if (output.length < MAX_OUTPUT_BYTES) output += d.toString();
      });
      child.on("error", (err) => { clearTimeout(timer); finish(null, false); void err; });
      child.on("exit", (code) => { clearTimeout(timer); finish(code, false); });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Script execution failed";
    return NextResponse.json({ error: message, code: "script_run_failed" }, { status: 500 });
  }
}
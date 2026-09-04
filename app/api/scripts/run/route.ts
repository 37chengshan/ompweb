import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { mkdirSync, openSync } from "fs";
import { dirname, join } from "path";
import { resolveProject } from "@/lib/worktree";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { listQuickScripts } from "@/lib/project-scripts";
import { proxyEnv } from "@/lib/proxy-config";
import { recordBackendError } from "@/lib/backend-errors";
import { hostClient, rustBackendActive } from "@/lib/omp/host-client";

export const dynamic = "force-dynamic";

const WAIT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 20 * 1024;

/**
 * POST /api/scripts/run  body: { cwd, name, mode?: "wait" | "detach" }
 * - `name` selects a quick script from the registry (project .omp/scripts.json
 *   merged with the global ~/.omp/agent/scripts.json; project wins).
 * - wait (default): run to completion (60s cap), return exitCode + output.
 * - detach: spawn in the background writing to a log file, return { pid, logPath }.
 *
 * Security model: the request body only names the script — the executable
 * text is read server-side from the local registry, so HTTP callers cannot
 * inject a command. Execution always goes through a constant literal shell
 * binary and a fixed literal argv shape (never `spawn(cmd, {shell: true})`
 * with a runtime string); the snippet being shell source is the feature's
 * contract, exactly like a Makefile target.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { cwd?: unknown; name?: unknown; mode?: unknown };
    if (typeof body.cwd !== "string" || typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "cwd and name are required", code: "invalid_request" }, { status: 400 });
    }
    const mode = body.mode === "detach" ? "detach" : "wait";
    const targetCwd: string = body.cwd;
    const scriptName: string = body.name.trim();

    const project = await resolveProject(targetCwd);
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(project.projectRoot, allowedRoots)) {
      return NextResponse.json({ error: "Path not allowed", code: "path_not_allowed" }, { status: 403 });
    }

    // Command source is the on-disk registry — never the request body.
    const script = listQuickScripts(project.projectRoot).find((s) => s.name === scriptName);
    if (!script) {
      return NextResponse.json({ error: "Unknown script", code: "invalid_request" }, { status: 404 });
    }

    const env = { ...process.env, ...proxyEnv(process.env.OMP_WEB_PROXY_URL || null) };
    const baseOptions = { cwd: project.projectRoot, shell: false as const, env };

    // Doc 16 route 12: in Rust mode the host owns script process spawning
    // (same fixed-argv security model, same 60s/20KiB/detach semantics);
    // the Node spawn path exists only for OMPWEB_BACKEND=node.
    if (rustBackendActive()) {
      try {
        const envOverrides = Object.fromEntries(
          Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        );
        const result = await hostClient.commands.run([...allowedRoots], project.projectRoot, script.command, mode === "detach", envOverrides);
        return NextResponse.json({ ok: true, ...result });
      } catch (error) {
        recordBackendError("commands_run_failed", error instanceof Error ? error.message : String(error));
        const code = typeof (error as { code?: unknown } | null)?.code === "string" ? (error as { code: string }).code : "script_run_failed";
        return NextResponse.json({ error: error instanceof Error ? error.message : String(error), code }, { status: 500 });
      }
    }

    if (mode === "detach") {
      const logPath = join(project.projectRoot, ".omp", "scripts-logs", `${Date.now()}.log`);
      mkdirSync(dirname(logPath), { recursive: true });
      const out = openSync(logPath, "a");
      const child = process.platform === "win32"
        ? spawn("cmd.exe", ["/d", "/s", "/c", script.command], { ...baseOptions, detached: true, stdio: ["ignore", out, out] })
        : spawn("/bin/sh", ["-c", script.command], { ...baseOptions, detached: true, stdio: ["ignore", out, out] });
      child.unref();
      return NextResponse.json({ ok: true, mode: "detach", pid: child.pid, logPath });
    }

    return await new Promise<NextResponse>((resolve) => {
      const child = process.platform === "win32"
        ? spawn("cmd.exe", ["/d", "/s", "/c", script.command], baseOptions)
        : spawn("/bin/sh", ["-c", script.command], baseOptions);
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

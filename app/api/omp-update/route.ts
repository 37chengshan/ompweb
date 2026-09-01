import { NextResponse } from "next/server";
import { execFileSync } from "node:child_process";
import { checkOmpUpdate, runOmpUpdateNow, runOmpUpdateStream } from "@/lib/omp/updates";
import { restartAllRpcSessions } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: unknown; stream?: unknown; port?: unknown };
    if (body.action === "check") return NextResponse.json(await checkOmpUpdate());
    if (body.action === "update") {
      if (body.stream === true) {
        const stream = new ReadableStream<string>({
          async start(controller) {
            const done = () => { try { controller.close(); } catch { /* already closed */ } };
            const fail = (error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);
              try { controller.enqueue(JSON.stringify({ type: "error", message }) + "\n"); } catch { /* closed */ }
              done();
            };
            try {
              await runOmpUpdateStream([], (line) => {
                try { controller.enqueue(JSON.stringify({ type: "out", text: line }) + "\n"); } catch { /* closed */ }
              });
              await restartAllRpcSessions();
              done();
            } catch (error) {
              fail(error);
            }
          },
        });
        return new NextResponse(stream, {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
          },
        });
      }
      const output = await runOmpUpdateNow();
      const sessionsRestarted = await restartAllRpcSessions();
      return NextResponse.json({ success: true, output: output.slice(-2000), sessionsRestarted });
    }
    if (body.action === "restart") {
      const sessionsRestarted = await restartAllRpcSessions();
      return NextResponse.json({ success: true, sessionsRestarted });
    }
    if (body.action === "stop-instance") {
      // 关闭本机其他 ompweb 端口上的旧实例（残留的开发服务/旧 app），
      // 消除会话锁冲突。只允许关闭非自身端口。
      const port = Number(body.port);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        return NextResponse.json({ error: "invalid port", code: "invalid_port" }, { status: 400 });
      }
      const selfPort = Number(
        process.env.OMP_WEB_PORT ?? process.env.PORT ?? (process.env.NODE_ENV === "production" ? "30177" : "30178"),
      );
      if (port === selfPort) {
        return NextResponse.json({ error: "refusing to stop self", code: "stop_self" }, { status: 400 });
      }
      const pid = pidOnPort(port);
      if (pid === null) {
        return NextResponse.json({ success: true, stopped: false, reason: "nothing listening" });
      }
      try {
        process.kill(pid, "SIGTERM");
        // 给进程一个优雅退出窗口，之后仍未退出则强杀。
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 1200);
        await promise;
        try {
          process.kill(pid, 0);
          process.kill(pid, "SIGKILL");
        } catch { /* already gone */ }
      } catch {
        return NextResponse.json({ error: `failed to stop pid ${pid}`, code: "stop_failed" }, { status: 500 });
      }
      return NextResponse.json({ success: true, stopped: true, pid });
    }
    return NextResponse.json(
      { error: "action must be check, restart or stop-instance", code: "invalid_action" },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

/** 找出监听指定 TCP 端口的进程 pid（macOS/Linux lsof）。 */
function pidOnPort(port: number): number | null {
  try {
    const out = execFileSync("lsof", ["-ti", `TCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const pid = Number(out.trim().split("\n")[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

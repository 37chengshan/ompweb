import { NextResponse } from "next/server";
import { exec } from "child_process";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    let targetDir = body?.cwd;
    if (!targetDir || typeof targetDir !== "string" || !fs.existsSync(targetDir)) {
      targetDir = process.cwd();
    }
    const realTargetDir = fs.realpathSync(targetDir);

    let command = "";
    let terminalName = "Terminal";

    if (process.platform === "darwin") {
      // On macOS, launch Terminal.app targeting the directory
      command = `open -a Terminal "${realTargetDir}"`;
      terminalName = "Terminal.app";
    } else if (process.platform === "win32") {
      command = `start cmd.exe /K "cd /d ${realTargetDir}"`;
      terminalName = "Command Prompt";
    } else {
      command = `x-terminal-emulator --working-directory="${realTargetDir}" || gnome-terminal --working-directory="${realTargetDir}" || xterm -e "cd '${realTargetDir}' && exec $SHELL"`;
      terminalName = "Terminal";
    }

    exec(command, (error) => {
      if (error) {
        console.error("[Terminal Open] Failed to launch terminal:", error);
      }
    });

    return NextResponse.json({ ok: true, cwd: realTargetDir, terminal: terminalName });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to open terminal";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

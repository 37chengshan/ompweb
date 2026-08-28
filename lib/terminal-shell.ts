/**
 * Shell selection for the terminal PTY, isolated from node-pty so each
 * platform branch is unit-testable. Unix shells get `-i` (interactive);
 * cmd.exe must NOT receive Unix flags.
 */

export interface TerminalShellSpec {
  shell: string;
  args: string[];
}

export function resolveTerminalShell(platform: string, env: NodeJS.ProcessEnv): TerminalShellSpec {
  if (platform === "win32") {
    return { shell: env.COMSPEC || "cmd.exe", args: [] };
  }
  const shell = env.SHELL || (platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  return { shell, args: ["-i"] };
}
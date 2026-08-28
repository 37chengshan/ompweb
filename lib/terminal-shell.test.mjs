import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./terminal-shell.ts");
}

test("Windows uses COMSPEC with no interactive args", async () => {
  const { resolveTerminalShell } = await loadSubject();
  assert.deepEqual(resolveTerminalShell("win32", { COMSPEC: "C:\\Windows\\System32\\cmd.exe" }), {
    shell: "C:\\Windows\\System32\\cmd.exe",
    args: [],
  });
});

test("Windows falls back to cmd.exe when COMSPEC is missing", async () => {
  const { resolveTerminalShell } = await loadSubject();
  assert.deepEqual(resolveTerminalShell("win32", {}), { shell: "cmd.exe", args: [] });
});

test("macOS shells run interactive with $SHELL or /bin/zsh", async () => {
  const { resolveTerminalShell } = await loadSubject();
  assert.deepEqual(resolveTerminalShell("darwin", { SHELL: "/opt/homebrew/bin/zsh" }), {
    shell: "/opt/homebrew/bin/zsh",
    args: ["-i"],
  });
  assert.deepEqual(resolveTerminalShell("darwin", {}), { shell: "/bin/zsh", args: ["-i"] });
});

test("Linux shells run interactive with $SHELL or /bin/bash", async () => {
  const { resolveTerminalShell } = await loadSubject();
  assert.deepEqual(resolveTerminalShell("linux", { SHELL: "/usr/bin/fish" }), {
    shell: "/usr/bin/fish",
    args: ["-i"],
  });
  assert.deepEqual(resolveTerminalShell("linux", {}), { shell: "/bin/bash", args: ["-i"] });
});
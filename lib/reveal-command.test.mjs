import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./reveal-command.ts");
}

test("macOS opens directories with plain open and files with open -R", async () => {
  const { buildRevealSpawn } = await loadSubject();
  assert.deepEqual(buildRevealSpawn("darwin", "/Users/cc/proj", true), { command: "open", args: ["/Users/cc/proj"] });
  assert.deepEqual(buildRevealSpawn("darwin", "/Users/cc/proj/main.ts", false), { command: "open", args: ["-R", "/Users/cc/proj/main.ts"] });
});

test("paths with spaces, quotes, and shell metacharacters stay single argv elements", async () => {
  const { buildRevealSpawn } = await loadSubject();
  const tricky = "/Users/cc/my dir/a'b&c;rm -rf ~.ts";
  assert.deepEqual(buildRevealSpawn("darwin", tricky, false), { command: "open", args: ["-R", tricky] });
  assert.deepEqual(buildRevealSpawn("win32", "C:\\my dir\\a&b.txt", false), { command: "explorer", args: ["/select,C:\\my dir\\a&b.txt"] });
});

test("Windows selects files with explorer /select, and opens directories", async () => {
  const { buildRevealSpawn } = await loadSubject();
  assert.deepEqual(buildRevealSpawn("win32", "C:\\proj\\main.ts", false), { command: "explorer", args: ["/select,C:\\proj\\main.ts"] });
  assert.deepEqual(buildRevealSpawn("win32", "C:\\proj", true), { command: "explorer", args: ["C:\\proj"] });
});

test("Linux opens the directory itself and the parent for files", async () => {
  const { buildRevealSpawn } = await loadSubject();
  assert.deepEqual(buildRevealSpawn("linux", "/home/cc/proj", true), { command: "xdg-open", args: ["/home/cc/proj"] });
  assert.deepEqual(buildRevealSpawn("linux", "/home/cc/proj/main.ts", false), { command: "xdg-open", args: ["/home/cc/proj"] });
  assert.deepEqual(buildRevealSpawn("linux", "/main.ts", false), { command: "xdg-open", args: ["/"] });
});

test("unsupported platforms throw a descriptive error", async () => {
  const { buildRevealSpawn } = await loadSubject();
  assert.throws(() => buildRevealSpawn("freebsd", "/x", true), /unsupported platform: freebsd/);
});

test("Linux slash-less relative files open the current directory, never the root", async () => {
  const { buildRevealSpawn } = await loadSubject();
  assert.deepEqual(buildRevealSpawn("linux", "README.md", false), { command: "xdg-open", args: ["."] });
  assert.deepEqual(buildRevealSpawn("linux", "/etc/passwd", false), { command: "xdg-open", args: ["/etc"] });
  assert.deepEqual(buildRevealSpawn("linux", "/", false), { command: "xdg-open", args: ["/"] });
});

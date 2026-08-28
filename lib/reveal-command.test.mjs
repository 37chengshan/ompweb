import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./reveal-command.ts");
}

test("macOS opens directories with plain open and files with open -R", async () => {
  const { buildRevealCommand } = await loadSubject();
  assert.equal(buildRevealCommand("darwin", "/Users/cc/proj", true), "open '/Users/cc/proj'");
  assert.equal(buildRevealCommand("darwin", "/Users/cc/proj/main.ts", false), "open -R '/Users/cc/proj/main.ts'");
});

test("macOS quoting survives spaces and embedded quotes", async () => {
  const { buildRevealCommand } = await loadSubject();
  assert.equal(
    buildRevealCommand("darwin", "/Users/cc/my dir/a'b.ts", false),
    "open -R '/Users/cc/my dir/a'\\''b.ts'",
  );
});

test("Windows selects files with explorer /select, and opens directories", async () => {
  const { buildRevealCommand } = await loadSubject();
  assert.equal(buildRevealCommand("win32", "C:\\proj\\main.ts", false), "explorer /select,\"C:\\proj\\main.ts\"");
  assert.equal(buildRevealCommand("win32", "C:\\proj", true), "explorer \"C:\\proj\"");
  assert.equal(buildRevealCommand("win32", "C:\\my dir\\a.txt", false), "explorer /select,\"C:\\my dir\\a.txt\"");
});

test("Linux opens the directory itself and the parent for files", async () => {
  const { buildRevealCommand } = await loadSubject();
  assert.equal(buildRevealCommand("linux", "/home/cc/proj", true), "xdg-open '/home/cc/proj'");
  assert.equal(buildRevealCommand("linux", "/home/cc/proj/main.ts", false), "xdg-open '/home/cc/proj'");
  assert.equal(buildRevealCommand("linux", "/main.ts", false), "xdg-open '/'");
});

test("unsupported platforms throw a descriptive error", async () => {
  const { buildRevealCommand } = await loadSubject();
  assert.throws(() => buildRevealCommand("freebsd", "/x", true), /unsupported platform: freebsd/);
});
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

const source = readFileSync(new URL("./main.js", import.meta.url), "utf8");
const signatures = source.slice(source.indexOf("function getOmpProcessSignatures()"), source.indexOf("function getPortOwnerPids("));
const ownership = source.slice(source.indexOf("async function isOwnedOmpProcess("), source.indexOf("async function reclaimPortIfStale("));

test("port reclaim identifies the exact hosted entrypoint, not shared executables or folders", async () => {
  const context = vm.createContext({
    path, app: { isPackaged: true }, pkgDir: "/repo/ompweb",
    process: { pid: 42, execPath: "/Applications/OmpWeb.app/Contents/MacOS/OmpWeb", resourcesPath: "/Applications/OmpWeb.app/Contents/Resources" },
    readProcessCommand: async () => context.command,
  });
  vm.runInContext(signatures + ownership, context);
  for (const command of [
    "/Applications/OmpWeb.app/Contents/MacOS/OmpWeb --some-other-process",
    "node /Applications/OmpWeb.app/Contents/Resources/other.js",
    "node /Applications/OmpWeb.app/Contents/Resources/standalone/server.js.unrelated",
  ]) {
    context.command = command.toLowerCase();
    assert.equal(await context.isOwnedOmpProcess("123"), false, command);
  }
  context.command = 'node "/Applications/OmpWeb.app/Contents/Resources/standalone/server.js"'.toLowerCase();
  assert.equal(await context.isOwnedOmpProcess("123"), true);
  assert.equal(await context.isOwnedOmpProcess("42"), false);
});

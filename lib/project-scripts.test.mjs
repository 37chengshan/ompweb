import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { validateQuickScripts, getProjectScripts, saveProjectScripts, listQuickScripts } from "./project-scripts.ts";

test("validates quick script arrays strictly", () => {
  assert.deepEqual(validateQuickScripts([{ name: "build", command: "npm run build" }]), [{ name: "build", command: "npm run build" }]);
  assert.deepEqual(validateQuickScripts([{ name: "start", command: "npm run dev", description: "dev" }]), [{ name: "start", command: "npm run dev", description: "dev" }]);
  assert.equal(validateQuickScripts("nope"), null);
  assert.equal(validateQuickScripts([{ name: "", command: "x" }]), null);
  assert.equal(validateQuickScripts([{ name: "x", command: "  " }]), null);
});

test("round-trips project scripts with atomic write", () => {
  const root = mkdtempSync(join(tmpdir(), "omp-scripts-"));
  try {
    saveProjectScripts(root, [{ name: "build", command: "npm run build" }]);
    assert.deepEqual(getProjectScripts(root), [{ name: "build", command: "npm run build" }]);
    // Later saves replace the project's own list (name collisions resolve to
    // the project copy; global scripts are merged separately by listQuickScripts).
    saveProjectScripts(root, [{ name: "build", command: "npm run build -- --prod" }, { name: "publish", command: "npm publish" }]);
    const scripts = listQuickScripts(root);
    assert.equal(scripts.find((s) => s.name === "build")?.command, "npm run build -- --prod");
    assert.equal(scripts.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
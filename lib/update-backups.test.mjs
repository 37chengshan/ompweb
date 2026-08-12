import assert from "node:assert/strict";
import test from "node:test";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { BACKUPS_ROOT, createBackup, listBackups, pruneBackups, restoreBackup, readBackupMeta } = jiti("./update-backups.ts");

function makeTree(root) {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));
  writeFileSync(join(root, "src", "index.js"), "module.exports = 1;");
  writeFileSync(join(root, "node_modules", "dep", "index.js"), "// hoisted dep, must not be snapshotted");
}

test("createBackup snapshots the tree but excludes node_modules", async () => {
  const root = join(tmpdir(), `omp-backup-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  makeTree(root);
  try {
    const backup = await createBackup(root, "fixture");
    assert.ok(readFileSync(join(backup, "package.json"), "utf8").includes("1.0.0"));
    assert.ok(readFileSync(join(backup, "src", "index.js"), "utf8").length > 0);
    assert.throws(() => readFileSync(join(backup, "node_modules", "dep", "index.js"), "utf8"));
    const meta = await readBackupMeta(backup);
    assert.equal(meta?.target, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(join(BACKUPS_ROOT, "fixture"), { recursive: true, force: true });
  }
});

test("createBackup copies a tree whose root itself lives under node_modules (global install)", async () => {
  // bun/npm global packages live under a node_modules root; the exclusion
  // filter must not exclude the tree just because the absolute path contains
  // that segment — only NESTED node_modules are skipped.
  const root = join(tmpdir(), `omp-globalroot-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, "node_modules", "@scope", "pkg");
  makeTree(root);
  try {
    const backup = await createBackup(root, "fixture");
    assert.ok(readFileSync(join(backup, "package.json"), "utf8").includes("1.0.0"));
    assert.ok(readFileSync(join(backup, "src", "index.js"), "utf8").length > 0);
    assert.throws(() => readFileSync(join(backup, "node_modules", "dep", "index.js"), "utf8"));
  } finally {
    rmSync(join(root, "..", "..", ".."), { recursive: true, force: true });
    rmSync(join(BACKUPS_ROOT, "fixture"), { recursive: true, force: true });
  }
});

test("restoreBackup puts the snapshot back after a target is wiped", async () => {
  const root = join(tmpdir(), `omp-restore-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  makeTree(root);
  try {
    const backup = await createBackup(root, "fixture");
    // Simulate a failed update replacing the tree.
    rmSync(root, { recursive: true, force: true });
    mkdirSync(join(root, "node_modules", "newdep"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", version: "9.9.9" }));

    const restored = await restoreBackup(backup);
    assert.equal(restored, root);
    assert.ok(readFileSync(join(root, "package.json"), "utf8").includes("1.0.0"));
    // The meta file must not leak into the restored tree.
    assert.throws(() => readFileSync(join(root, "backup.json"), "utf8"));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(join(BACKUPS_ROOT, "fixture"), { recursive: true, force: true });
  }
});

test("pruneBackups keeps only the newest snapshots", async () => {
  const root = join(tmpdir(), `omp-prune-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  makeTree(root);
  try {
    const created = [];
    for (let index = 0; index < 4; index += 1) {
      created.push(await createBackup(root, "fixture"));
      // Distinct timestamps so ordering is deterministic.
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal((await listBackups("fixture")).length, 4);
    const removed = await pruneBackups("fixture", 2);
    assert.equal(removed.length, 2);
    const remaining = await listBackups("fixture");
    assert.equal(remaining.length, 2);
    // listBackups is newest-first; the two kept snapshots are the last created.
    assert.deepEqual(remaining, [...created.slice(2)].reverse());
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(join(BACKUPS_ROOT, "fixture"), { recursive: true, force: true });
  }
});

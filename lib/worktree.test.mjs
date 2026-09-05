import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { addWorktree, listWorktrees, removeWorktree, resolveProject } = await jiti.import("./worktree.ts");

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

test("non-Git project aliases and Windows junctions resolve to the same session group", async () => {
  const root = mkdtempSync(join(tmpdir(), "omp-web-project-alias-"));
  try {
    const target = join(root, "测试 workspace");
    const alias = join(root, "alias");
    mkdirSync(target);
    symlinkSync(target, alias, process.platform === "win32" ? "junction" : "dir");
    const [direct, linked] = await Promise.all([resolveProject(target), resolveProject(alias)]);
    assert.equal(direct.projectRoot, realpathSync(target));
    assert.deepEqual(linked, direct);
    assert.equal(linked.isWorktree, false);
    assert.equal(linked.branch, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discovers the main checkout and linked worktrees without retaining prunable paths", async (t) => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    t.skip("git is not installed");
    return;
  }

  const root = mkdtempSync(join(tmpdir(), "omp-web-worktree-test-"));
  const repo = join(root, "repo");
  const worktreeBase = `${repo}-worktrees`;
  try {
    git(root, ["init", repo]);
    git(repo, ["config", "user.email", "omp-web@example.invalid"]);
    git(repo, ["config", "user.name", "omp-web test"]);
    writeFileSync(join(repo, "README.md"), "fixture\n");
    git(repo, ["add", "README.md"]);
    git(repo, ["commit", "-m", "fixture"]);

    const main = await resolveProject(repo);
    // macOS /var is a symlink to /private/var — compare resolved forms.
    assert.equal(realpathSync(main.projectRoot), realpathSync(repo));
    assert.equal(main.isWorktree, false);
    assert.equal(main.isTopLevel, true);
    assert.ok(main.branch);

    const created = await addWorktree(repo, "feature/test");
    assert.equal(created.branch, "feature/test");
    assert.equal(existsSync(created.path), true);

    const worktrees = await listWorktrees(repo);
    assert.equal(worktrees.length, 2);
    assert.equal(worktrees[0].isMain, true);
    assert.ok(worktrees.some((entry) => entry.path === created.path && entry.branch === "feature/test"));

    const linked = await resolveProject(created.path);
    assert.equal(realpathSync(linked.projectRoot), realpathSync(repo));
    assert.equal(linked.isWorktree, true);
    assert.equal(linked.branch, "feature/test");

    await removeWorktree(repo, created.path, true);
    assert.equal(existsSync(created.path), false);
  } finally {
    rmSync(worktreeBase, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

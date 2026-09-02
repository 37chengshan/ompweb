import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createJiti } from "jiti";

const execFileAsync = promisify(execFile);
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });

async function git(cwd, args) {
  return execFileAsync("git", ["-C", cwd, ...args], { env: { ...process.env, LC_ALL: "C" } });
}

async function makeRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ompweb-git-mutation-"));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "ompweb test"]);
  await git(root, ["config", "user.email", "ompweb@example.test"]);
  await writeFile(path.join(root, "README.md"), "initial\n");
  await git(root, ["add", "README.md"]);
  await git(root, ["commit", "-m", "initial"]);
  return root;
}

test("commitGitChanges stages and commits the current workspace", async () => {
  const root = await makeRepository();
  try {
    await writeFile(path.join(root, "change.txt"), "changed\n");
    const { commitGitChanges } = await jiti.import("./git-changes.ts");
    const result = await commitGitChanges(root, "Add change");

    assert.match(result.hash, /^[0-9a-f]+$/);
    assert.match(result.output, /Add change/);
    const status = await git(root, ["status", "--porcelain"]);
    assert.equal(status.stdout, "");
    const committed = await readFile(path.join(root, "change.txt"), "utf8");
    assert.equal(committed, "changed\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pushGitChanges creates an upstream for a branch without one", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "ompweb-git-push-"));
  const root = path.join(parent, "work");
  const remote = path.join(parent, "remote.git");
  try {
    await mkdir(root);
    await git(parent, ["init", "--bare", remote]);
    await git(root, ["init", "-b", "feature"]);
    await git(root, ["config", "user.name", "ompweb test"]);
    await git(root, ["config", "user.email", "ompweb@example.test"]);
    await git(root, ["remote", "add", "origin", remote]);
    await writeFile(path.join(root, "feature.txt"), "feature\n");
    await git(root, ["add", "feature.txt"]);
    await git(root, ["commit", "-m", "feature"]);

    const { pushGitChanges } = await jiti.import("./git-changes.ts");
    const result = await pushGitChanges(root);

    assert.equal(result.branch, "feature");
    assert.match(result.output, /new branch|feature|->/i);
    const remoteHead = await git(remote, ["show-ref", "refs/heads/feature"]);
    assert.match(remoteHead.stdout, /refs\/heads\/feature/);
    const upstream = await git(root, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
    assert.equal(upstream.stdout.trim(), "origin/feature");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

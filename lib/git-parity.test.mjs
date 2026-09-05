import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

// Doc 16 route 10 parity: the Rust git service must produce the same
// status/branches/checkout/commit/push output as lib/git-changes.ts. Node
// side runs the real implementation via jiti; Rust side runs via the CLI
// parity modes.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hostBin = join(root, "crates", "target", "debug", "ompweb-host");

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { getGitStatus, listGitBranches, commitGitChanges, pushGitChanges, getGitFileDiff } = await jiti.import("./git-changes.ts");

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
}

function fixtureRepo() {
  const dir = join(tmpdir(), `omp-git-parity-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "a.txt"), "one");
  git("init", "-b", "main", dir);
  git("-C", dir, "config", "user.name", "OmpWeb Test");
  git("-C", dir, "config", "user.email", "test@example.invalid");
  git("-C", dir, "config", "commit.gpgSign", "false");
  git("-C", dir, "add", "a.txt");
  git("-C", dir, "commit", "-m", "initial");
  git("-C", dir, "checkout", "-b", "feature");
  return dir;
}

function hostJson(args) {
  return JSON.parse(execFileSync(hostBin, args, { encoding: "utf8" }));
}

test("git parity: status matches Node getGitStatus", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : false }, async () => {
  const dir = fixtureRepo();
  writeFileSync(join(dir, "b.txt"), "two");
  const rust = hostJson(["--git-status", dir]);
  const node = await getGitStatus(dir);
  assert.equal(rust.isGitRepository, node.isGitRepository);
  assert.equal(rust.branch, node.branch);
  assert.equal(rust.upstream, node.upstream);
  assert.equal(rust.ahead, node.ahead);
  assert.equal(rust.behind, node.behind);
  // Guard against empty-vs-empty parity blind spots: the untracked file must
  // actually surface on BOTH sides.
  assert.ok(rust.files.length > 0, "rust status must see the untracked file");
  assert.ok(node.files.length > 0, "node status must see the untracked file");
  assert.deepEqual(rust.files, node.files);
});

test("git parity: non-repo status shape matches Node", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : false }, async () => {
  const dir = join(tmpdir(), `omp-git-plain-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const rust = hostJson(["--git-status", dir]);
  const node = await getGitStatus(dir);
  assert.deepEqual(rust, node);
});

test("git parity: branches match Node listGitBranches", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : false }, async () => {
  const dir = fixtureRepo();
  const rust = hostJson(["--git-branches", dir]);
  const node = await listGitBranches(dir);
  assert.deepEqual(rust, node);
});

test("git parity: checkout switches branch and reports current", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : false }, async () => {
  const dir = fixtureRepo();
  const rust = hostJson(["--git-checkout", dir, "main"]);
  assert.deepEqual(rust, { branch: "main" });
  const node = await listGitBranches(dir);
  assert.equal(node.find((b) => b.current).name, "main");
});

test("git parity: commit matches Node commitGitChanges", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : false }, async () => {
  const dirA = fixtureRepo();
  writeFileSync(join(dirA, "c1.txt"), "one");
  const rust = hostJson(["--git-commit", dirA, "rust commit"]);
  assert.ok(rust.hash && /^[0-9a-f]+$/.test(rust.hash));
  assert.match(rust.output, /rust commit/);

  const dirB = fixtureRepo();
  writeFileSync(join(dirB, "c2.txt"), "two");
  const node = await commitGitChanges(dirB, "node commit");
  assert.ok(node.hash && /^[0-9a-f]+$/.test(node.hash));
  assert.match(node.output, /node commit/);
});

test("git parity: diff matches Node getGitFileDiff for modified + untracked", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : false }, async () => {
  // Modified tracked file — Rust and Node must produce byte-equal patches.
  const dirA = fixtureRepo();
  writeFileSync(join(dirA, "a.txt"), "one\nchanged-by-rust\n");
  const rustMod = hostJson(["--git-diff", dirA, join(dirA, "a.txt")]);
  const nodeMod = await getGitFileDiff(dirA, join(dirA, "a.txt"));
  assert.deepEqual(rustMod, nodeMod);
  assert.equal(rustMod.supported, true);
  assert.equal(rustMod.status, "modified");
  assert.match(rustMod.patch, /\+changed-by-rust/);

  // Untracked file — both synthesize the added-file patch identically.
  const dirB = fixtureRepo();
  writeFileSync(join(dirB, "fresh.txt"), "brand new content");
  const rustNew = hostJson(["--git-diff", dirB, join(dirB, "fresh.txt")]);
  const nodeNew = await getGitFileDiff(dirB, join(dirB, "fresh.txt"));
  assert.deepEqual(rustNew, nodeNew);
  assert.equal(rustNew.supported, true);
  assert.equal(rustNew.status, "untracked");
  assert.match(rustNew.patch, /new file mode 100644/);

  // Deleted file — both report unsupported.
  const dirC = fixtureRepo();
  const deletedPath = join(dirC, "gone.txt");
  writeFileSync(deletedPath, "bye");
  git("-C", dirC, "add", "gone.txt");
  git("-C", dirC, "commit", "-m", "add gone");
  // Remove both the file and (untracked deletion means git sees nothing);
  // stage the deletion so status reports `deleted`.
  git("-C", dirC, "rm", "gone.txt");
  const rustDel = hostJson(["--git-diff", dirC, deletedPath]);
  const nodeDel = await getGitFileDiff(dirC, deletedPath);
  assert.deepEqual(rustDel, nodeDel);
  assert.equal(rustDel.supported, false);
});

test("git parity: push to a bare remote matches Node pushGitChanges", { skip: !existsSync(hostBin) ? "ompweb-host binary not built" : false }, async () => {
  const unique = Math.random().toString(36).slice(2, 8);

  const remoteA = join(tmpdir(), `omp-git-remote-${process.pid}-${unique}-a`);
  mkdirSync(remoteA, { recursive: true });
  git("init", "--bare", remoteA);
  const dirA = fixtureRepo();
  writeFileSync(join(dirA, "p1.txt"), "one");
  git("-C", dirA, "add", "-A");
  git("-C", dirA, "commit", "-m", "first");
  git("-C", dirA, "remote", "add", "origin", remoteA);
  const rust = hostJson(["--git-push", dirA]);
  assert.equal(rust.branch, "feature");
  const remoteABranches = git("--git-dir", remoteA, "branch", "--list").trim();
  assert.match(remoteABranches, /feature/);

  const remoteB = join(tmpdir(), `omp-git-remote-${process.pid}-${unique}-b`);
  mkdirSync(remoteB, { recursive: true });
  git("init", "--bare", remoteB);
  const dirB = fixtureRepo();
  writeFileSync(join(dirB, "p2.txt"), "two");
  git("-C", dirB, "add", "-A");
  git("-C", dirB, "commit", "-m", "second");
  git("-C", dirB, "remote", "add", "origin", remoteB);
  const node = await pushGitChanges(dirB);
  assert.equal(node.branch, "feature");
});

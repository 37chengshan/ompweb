// Route 3 (doc 16): production ompweb-host binary resolution ladder —
// explicit env → packaged geometry → workspace (module/cwd) → none, and the
// fail-closed RuntimeUnavailable semantics (no silent Node authority fallback).
import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { RuntimeUnavailableError, assertHostAvailable, hostBinRemediation, resolveHostBin, resolveModuleDir } = await jiti.import("./host-bin.ts");

function makeTree() {
  const tree = mkdtempSync(join(tmpdir(), "hostbin-"));
  return tree;
}

function touch(...parts) {
  const file = join(...parts);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, "binary");
  return file;
}

test("route 3: explicit OMPWEB_HOST_BIN wins over every other layout", (t) => {
  const tree = makeTree();
  t.after(() => rmSync(tree, { recursive: true, force: true }));
  const repoBin = touch(tree, "repo", "crates", "target", "debug", "ompweb-host");
  const explicitBin = touch(tree, "opt", "ompweb-host");
  const resolution = resolveHostBin({ platform: "linux", env: { OMPWEB_HOST_BIN: explicitBin }, moduleDir: tree, cwd: tree });
  assert.equal(resolution.mode, "explicit");
  assert.equal(resolution.path, explicitBin);
  assert.equal(resolution.exists, true);
  assert.notEqual(resolution.path, repoBin);
});

test("route 3: an explicit path that does not exist is authoritative (exists=false)", (t) => {
  const tree = makeTree();
  t.after(() => rmSync(tree, { recursive: true, force: true }));
  const resolution = resolveHostBin({
    env: { OMPWEB_HOST_BIN: join(tree, "missing", "ompweb-host") },
    moduleDir: tree,
    cwd: tree,
  });
  assert.equal(resolution.mode, "explicit");
  assert.equal(resolution.exists, false);
});

test("route 3: packaged geometry resolves <exec>/../Resources/bin", (t) => {
  const tree = makeTree();
  t.after(() => rmSync(tree, { recursive: true, force: true }));
  const execPath = join(tree, "OmpWeb.app", "Contents", "MacOS", "OmpWeb");
  const packagedBin = touch(tree, "OmpWeb.app", "Contents", "Resources", "bin", "ompweb-host");
  const resolution = resolveHostBin({ platform: "linux", execPath, moduleDir: tree, cwd: tree });
  assert.equal(resolution.mode, "packaged");
  assert.equal(resolution.path, packagedBin);
  assert.equal(resolution.exists, true);
});

test("route 3: npm vendor layout resolves <pkg>/vendor/ompweb-host/<platform>-<arch>", (t) => {
  const tree = makeTree();
  t.after(() => rmSync(tree, { recursive: true, force: true }));
  // npm global install: package root = repo/lib/omp/../../.. -> vendor at root
  const vendorBin = touch(tree, "pkg", "vendor", "ompweb-host", "linux-x64", "ompweb-host");
  const moduleDir = join(tree, "pkg", "lib", "omp");
  const resolution = resolveHostBin({ platform: "linux", arch: "x64", moduleDir, cwd: join(tree, "elsewhere") });
  assert.equal(resolution.mode, "workspace");
  assert.equal(resolution.path, vendorBin);
  assert.equal(resolution.exists, true);
});

test("route 3: npm vendor layout climbs past lib/omp to the package root", (t) => {
  const tree = makeTree();
  t.after(() => rmSync(tree, { recursive: true, force: true }));
  const vendorBin = touch(tree, "pkg", "vendor", "ompweb-host", "darwin-arm64", "ompweb-host");
  // Bundled server: moduleDir deep under .next/server; still climbs to root.
  const moduleDir = join(tree, "pkg", ".next", "server", "chunks", "deep");
  const resolution = resolveHostBin({ platform: "darwin", arch: "arm64", moduleDir, cwd: tree });
  assert.equal(resolution.path, vendorBin);
  assert.equal(resolution.exists, true);
});

test("route 3: npm vendor layout rejects binaries without an architecture tag", (t) => {
  const tree = makeTree();
  t.after(() => rmSync(tree, { recursive: true, force: true }));
  const legacyBin = touch(tree, "pkg", "vendor", "ompweb-host", "linux", "ompweb-host");
  const resolution = resolveHostBin({ platform: "linux", arch: "x64", moduleDir: join(tree, "pkg", "lib"), cwd: tree });
  assert.notEqual(resolution.path, legacyBin);
  assert.equal(resolution.exists, false);
});

test("route 3: workspace module candidate (dev/CI repo layout) resolves first", (t) => {
  const tree = makeTree();
  t.after(() => rmSync(tree, { recursive: true, force: true }));
  const moduleBin = touch(tree, "repo", "crates", "target", "debug", "ompweb-host");
  const moduleDir = join(tree, "repo", "lib", "omp");
  const resolution = resolveHostBin({ platform: "linux", moduleDir, cwd: join(tree, "elsewhere") });
  assert.equal(resolution.mode, "workspace");
  assert.equal(resolution.path, moduleBin);
});

test("installed package host wins over a baked build-machine module URL", (t) => {
  const tree = makeTree();
  t.after(() => rmSync(tree, { recursive: true, force: true }));
  const installed = touch(tree, "installed", "vendor", "ompweb-host", "linux-x64", "ompweb-host");
  touch(tree, "builder", "vendor", "ompweb-host", "linux-x64", "ompweb-host");
  const resolution = resolveHostBin({ platform: "linux", arch: "x64", env: { OMP_WEB_PACKAGE_DIR: join(tree, "installed") }, cwd: join(tree, "installed"), moduleDir: join(tree, "builder", "lib", "omp") });
  assert.equal(resolution.path, installed);
});

test("route 3: standalone cwd candidate resolves when the module layout has no build", (t) => {
  const tree = makeTree();
  t.after(() => rmSync(tree, { recursive: true, force: true }));
  const cwdBin = touch(tree, "standalone", "crates", "target", "debug", "ompweb-host");
  const resolution = resolveHostBin({ platform: "linux", moduleDir: join(tree, "elsewhere", "lib"), cwd: join(tree, "standalone") });
  assert.equal(resolution.mode, "workspace");
  assert.equal(resolution.path, cwdBin);
});

test("route 3: no candidate -> mode none with the module candidate as the reported path", (t) => {
  const tree = makeTree();
  t.after(() => rmSync(tree, { recursive: true, force: true }));
  const moduleDir = join(tree, "repo", "lib", "omp");
  const resolution = resolveHostBin({ platform: "linux", moduleDir, cwd: join(tree, "repo") });
  assert.equal(resolution.mode, "none");
  assert.equal(resolution.exists, false);
  assert.equal(resolution.path, join(tree, "repo", "crates", "target", "debug", "ompweb-host"));
});

test("route 3: windows picks the .exe name", (t) => {
  const tree = makeTree();
  t.after(() => rmSync(tree, { recursive: true, force: true }));
  const exe = join(tree, "win", "crates", "target", "debug", "ompweb-host.exe");
  const resolution = resolveHostBin({
    platform: "win32",
    moduleDir: join(tree, "win", "lib", "omp"),
    cwd: tree,
    exists: (p) => p === exe,
  });
  assert.equal(resolution.mode, "workspace");
  assert.equal(resolution.path, exe);
});

test("route 3: a non-absolute bundled file URL falls back to cwd instead of crashing the host boundary", () => {
  const fallback = process.platform === "win32" ? "C:\\ompweb" : "/ompweb";
  assert.equal(
    resolveModuleDir("file:relative-server-bundle.js", fallback, () => {
      throw new TypeError("File URL path must be absolute");
    }),
    fallback,
  );
});

test("route 3: an absolute module URL still supplies the workspace lookup directory", () => {
  const fallback = process.platform === "win32" ? "C:\\fallback" : "/fallback";
  const expected = process.platform === "win32" ? "C:\\repo\\lib\\omp" : "/repo/lib/omp";
  assert.equal(
    resolveModuleDir("file:///opaque-module.ts", fallback, () => `${expected}${process.platform === "win32" ? "\\" : "/"}host-client.ts`),
    expected,
  );
});

test("route 3: assertHostAvailable throws RuntimeUnavailableError when absent", (t) => {
  const tree = makeTree();
  t.after(() => rmSync(tree, { recursive: true, force: true }));
  assert.throws(() => assertHostAvailable({ moduleDir: tree, cwd: tree }), (error) => {
    assert.ok(error instanceof RuntimeUnavailableError);
    assert.equal(error.code, "runtime_unavailable");
    return true;
  });
});

test("route 3: createRpcProcess fails closed instead of silently falling back to Node", async (t) => {
  const savedBackend = process.env.OMPWEB_BACKEND;
  const savedHostBin = process.env.OMPWEB_HOST_BIN;
  t.after(() => {
    if (savedBackend === undefined) delete process.env.OMPWEB_BACKEND;
    else process.env.OMPWEB_BACKEND = savedBackend;
    if (savedHostBin === undefined) delete process.env.OMPWEB_HOST_BIN;
    else process.env.OMPWEB_HOST_BIN = savedHostBin;
  });
  process.env.OMPWEB_HOST_BIN = join(tmpdir(), "definitely-missing-ompweb-host");
  delete process.env.OMPWEB_BACKEND;
  const rust = await jiti.import("./rust-rpc-process.ts");
  await assert.rejects(
    rust.createRpcProcess({ cwd: tmpdir(), sessionId: "route3-missing-host" }),
    (error) => error.name === "RuntimeUnavailableError" && error.code === "runtime_unavailable",
  );
});

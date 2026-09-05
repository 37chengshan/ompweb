import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const desktopWorkflow = fs.readFileSync(path.join(root, ".github", "workflows", "build-desktop.yml"), "utf8");

test("desktop packaging explicitly preserves Next's hidden runtime directory", () => {
  assert.ok(packageJson.build.extraResources.some((resource) => (
    resource.from === ".next/standalone/.next"
    && resource.to === "standalone/.next"
  )));
  assert.ok(packageJson.build.extraResources.some((resource) => (
    resource.from === ".next/standalone/.omp"
    && resource.to === "standalone/.omp"
  )));
  assert.ok(packageJson.build.extraResources.some((resource) => (
    resource.from === ".next/standalone/crates"
    && resource.to === "standalone/crates"
  )));
});

test("desktop CI builds the Rust host before tracing and packaging", () => {
  assert.match(desktopWorkflow, /dtolnay\/rust-toolchain@stable/);
  assert.match(desktopWorkflow, /cargo build --locked --manifest-path crates\/Cargo\.toml --bin ompweb-host/);
  assert.ok(desktopWorkflow.indexOf("cargo build --locked") < desktopWorkflow.indexOf("npm run build"));
});
test("desktop packaging ships the Rust host at Resources/bin (route 3)", () => {
  // extraResources stages build-resources/host (scripts/stage-host.mjs) into
  // <app>/Contents/Resources/bin — the formal packaged binary location, not
  // the incidental standalone-trace copy.
  assert.ok(packageJson.build.extraResources.some((resource) => (
    resource.from === "build-resources/host"
    && resource.to === "bin"
  )));
  assert.match(desktopWorkflow, /npm run host:stage/);
  assert.ok(desktopWorkflow.indexOf("npm run host:stage") > desktopWorkflow.indexOf("npm run build"));
  // The Electron main process injects OMPWEB_HOST_BIN so the standalone
  // server (spawned under a system node) resolves the packaged binary.
  const mainJs = fs.readFileSync(path.join(root, "desktop", "main.js"), "utf8");
  assert.match(mainJs, /OMPWEB_HOST_BIN/);
  assert.match(mainJs, /process\.resourcesPath, "bin"/);
});

test("manual desktop builds upload artifacts without publishing a branch as a GitHub Release", () => {
  assert.match(desktopWorkflow, /publish-release:\s+#[\s\S]*?if: github\.ref_type == 'tag'/);
});

test("Windows desktop services stay headless and do not create a detached console", () => {
  const mainJs = fs.readFileSync(path.join(root, "desktop", "main.js"), "utf8");
  assert.match(mainJs, /detached: process\.platform !== "win32"/);
  assert.match(mainJs, /windowsHide: true/);
  const host = fs.readFileSync(path.join(root, "lib", "omp", "rust-rpc-process.ts"), "utf8");
  assert.match(host, /spawn\(hostResolution\.path, \["--ipc"\], \{[\s\S]{0,160}windowsHide: true/);
  const visibility = fs.readFileSync(path.join(root, "crates", "ompweb-host", "src", "process_visibility.rs"), "utf8");
  assert.match(visibility, /creation_flags\(0x0800_0000\)/);
  for (const service of ["supervisor.rs", "command_service.rs", "settings_service.rs", "git_service.rs"]) {
    const source = fs.readFileSync(path.join(root, "crates", "ompweb-host", "src", service), "utf8");
    assert.match(source, /hide_console_window/);
  }
});

test("desktop server startup and Rust host lifecycle cannot churn background processes", () => {
  const mainJs = fs.readFileSync(path.join(root, "desktop", "main.js"), "utf8");
  assert.match(mainJs, /let serverStartPromise = null/);
  assert.match(mainJs, /if \(serverStartPromise\) return serverStartPromise/);
  const host = fs.readFileSync(path.join(root, "lib", "omp", "rust-rpc-process.ts"), "utf8");
  assert.match(host, /The host owns every production service domain/);
  assert.doesNotMatch(host, /teardownTimer/);
  const releaseBody = host.match(/release\(\): void \{([\s\S]*?)\n  \}\n\n  private teardown/);
  assert.ok(releaseBody, "Rust host release implementation is present");
  assert.doesNotMatch(releaseBody[1], /setTimeout/);
});

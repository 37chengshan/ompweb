// Route 3 (doc 16): stage the built ompweb-host into the layout the runtime
// expects. Two consumers:
//
//   npm run host:stage            # default: build-resources/host so
//                                 # electron-builder ships it at
//                                 # <app>/Resources/bin/ompweb-host (desktop)
//   npm run host:stage -- --vendor  # vendor/ompweb-host/<platform>-<arch>/
//                                 # so the published npm package carries the
//                                 # prebuilt host (host-bin.ts vendor probe)
//
// The npm package is cross-platform: the release pipeline runs this per
// platform/arch on a build matrix and merges the artifacts before publish.
//
//   npm run host:build   # cargo build --locked -p manifest crates/Cargo.toml --bin ompweb-host
//   npm run host:stage   # this script
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const exe = process.platform === "win32" ? "ompweb-host.exe" : "ompweb-host";
const from = join(root, "crates", "target", "debug", exe);
const toVendor = process.argv.includes("--vendor");

// Map Node's platform/arch to the publish tag set used by host-bin.ts
// vendorArch(): { platform }-{ arch }, e.g. darwin-arm64, linux-x64.
function vendorPlatform() {
  switch (process.platform) {
    case "darwin": return "darwin";
    case "win32": return "win32";
    case "linux": return "linux";
    default: return process.platform;
  }
}
function vendorArch() {
  // Node arch names already match the publish set (x64/arm64); normalize the
  // few odd ones the same way host-bin.ts does.
  const arch = process.arch;
  if (arch === "x64" || arch === "arm64") return arch;
  return arch;
}

const stageDir = toVendor
  ? join(root, "vendor", "ompweb-host", `${vendorPlatform()}-${vendorArch()}`)
  : join(root, "build-resources", "host");
const to = join(stageDir, exe);

if (!existsSync(from)) {
  console.error(`stage-host: build artifact missing at ${from}`);
  console.error("Run `npm run host:build` first (cargo build --locked --manifest-path crates/Cargo.toml --bin ompweb-host).");
  process.exit(1);
}

// Keep only the current platform's binary in the staged dir so electron-builder
// never ships a foreign executable under Resources/bin, and the npm vendor
// dir never carries a stale foreign binary for this platform/arch.
mkdirSync(stageDir, { recursive: true });
for (const name of ["ompweb-host", "ompweb-host.exe"]) {
  rmSync(join(stageDir, name), { force: true });
}
copyFileSync(from, to);
console.log(`stage-host: ${from} -> ${to}`);

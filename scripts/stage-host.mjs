// Route 3 (doc 16): stage the built ompweb-host into build-resources/host so
// electron-builder can ship it at <app>/Resources/bin/ompweb-host — the
// formal packaged layout. Replaces the incidental standalone-trace copy as
// the desktop runtime source (desktop/main.js injects OMPWEB_HOST_BIN).
//
//   npm run host:build   # cargo build --locked -p manifest crates/Cargo.toml --bin ompweb-host
//   npm run host:stage   # this script
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const exe = process.platform === "win32" ? "ompweb-host.exe" : "ompweb-host";
const from = join(root, "crates", "target", "debug", exe);
const stageDir = join(root, "build-resources", "host");
const to = join(stageDir, exe);

if (!existsSync(from)) {
  console.error(`stage-host: build artifact missing at ${from}`);
  console.error("Run `npm run host:build` first (cargo build --locked --manifest-path crates/Cargo.toml --bin ompweb-host).");
  process.exit(1);
}

// Keep only the current platform's binary in the staged dir so electron-builder
// never ships a foreign executable under Resources/bin.
mkdirSync(stageDir, { recursive: true });
for (const name of ["ompweb-host", "ompweb-host.exe"]) {
  rmSync(join(stageDir, name), { force: true });
}
copyFileSync(from, to);
console.log(`stage-host: ${from} -> ${to}`);

// Post-build step: Next standalone output does not copy .next/static (its
// docs require a manual copy for deployment). The desktop app and the
// ompweb CLI both serve from .next/standalone — without this copy, chunk
// requests 404 with text/plain and the renderer never hydrates.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, ".next", "static");
const to = join(root, ".next", "standalone", ".next", "static");

if (!existsSync(from)) {
  console.error("postbuild: source .next/static missing — did the build finish?");
  process.exit(1);
}
cpSync(from, to, { recursive: true });
console.log(`postbuild: copied ${from} -> ${to}`);

// Keep the hidden standalone runtime directory present for older Electron
// packaging layouts. The production host is now staged separately at
// Resources/bin, but electron-builder still declares standalone/crates as a
// compatibility resource and warns when the source directory is absent.
mkdirSync(join(root, ".next", "standalone", "crates"), { recursive: true });

// The desktop may use a system Node executable, which cannot require files
// from app.asar. Keep the HTTP-boundary preload in the external server tree.
const serverBin = join(root, ".next", "standalone", "bin");
mkdirSync(serverBin, { recursive: true });
for (const name of ["request-peer.js", "request-peer-preload.js"]) {
  cpSync(join(root, "bin", name), join(serverBin, name));
}

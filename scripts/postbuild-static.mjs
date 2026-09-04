// Post-build step: Next standalone output does not copy .next/static (its
// docs require a manual copy for deployment). The desktop app and the
// ompweb CLI both serve from .next/standalone — without this copy, chunk
// requests 404 with text/plain and the renderer never hydrates.
import { cpSync, existsSync } from "node:fs";
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

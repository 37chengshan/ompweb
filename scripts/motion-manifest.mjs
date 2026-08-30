// Motion manifest CLI: writes or checks the committed animation golden.
//
//   node scripts/motion-manifest.mjs            → write baseline/motion-manifest.json
//   node scripts/motion-manifest.mjs --check    → exit 1 if the animation surface drifted
//
// Any drift is a deliberate visual change: regenerate the golden in the same
// PR and say so in the description (5.0 docs 10/12 — no silent animation edits).

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { buildMotionManifest, diffManifest, REPO_ROOT } from "./lib/motion-surface.mjs";

const GOLDEN = path.join(REPO_ROOT, "docs", "refactor", "ompweb-5.0", "baseline", "motion-manifest.json");

if (process.argv.includes("--check")) {
  const committed = JSON.parse(readFileSync(GOLDEN, "utf8"));
  const problems = diffManifest(committed, buildMotionManifest());
  if (problems.length) {
    console.error(
      "motion manifest drift detected (deliberate visual change required to accept):\n" +
        problems.map((p) => `  - ${p}`).join("\n") +
        "\nIf intentional: node scripts/motion-manifest.mjs",
    );
    process.exit(1);
  }
  console.log(
    `motion manifest in sync: ${Object.keys(committed.globals.keyframes).length} keyframes, ` +
      `${Object.keys(committed.components).length} component surfaces`,
  );
} else {
  mkdirSync(path.dirname(GOLDEN), { recursive: true });
  const manifest = buildMotionManifest();
  writeFileSync(GOLDEN, JSON.stringify(manifest, null, 2) + "\n");
  console.log(
    `motion manifest written: ${Object.keys(manifest.globals.keyframes).length} keyframes, ` +
      `${Object.keys(manifest.components).length} component surfaces`,
  );
}

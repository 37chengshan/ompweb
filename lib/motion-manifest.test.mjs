import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

// 5.0 W0 animation gate: the committed motion golden must match the live CSS /
// component surface. Deletions, re-timing, easing changes, reduced-motion edits
// and splash/theme animation changes all fail here until the golden is
// regenerated deliberately (node scripts/motion-manifest.mjs).

test("motion manifest matches the committed golden", () => {
  const stdout = execFileSync(
    process.execPath,
    ["scripts/motion-manifest.mjs", "--check"],
    { encoding: "utf8", cwd: new URL("..", import.meta.url).pathname },
  );
  assert.match(stdout, /motion manifest in sync/);
});

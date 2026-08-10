import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isNewerVersion } = jiti("./npm-update.ts");

test("recognizes newer npm package versions", () => {
  assert.equal(isNewerVersion("0.2.1", "0.2.0"), true);
  assert.equal(isNewerVersion("1.0.0", "0.9.9"), true);
  assert.equal(isNewerVersion("0.2.0", "0.2.0"), false);
  assert.equal(isNewerVersion("0.1.9", "0.2.0"), false);
});

test("only treats a stable build as newer than the matching prerelease", () => {
  assert.equal(isNewerVersion("0.2.0", "0.2.0-beta.1"), true);
  assert.equal(isNewerVersion("0.2.0-beta.2", "0.2.0"), false);
  assert.equal(isNewerVersion("latest", "0.2.0"), false);
});

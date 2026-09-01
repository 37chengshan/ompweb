import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

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

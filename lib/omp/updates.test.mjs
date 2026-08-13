import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { parseOmpUpdateStatus } = jiti("./updates.ts");

test("parses OMP update availability without assuming an update exists", () => {
  assert.deepEqual(parseOmpUpdateStatus("Current version: 17.2.11\nNew version available: 17.2.12"), {
    currentVersion: "17.2.11",
    availableVersion: "17.2.12",
    updateAvailable: true,
    updateCommand: "omp update",
  });
  assert.deepEqual(parseOmpUpdateStatus("Current version: 17.2.12\nOMP is up to date"), {
    currentVersion: "17.2.12",
    availableVersion: null,
    updateAvailable: false,
    updateCommand: "omp update",
  });
});

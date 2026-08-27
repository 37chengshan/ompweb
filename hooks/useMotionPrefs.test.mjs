import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { DEFAULT_MOTION_PREFS, getMotionPrefs, saveMotionPrefs, applyMotionPrefsToDom } = await jiti.import("./useMotionPrefs.ts");

test("manages motion preferences and default values", () => {
  assert.equal(DEFAULT_MOTION_PREFS.enabled, true);
  assert.equal(DEFAULT_MOTION_PREFS.chatBorderBeam, true);
  assert.equal(DEFAULT_MOTION_PREFS.ompBouncing, true);
  assert.equal(DEFAULT_MOTION_PREFS.thinkingPulse, true);
  assert.equal(DEFAULT_MOTION_PREFS.beamSpeed, 5.5);

  const prefs = getMotionPrefs();
  assert.equal(typeof prefs.enabled, "boolean");
});

test("updates motion preferences and saves changes", () => {
  saveMotionPrefs({ chatBorderBeam: false, beamSpeed: 8 });
  const updated = getMotionPrefs();
  assert.equal(updated.chatBorderBeam, false);
  assert.equal(updated.beamSpeed, 8);

  // Restore defaults
  saveMotionPrefs(DEFAULT_MOTION_PREFS);
  const restored = getMotionPrefs();
  assert.equal(restored.chatBorderBeam, true);
  assert.equal(restored.beamSpeed, 5.5);
});

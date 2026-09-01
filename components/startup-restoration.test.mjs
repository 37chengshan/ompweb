import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const appShell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const bootSkeleton = await readFile(new URL("./BootSkeleton.tsx", import.meta.url), "utf8");
const bootSkeletonSignal = await readFile(new URL("../lib/boot-skeleton.ts", import.meta.url), "utf8");

test("startup waits for restoration instead of inferring a new chat from the active workspace", () => {
  assert.match(appShell, /const \[initialSessionRestored, setInitialSessionRestored\] = useState\(false\)/);
  assert.match(appShell, /const effectiveNewSessionCwd = newSessionCwd;/);
  assert.doesNotMatch(appShell, /selectedSession === null && activeCwd \? activeCwd/);
  assert.match(appShell, /if \(initialSessionRestored\) removeBootSkeleton\(\{ fade: true \}\)/);
});

test("boot skeleton stays React-owned while routes request dismissal", () => {
  assert.match(bootSkeleton, /setVisible\(false\)/);
  assert.match(bootSkeletonSignal, /BOOT_SKELETON_READY_EVENT/);
  assert.match(bootSkeletonSignal, /dispatchEvent\(new CustomEvent/);
  assert.doesNotMatch(bootSkeletonSignal, /document\.getElementById\("boot-skeleton"\)|skeleton\.remove\(\)/);
});

test("sidebar restores the remembered session before choosing an empty workspace", () => {
  assert.match(sidebar, /getLastOpenSession/);
  assert.match(sidebar, /const rememberedSessionId = initialSessionId \|\| \(defaultWorkspace \? getLastOpenSession\(defaultWorkspace\) : null\)/);
  assert.match(sidebar, /if \(restoredRef\.current \|\| loading \|\| !projectsLoadedRef\.current\) return;/);
  assert.match(sidebar, /stale remembered id must fall through/);
  assert.match(sidebar, /mostRecentSessionForWorkspace/);
});

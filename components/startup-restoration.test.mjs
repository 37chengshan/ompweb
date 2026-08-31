import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const appShell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");

test("startup waits for restoration instead of inferring a new chat from the active workspace", () => {
  assert.match(appShell, /const \[initialSessionRestored, setInitialSessionRestored\] = useState\(false\)/);
  assert.match(appShell, /const effectiveNewSessionCwd = newSessionCwd;/);
  assert.doesNotMatch(appShell, /selectedSession === null && activeCwd \? activeCwd/);
  assert.match(appShell, /if \(initialSessionRestored\) removeBootSkeleton\(\{ fade: true \}\)/);
});

test("sidebar restores the remembered session before choosing an empty workspace", () => {
  assert.match(sidebar, /getLastOpenSession/);
  assert.match(sidebar, /const rememberedSessionId = initialSessionId \|\| \(defaultWorkspace \? getLastOpenSession\(defaultWorkspace\) : null\)/);
  assert.match(sidebar, /if \(restoredRef\.current \|\| loading \|\| !projectsLoadedRef\.current\) return;/);
});

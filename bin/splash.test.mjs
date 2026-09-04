import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const splash = await readFile(new URL("../desktop/splash.html", import.meta.url), "utf8");
const preload = await readFile(new URL("../desktop/preload.js", import.meta.url), "utf8");
const main = await readFile(new URL("../desktop/main.js", import.meta.url), "utf8");
const appShell = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");

test("skipping the splash never navigates before the server is ready", () => {
  assert.match(splash, /if \(!serverReady\) return;/);
  assert.match(splash, /skipRequested = true;\s*showOverlay\(true\);\s*tryGo\(\);/);
  assert.match(splash, /setTimeout\(\(\) => \{\s*skipRequested = true;\s*showOverlay\(\);\s*tryGo\(\);\s*\}, 8000\);/s);
  assert.doesNotMatch(splash, /showOverlay\(\);\s*go\(\);/);
});

test("splash can recover a server-ready event emitted before its listener", () => {
  assert.match(preload, /isServerReady: \(\) => ipcRenderer\.invoke\("desktop-server-ready-state"\)/);
  assert.match(main, /ipcMain\.handle\("desktop-server-ready-state", \(\) => serverReady\)/);
  assert.match(splash, /isServerReady\?\.\(\)/);
});
test("terminal failure shows an actionable in-splash error panel (T1.4)", () => {
  assert.match(splash, /id="error-panel"/);
  assert.match(splash, /bridge\.onServerError\(/);
  assert.match(splash, /retryStartup\(\)/);
  assert.match(splash, /id="error-quit"/);
  assert.match(preload, /onServerError: \(callback\) =>/);
  assert.match(preload, /retryStartup: \(\) => ipcRenderer\.invoke\("startup-retry"\)/);
  assert.match(main, /ipcMain\.handle\("startup-retry"/);
});

test("startup stage machine is wired end to end (T1.3/T1.6)", () => {
  assert.match(main, /startup\.record\("listening"/);
  assert.match(main, /ipcMain\.on\("startup-stage"/);
  assert.match(preload, /startupStage: \(stage\) => ipcRenderer\.send\("startup-stage", stage\)/);
  assert.match(main, /ipcMain\.handle\("get-startup-report", \(\) => startup\.report\(\)\)/);
  assert.match(splash, /startupStage\?\.\("assets_warmed"\)/);
  assert.match(appShell, /startupStage\?\.\("shell_mounted"\)/);
  assert.match(appShell, /startupStage\?\.\("session_interactive"\)/);
});

test("health readiness requires the dedicated endpoint with the app version (T1.7)", async () => {
  assert.match(main, /createHealthProbe\(\{/);
  assert.match(main, /\/api\/health/);
  assert.match(main, /expectedAppVersion: app\.getVersion\(\)/);
  const healthRoute = await readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8");
  assert.match(healthRoute, /ok: true/);
  assert.match(healthRoute, /app: pkg\.version/);
  assert.match(healthRoute, /ompReady/);
  assert.match(healthRoute, /getOmpVersion/);
});

test("skeleton follows the theme variables, no hardcoded light flash (T1.5)", async () => {
  const skeleton = await readFile(new URL("../components/BootSkeleton.tsx", import.meta.url), "utf8");
  assert.match(skeleton, /background: "var\(--bg/);
  assert.match(skeleton, /color: "var\(--text/);
  assert.match(skeleton, /color: "var\(--text-muted/);
});

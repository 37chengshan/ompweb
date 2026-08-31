import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("missing OMP recovery offers official commands for macOS, Windows, and Linux", () => {
  const source = read("./OmpSetupWizard.tsx");
  assert.match(source, /curl -fsSL https:\/\/omp\.sh\/install \| sh/);
  assert.match(source, /irm https:\/\/omp\.sh\/install\.ps1 \| iex/);
  assert.match(source, /brew install can1357\/tap\/omp/);
  assert.match(source, /NetworkProxyConfig/);
  assert.match(source, /No Node, Bun, or administrator setup/);
});

test("missing OMP banner opens local setup rather than an external repository", () => {
  const source = read("./AppShell.tsx");
  const banner = source.slice(source.indexOf("{ompMissing &&"), source.indexOf("{/* Top bar"));
  assert.match(banner, /OmpSetupWizard/);
  assert.match(banner, /setOmpSetupOpen\(true\)/);
  assert.doesNotMatch(banner, /github\.com\/can1357\/oh-my-pi/);
});

test("Windows setup keeps shortcut install and exposes opt-in sign-in launch", () => {
  const pkg = JSON.parse(read("../package.json"));
  const main = read("../desktop/main.js");
  const preload = read("../desktop/preload.js");
  assert.equal(pkg.build.nsis.createDesktopShortcut, true);
  assert.equal(pkg.build.nsis.createStartMenuShortcut, true);
  assert.equal(pkg.build.nsis.runAfterFinish, true);
  assert.match(main, /ipcMain\.handle\("set-auto-launch"/);
  assert.match(main, /app\.setLoginItemSettings/);
  assert.match(preload, /setAutoLaunch/);
});

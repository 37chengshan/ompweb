import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("top bar surfaces selected model output capacity without provider quota claims", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(source, /modelCapacity?.maxTokens/);
  assert.match(source, /tooltipMaxOutput/);
  assert.doesNotMatch(source, /provider quota|remaining allowance|reset time/i);
});

test("GitHub status stays a foreground control beside the file viewer and can move vertically", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /data-github-status-trigger/);
  assert.match(source, /aria-controls="github-status-panel"/);
  assert.match(source, /rightPanelInset/);
  assert.match(source, /GITHUB_TRIGGER_STORAGE_KEY/);
  assert.match(source, /handleGithubTriggerPointerDown/);
  assert.match(source, /handleGithubTriggerPointerMove/);
  assert.match(source, /双击恢复默认位置/);
  // Chat view must clear the ChatMinimap rail (36px wide at right:8) so the
  // scrollbar stays clickable; only file view hugs the edge.
  assert.match(source, /showChat \? 48 : 4/);
  assert.match(source, /if \(activeTopPanel === "github"\) return/);
  assert.match(css, /\.github-fixed-trigger[\s\S]*border-radius: var\(--radius-control\);/);
  assert.match(css, /\.github-fixed-trigger[\s\S]*touch-action: none;/);
  assert.match(css, /\.github-status-popover/);
});

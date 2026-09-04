import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./GitHubStatusPanel.tsx", import.meta.url), "utf8");

test("GitHub actions use one modal with branch selection and an in-dialog confirmation", () => {
  assert.match(source, /setActionMode\(mode\)/);
  assert.match(source, /value=\{actionMode\}/);
  assert.match(source, /value=\{selectedBranch\}/);
  assert.match(source, /setConfirmStep\(true\)/);
  assert.match(source, /确认并执行/);
  assert.doesNotMatch(source, /window\.confirm/);
});

test("Pull Request creation is an editable, confirmed flow", () => {
  assert.match(source, /const \[prOpen/);
  assert.match(source, /const \[prTitle/);
  assert.match(source, /const \[prBody/);
  assert.match(source, /pulls\/new\?/);
  assert.match(source, /确认创建 Pull Request/);
});

test("Git status does not duplicate the composer slash-command palette", () => {
  assert.doesNotMatch(source, /github-status-shortcuts/);
  assert.doesNotMatch(source, /slashCommands/);
  assert.doesNotMatch(source, /onInsertCommand/);
});

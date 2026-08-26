import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("top bar surfaces selected model output capacity without provider quota claims", async () => {
  const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(source, /modelCapacity?.maxTokens/);
  assert.match(source, /tooltipMaxOutput/);
  assert.doesNotMatch(source, /provider quota|remaining allowance|reset time/i);
});

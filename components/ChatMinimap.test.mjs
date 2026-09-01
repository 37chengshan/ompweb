import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./ChatMinimap.tsx", import.meta.url), "utf8");

test("minimap nodes jump directly to their cached message group", () => {
  assert.match(source, /const scrollToGroup = useCallback/);
  assert.match(source, /data-minimap-node=\{node\.groupIndex\}/);
  assert.match(source, /scrollToGroup\(node\.groupIndex\)/);
  assert.match(source, /event\.stopPropagation\(\)/);
});

import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { parseAgentFrontmatter, writeAgent } = await jiti.import("./agents-service.ts");

const payload = { description: "A test agent", body: "Do the task." };

test("renaming an agent is case-sensitive on POSIX filesystems", async () => {
  const dir = await mkdtemp(join(tmpdir(), "omp-agents-test-"));
  try {
    writeAgent(dir, "Scout", payload);
    writeAgent(dir, "scout", payload, "Scout");
    const names = (await readdir(dir)).filter((name) => name.endsWith(".md")).sort();
    assert.deepEqual(names, ["scout.md"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parses agent frontmatter with an optional UTF-8 BOM", () => {
  const parsed = parseAgentFrontmatter("\uFEFF---\nname: scout\ndescription: Test\n---\nPrompt");
  assert.equal(parsed.frontmatter.name, "scout");
  assert.equal(parsed.body, "Prompt");
});

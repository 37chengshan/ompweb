import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  splitModelKey,
  splitEffort,
  parseRoleSelector,
  buildRoleSelector,
  roleSelectorKnown,
} = await jiti.import("./model-role-selector.ts");

test("splitModelKey splits only the first slash (ids may contain slashes)", () => {
  assert.deepEqual(splitModelKey("new-provider/deepseek-v4-flash"), { provider: "new-provider", id: "deepseek-v4-flash" });
  // Real case: the models.yml id itself is org/model (deepseek/deepseek-v4-pro).
  assert.deepEqual(splitModelKey("new-provider/deepseek/deepseek-v4-pro"), { provider: "new-provider", id: "deepseek/deepseek-v4-pro" });
  assert.deepEqual(splitModelKey("openai/gpt-5.2"), { provider: "openai", id: "gpt-5.2" });
  assert.equal(splitModelKey("no-slash"), null);
  assert.equal(splitModelKey("/leading"), null);
  assert.equal(splitModelKey("trailing/"), null);
});

test("splitEffort strips a trailing known effort but not other colons", () => {
  assert.deepEqual(splitEffort("new-provider/deepseek-v4-flash:max"), { model: "new-provider/deepseek-v4-flash", effort: "max" });
  // Model id containing colons (not in known set) is preserved whole.
  assert.deepEqual(splitEffort("new-provider/poolside/laguna-s-2.1-free"), { model: "new-provider/poolside/laguna-s-2.1-free", effort: "" });
  assert.deepEqual(splitEffort("new-provider/poolside/laguna-s-2.1-free:xhigh"), { model: "new-provider/poolside/laguna-s-2.1-free", effort: "xhigh" });
  assert.deepEqual(splitEffort("model:unknown-suffix"), { model: "model:unknown-suffix", effort: "" });
});

test("parse/build round-trips persisted selectors", () => {
  const selector = "new-provider/poolside/laguna-s-2.1-free:xhigh";
  const parts = parseRoleSelector(selector);
  assert.equal(parts.modelKey, "new-provider/poolside/laguna-s-2.1-free");
  assert.equal(parts.effort, "xhigh");
  assert.equal(buildRoleSelector(parts.modelKey, parts.effort), selector);

  // Provider-qualified model + no effort.
  assert.equal(buildRoleSelector("openai/gpt-5.2", ""), "openai/gpt-5.2");
  // Empty model clears the override entirely — never a bare ":effort".
  assert.equal(buildRoleSelector("", "high"), "");
  assert.equal(parseRoleSelector("").modelKey, "");
});

test("roleSelectorKnown resolves against the live provider/id key set", () => {
  const known = new Set([
    "new-provider/deepseek/deepseek-v4-flash",
    "openai/gpt-5.2",
    "litellm/gemini-3.7-flash",
  ]);
  assert.equal(roleSelectorKnown("new-provider/deepseek/deepseek-v4-flash:max", known), true);
  assert.equal(roleSelectorKnown("openai/gpt-5.2", known), true);
  // Deleted provider leaves the selector stale — flagged unknown.
  assert.equal(roleSelectorKnown("sync-probe/probe-alpha:high", known), false);
  assert.equal(roleSelectorKnown("", known), true);
});

import assert from "node:assert/strict";
import test from "node:test";
import { omitUntouchedModelDrafts } from "./models-config-drafts.ts";

test("omits only untouched new-model rows before saving provider edits", () => {
  const config = {
    providers: {
      openai: { apiKey: "updated", models: [{ id: "" }] },
      configured: { models: [{ id: "gpt-5" }] },
      incomplete: { models: [{ id: "", name: "Draft name" }] },
    },
  };

  assert.deepEqual(omitUntouchedModelDrafts(config), {
    providers: {
      openai: { apiKey: "updated", models: undefined },
      configured: { models: [{ id: "gpt-5" }] },
      incomplete: { models: [{ id: "", name: "Draft name" }] },
    },
  });
});

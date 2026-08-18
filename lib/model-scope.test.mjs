import assert from "node:assert/strict";
import test from "node:test";

const { assertNoAmbiguousModelScopes } = await import("./model-scope.ts");

const models = [
  { provider: "anthropic", id: "sonnet" },
  { provider: "gateway", id: "sonnet" },
  { provider: "gateway", id: "unique" },
];

test("rejects ambiguous bare model IDs", () => {
  assert.throws(
    () => assertNoAmbiguousModelScopes(["sonnet"], models),
    /Ambiguous enabledModels entry.*provider\/modelId/,
  );
});

test("accepts provider-qualified and unique model IDs", () => {
  assert.doesNotThrow(() => assertNoAmbiguousModelScopes(["anthropic/sonnet", "unique:high"], models));
});

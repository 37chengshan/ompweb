import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const service = await jiti.import("./omp/settings-service.ts");

// 5.0 doc 07 tests: CLI adapter normalization, credential redaction, argv
// execution (never shell strings), and the legacy-YAML fallback ladder.

const fixture = readFileSync(new URL("./omp/fixtures/omp-config-list.json", import.meta.url), "utf8");

test("omp config list fixture normalizes types and keeps descriptions", () => {
  const { definitions, redactedKeys } = service.parseOmpConfigList(fixture);
  const byKey = new Map(definitions.map((d) => [d.key, d]));

  assert.equal(byKey.get("chatTemplate").type, "string");
  assert.equal(byKey.get("chatTemplate").description, "Prompt template id");
  assert.equal(byKey.get("streamIdleTimeoutMs").type, "number");
  assert.equal(byKey.get("enabledTools").type, "array");
  // Plain (schema-less) top-level entries degrade honestly:
  assert.equal(byKey.get("model").type, "unknown");

  assert.deepEqual(redactedKeys, ["providerApiKey"]);
  assert.equal(byKey.get("providerApiKey").redacted, true);
});

test("credential values never survive parsing", () => {
  // A hostile/future OMP build that includes a value on a redacted entry must
  // not leak it through the parser.
  const hostile = JSON.stringify({
    providerApiKey: { value: "sk-super-secret", redacted: true, type: "string" },
  });
  const { definitions } = service.parseOmpConfigList(hostile);
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].redacted, true);
  const roundtrip = JSON.stringify(definitions);
  assert.ok(!roundtrip.includes("sk-super-secret"), "credential value leaked through the registry");
});

test("non-object entries degrade to unknown type instead of guessing", () => {
  const { definitions } = service.parseOmpConfigList(JSON.stringify({ legacyFlag: true }));
  assert.deepEqual(definitions, [{ key: "legacyFlag", type: "unknown", source: "cli" }]);
});

test("CLI adapter is probed first; legacy YAML is the fallback", async () => {
  const calls = [];
  const failingRunner = async (file, args) => {
    calls.push({ file, args });
    throw new Error("cloudflared missing vibes");
  };
  const capability = await service.probeSettingsCapability(failingRunner);
  assert.equal(capability.schemaSource, "legacy-yaml");
  assert.equal(capability.writable, true);
  assert.ok(capability.detail.includes("omp config list failed"));
  assert.deepEqual(calls[0].args, ["config", "list", "--json"]);
});

test("set/reset use argv arrays against the omp binary", async () => {
  const calls = [];
  const runner = async (file, args) => {
    calls.push({ file, args });
    return { stdout: "{}" };
  };
  await service.setOmpSetting("theme", "dark", runner);
  await service.resetOmpSetting("theme", runner);
  assert.deepEqual(calls[0].args, ["config", "set", "theme", "dark"]);
  assert.deepEqual(calls[1].args, ["config", "reset", "theme"]);
  assert.equal(calls[1].args.includes("--shell"), false);
});

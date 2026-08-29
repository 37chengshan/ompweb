import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { readNativeSettings, writeNativeSettings } = await jiti.import("./settings-config.ts");

function withAgentDir(run) {
  const dir = mkdtempSync(join(tmpdir(), "omp-web-settings-config-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    run(dir);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("uses config.yaml when the canonical config.yml is absent", () => {
  withAgentDir((dir) => {
    const fallback = join(dir, "config.yaml");
    writeFileSync(fallback, "compaction:\n  strategy: context-full\n", "utf8");
    assert.equal(readNativeSettings().path, fallback);
    assert.equal(readNativeSettings().settings.compaction.strategy, "context-full");

    writeNativeSettings({ hideThinkingBlock: true });
    assert.equal(existsSync(join(dir, "config.yml")), false);
    assert.match(readFileSync(fallback, "utf8"), /hideThinkingBlock: true/);
  });
});

test("rejects malformed native settings and accepts OMP compaction strategies", () => {
  withAgentDir(() => {
    assert.throws(() => writeNativeSettings({ mcp: { notifications: "yes" } }), /mcp.notifications must be a boolean/);
    assert.throws(() => writeNativeSettings({ compaction: { strategy: "prune" } }), /Invalid compaction strategy/);
    writeNativeSettings({ compaction: { strategy: "shake", autoContinue: true } });
    assert.equal(readNativeSettings().settings.compaction.strategy, "shake");
  });
});
test("persists and reads the externalThinking setting (v17.2.14+)", () => {
  withAgentDir(() => {
    assert.throws(() => writeNativeSettings({ externalThinking: "yes" }), /externalThinking must be a boolean/);
    writeNativeSettings({ externalThinking: true });
    assert.equal(readNativeSettings().settings.externalThinking, true);
    // Writes are incremental: an unrelated later write preserves the key.
    writeNativeSettings({ hideThinkingBlock: true });
    assert.equal(readNativeSettings().settings.externalThinking, true);
    assert.equal(readNativeSettings().settings.hideThinkingBlock, true);
  });
});
test("persists and validates retry settings", () => {
  withAgentDir(() => {
    writeNativeSettings({ retry: { enabled: false, maxRetries: 3, modelFallback: true } });
    const settings = readNativeSettings().settings.retry;
    assert.equal(settings?.enabled, false);
    assert.equal(settings?.maxRetries, 3);
    assert.equal(settings?.modelFallback, true);
    assert.throws(() => writeNativeSettings({ retry: { maxRetries: 99 } }), /Retry attempts must be an integer between 0 and 20/);
  });
});
test("persists and validates tool approval policies", () => {
  withAgentDir(() => {
    writeNativeSettings({ tools: { approval: { bash: "deny", extension: "allow" } } });
    const settings = readNativeSettings().settings;
    assert.equal(settings.tools.approval.bash, "deny");
    assert.equal(settings.tools.approval.extension, "allow");
    assert.throws(() => writeNativeSettings({ tools: { approval: { bash: "bogus" } } }), /Invalid Bash approval policy/);
    assert.throws(() => writeNativeSettings({ tools: { approval: { extension: "deny" } } }), /Invalid extension tool approval policy/);
  });
});

test("persists and validates the 16 newly mapped internal settings", () => {
  withAgentDir(() => {
    writeNativeSettings({
      modelRoles: { slow: "opencodex/opencode-go/deepseek-v4-flash:max", plan: "opencode-go/deepseek-v4-flash:max" },
      generateImage: { enabled: true },
      computer: { enabled: true },
      skills: { enableCodexUser: true, enableAgentsUser: false, enableClaudeUser: false, enableClaudeProject: true },
      bash: { autoBackground: { enabled: false } },
      providers: { memoryModel: "qwen3-1.7b", webSearchOrder: ["searxng", "bing"] },
      security: { enabled: true },
      github: { enabled: false },
      colorBlindMode: true,
      contextPromotion: { enabled: true },
      snapcompact: { toolResults: true },
      edit: { mode: "hashline" },
      composer: { shape: "box" },
      dev: { autoqaConsent: "granted" },
      symbolPreset: "unicode",
    });
    const settings = readNativeSettings().settings;
    assert.deepEqual(settings.modelRoles, { slow: "opencodex/opencode-go/deepseek-v4-flash:max", plan: "opencode-go/deepseek-v4-flash:max" });
    assert.equal(settings.generateImage?.enabled, true);
    assert.equal(settings.computer?.enabled, true);
    assert.deepEqual(settings.skills, { enableCodexUser: true, enableAgentsUser: false, enableClaudeUser: false, enableClaudeProject: true });
    assert.equal(settings.bash?.autoBackground?.enabled, false);
    assert.deepEqual(settings.providers, { memoryModel: "qwen3-1.7b", webSearchOrder: ["searxng", "bing"] });
    assert.equal(settings.security?.enabled, true);
    assert.equal(settings.github?.enabled, false);
    assert.equal(settings.colorBlindMode, true);
    assert.equal(settings.contextPromotion?.enabled, true);
    assert.equal(settings.snapcompact?.toolResults, true);
    assert.equal(settings.edit?.mode, "hashline");
    assert.equal(settings.composer?.shape, "box");
    assert.equal(settings.dev?.autoqaConsent, "granted");
    assert.equal(settings.symbolPreset, "unicode");
  });
});

test("rejects malformed new settings", () => {
  withAgentDir(() => {
    assert.throws(() => writeNativeSettings({ modelRoles: { slow: "" } }), /Model roles require non-empty role and model values/);
    assert.throws(() => writeNativeSettings({ providers: { webSearchOrder: [42] } }), /webSearchOrder must be an array of strings/);
    assert.throws(() => writeNativeSettings({ generateImage: { enabled: "yes" } }), /generateImage.enabled must be a boolean/);
    assert.throws(() => writeNativeSettings({ symbolPreset: "" }), /symbolPreset must be a non-empty string/);
    assert.throws(() => writeNativeSettings({ colorBlindMode: "no" }), /colorBlindMode must be a boolean/);
  });
});

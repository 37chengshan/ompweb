import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ChatInput, ModelErrorBanner, filterModelOptions } = await jiti.import("./ChatInput.tsx");
const { setDraft, clearDraft } = await jiti.import("@/lib/draft-store");

test("keeps Stop as the primary action while streaming, even with typed text", () => {
  const draftKey = "chat-input-queue-action-test";
  setDraft(draftKey, { value: "Continue after the current run", images: [], files: [] });
  try {
    const html = renderToStaticMarkup(
      React.createElement(ChatInput, {
        onSend() {},
        onAbort() {},
        onFollowUp() {},
        isStreaming: true,
        draftKey,
      }),
    );

    // Stop must stay reachable during a run; queued follow-ups are sent via
    // Enter / the queued-follow-up bar instead of replacing the Stop button.
    assert.match(html, />(Stop|chatInput\.stop)</);
    assert.match(html, /title="(Stop agent|chatInput\.stopAgent)"/);
    assert.doesNotMatch(html, />(Queue|chatInput\.queue)</);
  } finally {
    clearDraft(draftKey);
  }
});

test("renders the upstream model error", () => {
  const html = renderToStaticMarkup(
    React.createElement(ModelErrorBanner, {
      error: "Invalid models.json schema:\nproviders.custom.models.0.id must not be empty",
    }),
  );

  assert.match(html, /role="alert"/);
  // en.json is assembled from locale parts; before assembly the key renders as-is.
  assert.match(html, /(Model error|chatInput\.modelError)/);
  assert.match(html, /providers\.custom\.models\.0\.id must not be empty/);
});

test("does not render an empty model error", () => {
  assert.equal(renderToStaticMarkup(React.createElement(ModelErrorBanner, { error: null })), "");
});

test("keeps the model selector visible when a model error leaves no options", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      onModelChange() {},
      isStreaming: false,
      modelError: "Invalid models.json schema",
      modelList: [],
      modelNames: {},
    }),
  );

  assert.match(html, />(No models|chatInput\.noModels)</);
  assert.match(html, /title="(No available models|chatInput\.noAvailableModels)"/);
});


test("renders goal, planning, and advisor indicators at the composer", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      onModelChange() {},
      isStreaming: false,
      model: { provider: "test", modelId: "model" },
      modelList: [{ provider: "test", modelId: "model", id: "model", name: "Test model" }],
      modelNames: {},
      activeGoal: { objective: "Ship the active goal bar", startedAt: 0 },
      activePlan: { objective: "Plan the implementation" },
      advisorEnabled: true,
      onAdvisorChange() {},
    }),
  );

  assert.match(html, /Ship the active goal bar/);
  assert.match(html, /(Planning in progress|chatInput\.planningInProgress)/);
  // The per-chat advisor toggle renders pressed with its disable title.
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /title="(Disable advisor for this chat|chatInput\.advisorDisableTitle|Advisor: [^"]*)"/);
});

test("renders the compact toolbar action", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      onCompact() {},
      isStreaming: false,
    }),
  );

  assert.match(html, /title="(Compact context|chatInput\.compactContext)"/);
});

test("shows the advisor thunder indicator with the reviewing model and reasoning", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      isStreaming: true,
      advisorActive: true,
      advisorModel: { name: "GPT-5.6 Luna", reasoning: "xhigh" },
    }),
  );

  assert.match(html, /aria-label="[^"]*GPT-5\.6 Luna[^"]*xhigh[^"]*"/);
});

test("filters model options by display name, identifier, and provider", () => {
  const options = [
    { provider: "OpenAI", modelId: "gpt-5.2", name: "GPT-5.2" },
    { provider: "Anthropic", modelId: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
  ];

  assert.deepEqual(filterModelOptions(options, "sonnet", "en"), [options[1]]);
  assert.deepEqual(filterModelOptions(options, "5.2", "en"), [options[0]]);
  assert.deepEqual(filterModelOptions(options, "OPENAI", "en"), [options[0]]);
  assert.equal(filterModelOptions(options, "   ", "en"), options);
});
test("queued slash commands gate /advisor behind the per-chat toggle", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  const sendQueued = source.slice(
    source.indexOf("const sendQueued = useCallback"),
    source.indexOf("const primaryActionQueuesMessage"),
  );
  const guard = sendQueued.indexOf('commandName === "advisor" && !advisorEnabled');
  const expansion = sendQueued.indexOf("expandWebSlashCommand(msg)");

  assert.ok(guard > 0, "advisor guard missing from sendQueued");
  assert.ok(expansion > guard, "advisor guard must run before command expansion");
});
test("slash palette follows the caret so commands trigger after typed text", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");

  // The palette must key off the caret token (extractSlashQuery), never the
  // whole-input prefix check that broke "/" after real text.
  assert.match(source, /extractSlashQuery/);
  assert.doesNotMatch(source, /value\.startsWith\("\/"\) && !\\\/\\s\\\/\.test/);
  assert.match(source, /updateSlashQuery\(e\.target\.value, e\.target\.selectionStart\)/);

  // Selecting a command replaces only the slash token and keeps the prefix.
  const apply = source.slice(source.indexOf("const applySlashCommand"), source.indexOf("const sendQueued"));
  assert.match(apply, /value\.slice\(0, start\)/);
  assert.match(apply, /before \+ `\/\$\{command\.name\} ` \+ after/);
});

test("renders single queued prompt in compact bar", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      isStreaming: true,
      queuedMessages: {
        followUp: ["First follow-up task"],
        steering: [],
      },
    }),
  );

  assert.match(html, /First follow-up task/);
  assert.match(html, />(Edit|chatInput\.queuedEdit)</);
  assert.match(html, />(Delete|chatInput\.queuedDelete)</);
  assert.match(html, />(Steer|chatInput\.queuedSteerAction)</);
});

test("renders multiple queued prompts with count and expand action", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatInput, {
      onSend() {},
      onAbort() {},
      isStreaming: true,
      queuedMessages: {
        followUp: ["First task", "Second task"],
        steering: ["Priority steer"],
      },
    }),
  );

  assert.match(html, /\(3\)/);
  assert.match(html, />(Show all queued prompts|Show all|chatInput\.expandQueued)</);
  assert.match(html, /First task/);
});

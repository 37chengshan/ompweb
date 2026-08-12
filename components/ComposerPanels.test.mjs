import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ComposerPanels } = await jiti.import("./ComposerPanels.tsx");

const noop = () => {};

test("renders nothing when there are no tasks or subagents", () => {
  assert.equal(renderToStaticMarkup(React.createElement(ComposerPanels, {
    todoPhases: [],
    subagents: [],
    onSelectSubagent: noop,
  })), "");
});

test("attaches todo plan and subagent roster with live states", () => {
  const html = renderToStaticMarkup(React.createElement(ComposerPanels, {
    todoPhases: [{ name: "Implementation", tasks: [{ content: "Wire panels", status: "in_progress" }] }],
    subagents: [
      { id: "s1", agent: "scout", status: "started", task: "Map the surface", index: 0 },
      { id: "s2", agent: "worker", status: "completed", task: "Write the code", index: 1 },
    ],
    onSelectSubagent: noop,
  }));

  assert.match(html, /Tasks/);
  assert.match(html, /Wire panels/);
  assert.match(html, /Subagents/);
  assert.match(html, /scout/);
  assert.match(html, /Map the surface/);
  assert.match(html, /worker/);
  assert.match(html, /1 running · 2 total/);
});

test("subagent panel collapses to its header when toggled", () => {
  const html = renderToStaticMarkup(React.createElement(ComposerPanels, {
    todoPhases: [],
    subagents: [{ id: "s1", agent: "scout", status: "started", index: 0 }],
    onSelectSubagent: noop,
  }));
  assert.match(html, /aria-expanded="true"/);
});

test("live chips show current tool, telemetry, and async marker", () => {
  const html = renderToStaticMarkup(React.createElement(ComposerPanels, {
    todoPhases: [],
    subagents: [{
      id: "s1",
      agent: "scout",
      status: "started",
      task: "Map the surface",
      index: 0,
      detached: true,
      progress: {
        currentTool: "read",
        lastIntent: "Inspect foo.ts",
        tokens: 2200,
        cost: 0.0041,
        contextTokens: 8000,
        contextWindow: 32000,
        resolvedModel: "provider/gpt-x:high",
      },
    }],
    onSelectSubagent: noop,
  }));

  assert.match(html, /Map the surface/);
  assert.match(html, /read — Inspect foo.ts/);
  assert.match(html, /2.2k tok/);
  assert.match(html, /8k\/32k ctx/);
  assert.match(html, /gpt-x/);
  assert.match(html, /⤴/);
});

test("retrying chips surface retry state instead of the activity line", () => {
  const html = renderToStaticMarkup(React.createElement(ComposerPanels, {
    todoPhases: [],
    subagents: [{
      id: "s1",
      agent: "worker",
      status: "started",
      task: "Write the code",
      index: 0,
      progress: { retryState: { attempt: 2, maxAttempts: 5, delayMs: 1000, errorMessage: "429", startedAtMs: 1 } },
    }],
    onSelectSubagent: noop,
  }));
  assert.match(html, /retrying 2\/5/);
});

test("history chips render terminal telemetry without pulsing state", () => {
  const html = renderToStaticMarkup(React.createElement(ComposerPanels, {
    todoPhases: [],
    subagents: [{
      id: "s1",
      agent: "scout",
      status: "completed",
      task: "Map the surface",
      index: 0,
      source: "history",
      progress: { status: "completed", tokens: 999000, cost: 1.23, durationMs: 360000, resolvedModel: "provider/gpt-5.6:medium" },
    }],
    onSelectSubagent: noop,
  }));
  assert.match(html, /Map the surface/);
  assert.match(html, /999k tok/);
  assert.match(html, /6m/);
  // History chips must not show the pulsing live dot.
  assert.doesNotMatch(html, /animate-\[pulse/);
});

test("chips show agent source, nested count, and async marker", () => {
  const html = renderToStaticMarkup(React.createElement(ComposerPanels, {
    todoPhases: [],
    subagents: [{
      id: "s1",
      agent: "scout",
      status: "started",
      task: "Map the surface",
      index: 0,
      agentSource: "user",
      detached: true,
      progress: {
        lastIntent: "Inspect foo.ts",
        inflightTaskDetails: { progress: [{ id: "g1", agent: "task" }, { id: "g2", agent: "task" }] },
      },
    }],
    onSelectSubagent: noop,
  }));
  assert.match(html, /Inspect foo.ts/);
  assert.match(html, /user/);
  assert.match(html, /2 nested/);
  assert.match(html, /⤴/);
});

test("history chips mark detached async spawns", () => {
  const html = renderToStaticMarkup(React.createElement(ComposerPanels, {
    todoPhases: [],
    subagents: [{
      id: "s1",
      agent: "scout",
      status: "started",
      task: "Async audit",
      index: 0,
      source: "history",
      detached: true,
    }],
    onSelectSubagent: noop,
  }));
  assert.match(html, /⤴/);
});

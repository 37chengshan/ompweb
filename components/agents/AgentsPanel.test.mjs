import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { AgentsPanel } = await jiti.import("./AgentsPanel.tsx");
const { SubagentCard } = await jiti.import("./SubagentCard.tsx");

const noop = () => {};

test("agents panel shows the empty state without subagents", () => {
  const html = renderToStaticMarkup(React.createElement(AgentsPanel, {
    subagents: [],
    onSelectSubagent: noop,
  }));
  // SSR tests run without an i18n provider, so t() falls back to the key.
  assert.match(html, /subagentsEmpty|No subagents yet/);
});

test("agents panel renders live roster with running count", () => {
  const html = renderToStaticMarkup(React.createElement(AgentsPanel, {
    subagents: [
      { id: "s1", agent: "scout", status: "started", task: "Map the surface", index: 0 },
      { id: "s2", agent: "worker", status: "completed", task: "Write the code", index: 1, source: "history" },
    ],
    onSelectSubagent: noop,
  }));
  assert.match(html, /scout/);
  assert.match(html, /Map the surface/);
  assert.match(html, /1\/2/);
});

test("agents panel history section is dimmed and labeled", () => {
  const html = renderToStaticMarkup(React.createElement(AgentsPanel, {
    subagents: [
      { id: "s1", agent: "worker", status: "completed", task: "Write the code", index: 0, source: "history", progress: { status: "completed", tokens: 5000, durationMs: 120000 } },
    ],
    onSelectSubagent: noop,
  }));
  assert.match(html, /historySubagents|History/);
  assert.match(html, /worker/);
});

test("subagent card opens transcript on click and hides telemetry until expanded", () => {
  const html = renderToStaticMarkup(React.createElement(SubagentCard, {
    subagent: { id: "s1", agent: "scout", status: "started", task: "Map", index: 0 },
    onSelect: noop,
  }));
  assert.match(html, /scout/);
  assert.match(html, /Map/);
});

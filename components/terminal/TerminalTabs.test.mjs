import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { TerminalTabs, shouldAutoOpenInitialTab } = await jiti.import("./TerminalTabs.tsx");

const noop = () => {};

// TerminalTabs creates its first tab in an effect, so SSR cannot exercise
// multi-tab behavior (that needs a DOM + effect flush and lives in the
// browser E2E). These tests freeze the host's static contract: it must
// render an operable shell when open (new-tab + close affordances, queued
// run command tolerated), and render nothing when closed so the panels
// unmount and their PTYs reap — the two states AppShell derives from
// `rightPanelOpen && rightPanelTab === "terminal"`.
test("renders the tab strip affordances when open", () => {
  const html = renderToStaticMarkup(React.createElement(TerminalTabs, {
    open: true,
    onClose: noop,
    cwd: "/repo",
  }));
  assert.match(html, /terminal\.newTab|New terminal/);
  // Per-tab close buttons only exist once tabs render (effect-driven); the
  // host-level close affordance is present immediately.
  assert.match(html, /Close Terminal/);
});

test("renders nothing when closed (panels unmount → PTYs reap)", () => {
  const html = renderToStaticMarkup(React.createElement(TerminalTabs, {
    open: false,
    onClose: noop,
    cwd: "/repo",
  }));
  assert.equal(html, "");
});

test("accepts a queued run command without crashing (routing happens in effects)", () => {
  const html = renderToStaticMarkup(React.createElement(TerminalTabs, {
    open: true,
    onClose: noop,
    cwd: "/repo",
    runCommand: { text: "npm test", nonce: 7 },
    onRunCommandConsumed: noop,
  }));
  assert.match(html, /terminal\.newTab|New terminal/);
});

test("accepts an onRunCommandConsumed callback without crashing", () => {
  const html = renderToStaticMarkup(React.createElement(TerminalTabs, {
    open: true,
    onClose: noop,
    cwd: "/repo",
    runCommand: { text: "git status", nonce: 3 },
    onRunCommandConsumed: () => { throw new Error("must not fire during SSR"); },
  }));
  assert.match(html, /terminal\.newTab|New terminal/);
});

test("initial drawer opening creates one shell but a user-closed final tab stays empty", () => {
  const base = { open: true, tabsLength: 0, activeId: null };
  assert.equal(shouldAutoOpenInitialTab({ ...base, initialized: false, userClosedAll: false }), true);
  assert.equal(shouldAutoOpenInitialTab({ ...base, initialized: true, userClosedAll: false }), false);
  assert.equal(shouldAutoOpenInitialTab({ ...base, initialized: true, userClosedAll: true }), false);
});

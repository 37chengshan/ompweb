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

test("renders nothing when there are no todo phases", () => {
  assert.equal(renderToStaticMarkup(React.createElement(ComposerPanels, {
    todoPhases: [],
  })), "");
});

test("attaches the live todo plan", () => {
  const html = renderToStaticMarkup(React.createElement(ComposerPanels, {
    todoPhases: [{ name: "Implementation", tasks: [{ content: "Wire panels", status: "in_progress" }] }],
    defaultExpanded: true,
  }));

  assert.match(html, /Tasks/);
  assert.match(html, /Wire panels/);
});

test("panel starts collapsed with a live summary in its header", () => {
  const html = renderToStaticMarkup(React.createElement(ComposerPanels, {
    todoPhases: [{ name: "Implementation", tasks: [{ content: "Wire panels", status: "in_progress" }] }],
  }));
  // Header with live count is visible; the content starts collapsed.
  assert.match(html, /Tasks/);
  assert.match(html, /0\/1 complete/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /Wire panels/);
});

test("coexists with composer layout and keeps todo progress summary accessible", () => {
  const html = renderToStaticMarkup(React.createElement(ComposerPanels, {
    todoPhases: [{
      name: "Implementation",
      tasks: [
        { content: "Checklist item 1", status: "pending" },
        { content: "Checklist item 2", status: "completed" },
      ],
    }],
  }));
  assert.match(html, /Tasks/);
  assert.match(html, /1\/2 complete/);
});

test("plan mode hides the duplicate todo list", () => {
  const html = renderToStaticMarkup(React.createElement(ComposerPanels, {
    todoPhases: [{ name: "Implementation", tasks: [{ content: "Wire panels", status: "in_progress" }] }],
    defaultExpanded: true,
    planModeActive: true,
  }));
  assert.doesNotMatch(html, /Tasks/);
  assert.doesNotMatch(html, /Wire panels/);
});

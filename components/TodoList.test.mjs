import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { TodoList } = await jiti.import("./TodoList.tsx");

test("renders live todo phases, task states, and blockers", () => {
  const html = renderToStaticMarkup(React.createElement(TodoList, {
    phases: [{
      id: "phase-1",
      name: "Implementation",
      tasks: [
        { id: "task-1", content: "Trace todo state", status: "completed" },
        { id: "task-2", content: "Render task list", status: "in_progress" },
        { id: "task-3", content: "Verify in browser", status: "blocked", blocker: "Server unavailable" },
      ],
    }],
  }));

  assert.match(html, /Implementation/);
  assert.match(html, /Trace todo state/);
  assert.match(html, /Render task list/);
  assert.match(html, /Verify in browser/);
  assert.match(html, /Blocked: Server unavailable/);
  assert.match(html, /1\/3 complete/);
});

test("renders nothing when no todo list exists", () => {
  assert.equal(renderToStaticMarkup(React.createElement(TodoList, { phases: [] })), "");
  assert.equal(renderToStaticMarkup(React.createElement(TodoList)), "");
});

test("counts only completed tasks and collapses long plans", () => {
  const html = renderToStaticMarkup(React.createElement(TodoList, {
    phases: [{
      name: "Tasks",
      tasks: [
        { content: "One", status: "completed" },
        { content: "Two", status: "abandoned" },
        { content: "Three", status: "pending" },
        { content: "Four", status: "pending" },
        { content: "Five", status: "pending" },
        { content: "Six", status: "pending" },
      ],
    }],
  }));

  assert.match(html, /1\/6 complete/);
  assert.doesNotMatch(html, /Six/);
  assert.match(html, /Show all tasks/);
});

test("collapsible mode collapses to a toggle header and expands again", () => {
  const phases = [{ name: "Tasks", tasks: [{ content: "Wire panels", status: "in_progress" }] }];
  const collapsedHtml = renderToStaticMarkup(React.createElement(TodoList, {
    phases,
    collapsible: true,
    defaultExpanded: false,
  }));
  assert.match(collapsedHtml, /aria-expanded="false"/);
  assert.doesNotMatch(collapsedHtml, /Wire panels/);
  const expandedHtml = renderToStaticMarkup(React.createElement(TodoList, {
    phases,
    collapsible: true,
    defaultExpanded: true,
  }));
  assert.match(expandedHtml, /aria-expanded="true"/);
  assert.match(expandedHtml, /Wire panels/);
});

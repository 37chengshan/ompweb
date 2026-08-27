import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { PlanPanel } = await jiti.import("./PlanPanel.tsx");

const noop = () => {};

test("plain task runs never render the plan panel", () => {
  const html = renderToStaticMarkup(
    React.createElement(PlanPanel, {
      plan: null,
      todoPhases: [{ name: "Implementation", tasks: [{ content: "Wire panels", status: "in_progress" }] }],
      onExecutePlan: noop,
      onRejectPlan: noop,
      planModeActive: false,
    }),
  );
  assert.equal(html, "");
});

test("renders the plan surface when a plan objective is active", () => {
  const html = renderToStaticMarkup(
    React.createElement(PlanPanel, {
      plan: { objective: "Ship the export" },
      todoPhases: [],
      onExecutePlan: noop,
      onRejectPlan: noop,
      planModeActive: true,
    }),
  );
  assert.match(html, /(OMP Plan Mode|OMP 计划制定模式|plan\.modeTitle)/);
  assert.match(html, /Ship the export/);
});

test("renders plan tasks under an active plan without the plain-run trigger", () => {
  const html = renderToStaticMarkup(
    React.createElement(PlanPanel, {
      plan: { objective: "Migrate the store" },
      todoPhases: [{ name: "Implementation", tasks: [{ content: "Wire panels", status: "in_progress" }] }],
      onExecutePlan: noop,
      onRejectPlan: noop,
      planModeActive: true,
    }),
  );
  assert.match(html, /Wire panels/);
  assert.match(html, /Migrate the store/);
});
test("renders the plan markdown document above the task grid", () => {
  const html = renderToStaticMarkup(
    React.createElement(PlanPanel, {
      plan: null,
      todoPhases: [],
      onExecutePlan: noop,
      onRejectPlan: noop,
      planModeActive: true,
      planContent: "# Ship the export\n\n1. Audit the store\n2. Migrate data",
      planTruncated: true,
    }),
  );
  assert.match(html, /Ship the export/);
  assert.match(html, /Audit the store/);
  assert.match(html, /(Plan file too large|plan\.truncatedNote)/);
});

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ClampedDescription, clampDescriptionStyle } = await jiti.import("./toast.tsx");

const TOOL_LIST = "xd://: mounted mcp__ida_reverse_engineering_ida_address_context, mcp__ida_decompile";

test("clamped description renders collapsed to 2 lines with an expand affordance", () => {
  const html = renderToStaticMarkup(React.createElement(ClampedDescription, null, TOOL_LIST));

  assert.match(html, new RegExp(TOOL_LIST.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /-webkit-line-clamp:2/);
  assert.match(html, /-webkit-box/);
  assert.match(html, /overflow:hidden/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /cursor:pointer/);
  assert.match(html, /Click to expand/);
});

test("clamp style helper drops the clamp when expanded", () => {
  const collapsed = clampDescriptionStyle(false);
  const expanded = clampDescriptionStyle(true);

  assert.equal(collapsed.display, "-webkit-box");
  assert.equal(collapsed.WebkitLineClamp, 2);
  assert.equal(collapsed.overflow, "hidden");
  assert.equal(collapsed.cursor, "pointer");

  assert.equal(expanded.display, undefined);
  assert.equal(expanded.WebkitLineClamp, undefined);
  assert.equal(expanded.overflow, undefined);
  assert.equal(expanded.cursor, "default");
});

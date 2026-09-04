import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const messageViewSource = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");
const { MessageView, SafeMarkdownBody } = await jiti.import("./MessageView.tsx");
const { CodeBlock } = await jiti.import("./MermaidBlock.tsx");

test("large message content avoids the markdown pipeline until requested", () => {
  const largeMessage = "x".repeat(100_001);
  const html = renderToStaticMarkup(React.createElement(SafeMarkdownBody, null, largeMessage));

  assert.match(html, /Large message \(100 KB\)/);
  assert.doesNotMatch(html, /markdown-body/);
});

test("streaming code blocks avoid syntax-highlighter line markup", () => {
  const html = renderToStaticMarkup(React.createElement(CodeBlock, {
    code: "const value = 1;",
    lang: "ts",
    isStreaming: true,
  }));

  assert.match(html, /const value = 1;/);
  assert.doesNotMatch(html, /linenumber/);
});

test("MCP mount notices stay out of the transcript", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    message: {
      role: "custom",
      customType: "xdev-mount-notice",
      content: "The xd:// device inventory changed.",
      display: false,
    },
  }));

  assert.equal(html, "");
});

test("streaming tool calls start collapsed when the interface preference is enabled", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    isStreaming: true,
    toolCallsDefaultCollapsed: true,
    message: {
      role: "assistant",
      content: [{ type: "toolCall", toolCallId: "call-1", toolName: "read", input: { path: "foo.ts" } }],
    },
  }));

  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /<pre/);
});

test("expanded tool calls show the compact command header", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    isStreaming: true,
    toolCallsDefaultCollapsed: false,
    message: {
      role: "assistant",
      content: [{ type: "toolCall", toolCallId: "call-1", toolName: "read", input: { path: "foo.ts" } }],
    },
  }));

  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /tool-call-details/);
  assert.match(html, /\$<\/span><code>read foo\.ts<\/code>/);
});

test("expanded read output uses compact terminal text without line gutters", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    isStreaming: true,
    toolCallsDefaultCollapsed: false,
    message: {
      role: "assistant",
      content: [{ type: "toolCall", toolCallId: "call-1", toolName: "read", input: { path: "foo.ts" } }],
    },
    toolResults: new Map([[
      "call-1",
      { role: "toolResult", toolCallId: "call-1", content: [{ type: "text", text: "1: const value = 1;\\n2: return value;" }] },
    ]]),
  }));

  assert.match(html, /data-tool-output="true"/);
  assert.match(html, /const value = 1;/);
  assert.doesNotMatch(html, /1: const value/);
});

test("tool operations render as compact timeline rows", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    message: {
      role: "assistant",
      timestamp: 1000,
      content: [{ type: "toolCall", toolCallId: "call-1", toolName: "bash", input: { command: "npm test" } }],
    },
    toolResults: new Map([[
      "call-1",
      { role: "toolResult", toolCallId: "call-1", content: [], timestamp: 3000 },
    ]]),
  }));

  assert.match(html, /data-activity-operation="true"/);
  assert.match(html, /activity-row-indicator/);
  assert.match(html, /activity-row-duration/);
  assert.doesNotMatch(html, /border-radius:7px/);
});
test("irc:incoming custom messages title with the sender name", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    message: {
      role: "custom",
      customType: "irc:incoming",
      content: "<irc>\nIncoming IRC message from agent `AuditUiComponents`:\n\nPlease review the current tree.\nThanks.",
      display: true,
    },
  }));
  assert.match(html, /AuditUiComponents/);
  assert.doesNotMatch(html, /irc:incoming/);
  assert.match(html, /Please review the current tree/);
  assert.doesNotMatch(html, /Incoming IRC message from agent/);
});

test("advisor custom messages use the localized advisor label", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    message: { role: "custom", customType: "advisor", content: "Consider handling the edge case.", display: true },
  }));
  assert.match(html, /Advisor/);
  assert.match(html, /Consider handling the edge case/);
  assert.doesNotMatch(html, /customType/);
});


test("skill-file reads stay collapsed even when tool calls default expanded", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    isStreaming: true,
    toolCallsDefaultCollapsed: false,
    message: {
      role: "assistant",
      content: [
        { type: "toolCall", toolCallId: "call-1", toolName: "read", input: { path: ".agents/skills/60fps-animation/SKILL.md" } },
        { type: "toolCall", toolCallId: "call-2", toolName: "read", input: { path: "src/plain.ts" } },
      ],
    },
  }));

  // 两个 toolCall 块：第一个 aria-expanded=false（skill 强制收起），
  // 第二个 =true（全局展开设置对普通文件生效）。
  const expandedFlags = [...html.matchAll(/aria-expanded="(true|false)"/g)].map((m) => m[1]);
  assert.equal(expandedFlags[0], "false");
  assert.equal(expandedFlags[1], "true");
});

test("skill content returned by a generic grep/read call stays collapsed", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    isStreaming: true,
    toolCallsDefaultCollapsed: false,
    message: {
      role: "assistant",
      content: [{ type: "toolCall", toolCallId: "call-skill-result", toolName: "grep", input: { query: "SKILL.md", path: "/tmp" } }],
    },
    toolResults: new Map([[
      "call-skill-result",
      { role: "toolResult", toolCallId: "call-skill-result", content: [{ type: "text", text: "# .agents/skills/\n## 60fps-animation/\n### SKILL.md" }] },
    ]]),
  }));

  assert.match(html, /aria-expanded="false"/);
});

test("deferred thinking rows prefetch their body instead of relying on click-time fetch", () => {
  // The behavior is intentionally implemented as a mount prefetch so the
  // collapsed row never has to expose an empty shell after a user opens it.
  assert.match(messageViewSource, /Prefetch once when the row mounts/);
});

test("streaming thinking auto-expands only while it is the latest block", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    isStreaming: true,
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "first attempt reasoning" },
        { type: "toolCall", toolCallId: "call-1", toolName: "read", input: { path: "a.ts" } },
        { type: "thinking", thinking: "second attempt reasoning" },
      ],
    },
  }));

  const expandedFlags = [...html.matchAll(/aria-expanded="(true|false)"/g)].map((m) => m[1]);
  // 第一段思考（已过时）收起；toolCall 收起；最新一段思考展开。
  assert.equal(expandedFlags[0], "false");
  assert.equal(expandedFlags[2], "true");
});

test("committed thinking blocks default collapsed", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    message: {
      role: "assistant",
      content: [{ type: "thinking", thinking: "finished reasoning" }],
    },
  }));

  assert.match(html, /aria-expanded="false"/);
});

test("provider errors render as a persistent assistant error row", () => {
  const html = renderToStaticMarkup(React.createElement(MessageView, {
    message: {
      role: "assistant",
      content: [],
      provider: "opencodex",
      model: "pro/gpt-5.6",
      stopReason: "error",
      errorStatus: 403,
      errorMessage: "预扣费失败，用户剩余额度不足",
    },
  }));

  assert.match(html, /data-message-error="true"/);
  assert.match(html, /Error: 403/);
  assert.match(html, /预扣费失败/);
});

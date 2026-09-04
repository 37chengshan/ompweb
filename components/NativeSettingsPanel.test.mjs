import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { NativeSettingsPanel } = await jiti.import("./NativeSettingsPanel.tsx");
const {
  translateDescription,
  translateKeyTitle,
  translateSubgroup,
  translateEnumOption,
  formatSettingType,
  KEY_DESCRIPTIONS_ZH,
} = await jiti.import("../lib/omp/settings-descriptions-zh.ts");

test("native settings SSR exposes a loading state instead of a false empty result", () => {
  const html = renderToStaticMarkup(React.createElement(NativeSettingsPanel));
  assert.match(html, /Loading OMP settings|正在加载 OMP 设置|OMP 設定を読み込み中/);
  assert.doesNotMatch(html, /No settings match the filter/);
});

test("native settings keeps the standalone entry point in one toolbar", () => {
  const html = renderToStaticMarkup(React.createElement(NativeSettingsPanel, { onOpenStandalone: () => {} }));
  assert.match(html, /Open in separate window|在独立窗口打开/);
  assert.match(html, /OMP Native Settings|OMP 原生设置/);
});

test("native settings Chinese localization helpers translate titles, descriptions, subgroups, and enums", () => {
  // Titles
  assert.equal(translateKeyTitle("zh-CN", "tools.approvalMode"), "全局工具审批策略");
  assert.equal(translateKeyTitle("zh-CN", "defaultThinkingLevel"), "默认思考推理深度");
  assert.equal(translateKeyTitle("en", "tools.approvalMode"), undefined);

  // Descriptions (both schema-described and previously-empty keys)
  assert.match(translateDescription("zh-CN", "Action when pressing Escape twice with empty editor"), /按两次 Escape/);
  assert.equal(translateDescription("zh-CN", undefined, "retry.enabled"), KEY_DESCRIPTIONS_ZH["retry.enabled"]);
  assert.match(translateDescription("zh-CN", undefined, "retry.enabled"), /自动发起重试/);

  // Subgroups
  assert.equal(translateSubgroup("zh-CN", "theme"), "主题外观");
  assert.equal(translateSubgroup("zh-CN", "statusLine"), "状态行");
  assert.equal(translateSubgroup("zh-CN", "approvalMode"), "审批模式");
  assert.equal(translateSubgroup("en", "theme"), "theme");

  // Enum options
  assert.match(translateEnumOption("zh-CN", "tools.approvalMode", "yolo"), /自动批准/);
  assert.match(translateEnumOption("zh-CN", "memory.backend", "local"), /本地 SQLite/);
  assert.equal(translateEnumOption("en", "tools.approvalMode", "yolo"), "yolo");

  // Setting types
  assert.equal(formatSettingType("zh-CN", "boolean"), "布尔");
  assert.equal(formatSettingType("zh-CN", "enum"), "枚举");
  assert.equal(formatSettingType("zh-CN", "number"), "数字");
  assert.equal(formatSettingType("en", "boolean"), "boolean");
});


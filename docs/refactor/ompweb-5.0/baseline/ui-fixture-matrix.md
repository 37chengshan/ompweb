# UI 黄金 fixture 矩阵（W0 基线）

按 `10-web-client-and-ui-fidelity.md` 与 `12-...md` 要求登记的截图/回归矩阵。
本文件是 5.0 期间任何视觉对比的"什么该长什么样"清单；golden 截图工具的引入
是独立工具决策（见文末"待工具决策"），矩阵与状态定义先行冻结。

## 会话数据 fixture

确定性生成器：`scripts/gen-session-fixtures.mjs`（固定 seed，sha256 固定 hash）。

| Fixture | 规模 | 用途 |
|---|---|---|
| Chat-S | 100 messages | 日常交互、快速打开 |
| Chat-L | 1,000 messages（Markdown/代码块/toolCall/toolResult/图片 metadata） | 长对话滚动、DOM 有界性 |
| Chat-XL | 5,000 messages | 极限窗口、内存、搜索 |
| Sessions-L | 1,000 sessions（含 worktree/branch/archive 分布） | sidebar、session list 性能 |

## 状态矩阵（每个 fixture 下的 UI 状态）

- 空会话（无消息）
- 长会话顶部 / 底部 / 中段
- streaming 中（token 流式、工具运行中）
- tool running / tool failed
- approval 待确认
- subagent 面板（展开/收起、live/终态 chip）
- todo 面板（进行中/完成）
- 分支切换（BranchNavigator）
- 图片 lightbox
- 错误 notice / 重试中（auto retry）
- offline / 重连中

## 组件矩阵

| 表面 | 必测状态 |
|---|---|
| SessionSidebar | 项目卡片、worktree 选择器、运行徽标、活动脉冲、折叠动画 |
| ChatInput | 聚焦/失焦、model/thinking/tools 下拉、slash 与 @ 菜单、拖放高亮 |
| MessageView | 用户/助手/工具调用/工具结果、代码块、KaTeX、Mermaid |
| ComposerPanels | TodoList 折叠/展开、subagent chip 状态点 |
| FileViewer / FileExplorer | 树展开、文件 tab、watch 状态 |
| TerminalPanel | 打开/关闭、resize、输出 |
| 设置全部 modal | ModelsConfig、McpConfig、PluginsConfig、SkillsConfig、SettingsConfig 各 tab |
| Dialog / Toast / CommandPalette | 进入/退出动画、焦点环 |
| 诊断页 | BackendDiagnostics 各状态 |

## 维度

- 主题：light（warm-paper）/ dark（warm-ember）
- 语言：en / zh-CN / ja
- 视口：1360×860（desktop 基准）、最小窗口、375×812（mobile 常用）
- 交互态：hover / focus-visible / disabled / error / loading / reduced-motion

## reduced-motion 语义

`prefers-reduced-motion: reduce` 下：进入/循环动画收敛为静态或瞬时终态
（SMIL 由 `usePrefersReducedMotion` 停止；主题扩散动画由 useTheme 自身处理）。
矩阵中每个含动画状态都要有 reduce 态对照帧。

## 待工具决策（不阻塞 W0）

1. 截图 runner：仓库当前无 Playwright/e2e 设施；引入属新增依赖（安装体积、
   下载浏览器二进制、CI 影响），按 12 的发布门要求单独决策后接入
   `npm run test:visual`。接入前，动画回归由 `lib/motion-manifest.test.mjs`
   （keyframes/token/组件内联/SMIL/theme/splash 删除与改节奏检测）+
   人工对照本矩阵执行。
2. 截图容差：跨平台（WKWebView/WebView2/WebKitGTK）字体栅格差异需要分平台
   阈值；不得用大阈值掩盖布局变化。

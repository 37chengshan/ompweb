# 右侧工作区重构与开源模式研究

日期：2026-09-04  
范围：ompweb 5.1 右侧面板、终端位置、子代理交互与空态工作区

## 结论

本轮采用“原生工作区”实现，不安装或依赖 DSH 插件。右栏首次打开显示一个轻量空态，提供四个真实入口：文件、任务管理、侧栏对话、浏览器。入口打开后进入同一工作区，可增加多个工作面、拆分为两个 pane、拖动标签到另一个 pane，并在当前会话维度恢复布局。

Git 不再是右栏 tab。Git 状态仍可从顶部入口查看，文件树中的 Git 状态标记继续保留。终端继续位于聊天底部抽屉，支持多 tab、独立 cwd 和拖动高度。

## 参考实现与取舍

### DSH / better-sidebar

- [DeepSeek Harness 官方介绍](https://www.deepseek.com/harness/en/) 将模型、工具、技能、会话、沙箱、存储、循环、调度和 UI 都定义为可挂载插件，并由 Cordis 负责生命周期与依赖。
- [deepseek-harness GitHub](https://github.com/deepseek-ai/deepseek-harness) 明确标注 developer preview，插件 API 可能发生破坏性变更。
- [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 展示了双侧栏/底部面板、文件/浏览器/终端/子代理等工作面、标签移动、split tree、按 session 持久化、重依赖懒加载与错误边界。

我们只吸收稳定的交互原则：空态选工作面、标签可组合、布局按会话保存、重面板隔离故障。没有直接引入 DSH 运行时，避免将 developer-preview API 绑定到 Node/Next 和打包 App；这也是“子代理不再点击后弹出魔法 transcript 插件”的原因。子代理现在在原生 Agents 面板内筛选、展开 telemetry，默认不弹出二级魔法窗口。

### 终端布局

[Zed terminal 文档](https://github.com/zed-industries/zed/blob/main/docs/src/terminal.md) 采用底部 dock 作为默认终端位置，同时允许改到左右，并支持多个终端实例以 tab 管理。ompweb 保持用户已明确选择的底部终端：右栏负责工作面，终端负责持续的 shell 流。

### 对话与执行边界

[OpenHands 架构文档](https://github.com/OpenHands/OpenHands/blob/main/docs/architecture.md) 将前端 Canvas（对话、终端、浏览器、文件、设置）与执行器后端分离。ompweb 的侧栏对话入口因此只做“整理问题并放入主输入框”，不会伪装成一个没有独立 session 生命周期的第二 agent。

[dsh-sidebar-qa](https://github.com/ChenRuoT/dsh-sidebar-qa) 的模式是创建独立 DSH session 来追问，并不会打断主对话。若未来要提供真正独立的侧栏会话，应复用 omp-web 已有的 session 创建/恢复/销毁协议，而不是在本组件里偷偷启动一个临时 agent。

## 已落地行为

1. 空态四入口：打开文件、任务管理、侧栏对话、浏览器。
2. 文件入口：无打开文件时显示当前 cwd 的原生 FileExplorer；点击文件后沿用现有 FileViewer tab。
3. 任务管理：原生 AgentsPanel，运行/历史分区、筛选和 inline telemetry；不再依赖 transcript modal。
4. 侧栏对话：本地草稿区，明确“放入主输入框”，保留主会话和侧栏会话的生命周期边界。
5. 浏览器：输入 `http(s)` 地址后在 iframe 预览，并提供系统浏览器 fallback；遵守 X-Frame-Options/CSP 限制，不承诺绕过站点策略。
6. 组合：工具栏可加入工作面；最多两个 pane；拖动标签可在 pane 间移动；分隔线支持横向/纵向拖动，比例按会话持久化。
7. 稳定性：Files/Agents 内容分别置于 PanelErrorBoundary，单面板渲染错误不再清空整个聊天区。

## 性能与可访问性

- 布局只在 splitter pointer/mouse move 更新 React 状态，不在每个移动事件写 localStorage；释放鼠标后由 effect 持久化。
- AgentsPanel 对分组、排序和过滤使用 `useMemo`，SubagentCard 使用 `memo`；筛选无结果时给出明确空态。
- Browser iframe 只在浏览器工作面激活后创建；关闭工作面即可释放文档与脚本。
- pane、tab、分隔线和入口按钮均有语义标签；子代理卡片保留 `treeitem`、`aria-expanded` 和键盘左右展开/收起。
- `prefers-reduced-motion` 继续由全局动效策略控制；工作区没有新增持续动画。

## 已知边界

- 当前 native split 是两 pane 上限，不是无限递归的 DSH split tree；这是为了先保证响应式、可恢复和 App/Web 一致。后续如需无限嵌套，应先抽离纯布局 reducer 和迁移格式，再扩展持久化 schema。
- iframe 受目标网站自身 CSP、X-Frame-Options、登录隔离影响；外部打开按钮是有意的可用 fallback。
- 侧栏对话目前是主 composer 的聚焦草稿入口，不是第二条 agent 运行链；独立 session 需要另一个明确产品决定。


# 10 — Web Client 解耦、UI/动画保真与长对话渲染

## 目标

把现有 Next-coupled UI 变成可静态构建、可通过不同 adapter 运行的 React client，同时保持当前视觉/动效 100% 产品保真，并解决长对话、流式输出和交互卡顿。

## 绝对边界

本工作包不是 redesign：

- 不改色板、字体、圆角、阴影、密度和信息架构；
- 不把现有组件替换成另一套 design system；
- 不删除“细节动画”来换性能；应优化触发范围、合成层和更新频率；
- reduced-motion 行为必须保留；
- 性能优化如果改变视觉，必须先证明是 bug 修复并单独批准。

## 静态客户端拆分

Tauri 需要静态前端；Web 也应变成真正 client/server 关系。实施顺序：

1. 所有数据经 01 的 OmpwebClient。
2. 移除 client component 对 Next route/server module 的 import。
3. 把 bootstrap 配置改为运行时注入或 adapter handshake，不在 build 时硬编码 Host。
4. 建独立 static build target；现有 Next app 继续作为 compatibility web host。
5. 同一静态 bundle 可运行在 Tauri、普通浏览器和 Mobile WebView。

不要求立即移除 Next；它可继续提供 Web 托管、登录和 legacy adapter，直到 Host/Remote 稳定。

## UI 黄金基线

### 视觉 fixture

- 空会话、长会话、streaming、tool running/failed、approval、subagent、todo；
- sidebar 项目/工作树/运行状态、file viewer、terminal；
- 所有 settings modal、command/slash/@ menus、dialog/toast；
- light/dark、主题变体、中文/英文/日文；
- desktop 1360×860、最小窗口、常用 mobile viewport；
- hover/focus/disabled/error/loading/reduced-motion。

### 动画 manifest

自动/人工登记：

- `app/globals.css` 的所有 `@keyframes` 和 `--dur-* / --ease-out-warm`；
- 组件内联 `transition/animation`；
- `useTheme` Web Animations；
- SVG SMIL 与 `usePrefersReducedMotion`；
- splash 视频/fade；
- 哪些动画只能 mount 一次、哪些允许循环、哪些 hidden 时暂停。

Playwright 截取 0%、中间、结束状态；duration 允许小范围计时抖动，但 easing、方向、opacity/transform 终点不能变。

## 长对话性能

当前 [`lib/chat-lazy-load.ts`](../../../lib/chat-lazy-load.ts) 首次只渲染最后 50 条，但用户向上加载后已加载 DOM 不会再次卸载；真正长会话仍会增长。

### 分步方案

1. **测量**：建立 100/1k/5k message fixture，包含长 Markdown、代码、Mermaid、tool result、图片 metadata。
2. **低风险优化**：completed message memo、stable props、lazy heavy renderer、`content-visibility` 实验、后台 tab 降频。
3. **有界窗口**：只挂 viewport + overscan，卸载远端 message 时保存实测高度 placeholder；DOM message shell 设硬上限。
4. **锚点正确性**：prepend、stream append、图片/diagram 异步变高、字体加载、branch 切换后 scroll 不跳。
5. **功能兼容**：text selection/copy、浏览器查找、ChatMinimap、message refs、fork/navigate、时间戳、图片 lightbox。
6. **库决策**：对自研窗口与 TanStack Virtual 动态高度方案做 spike。TanStack 支持 `measureElement`，但采用前必须验证 selection、minimap 和动画。[TanStack Virtual](https://tanstack.com/virtual/latest/docs/api/virtualizer)

不能只用“折叠历史”掩盖卡顿；用户加载全部历史后仍必须保持 DOM 和内存有界。

## 流式与交互

- 保留现有 `message-update-coalescer` 和 rAF follow-scroll 基线；
- completed transcript 不因 token update 重渲染；
- streaming Markdown 按帧预算自适应 30–60Hz，低端设备可降频但输入/光标优先；
- Mermaid/KaTeX/syntax highlight 只在 block 稳定或可见时加载；
- 大 message parse 可拆任务/Worker 做非 DOM 预处理，DOM commit 仍在主线程；
- menu search、session search 使用 deferred/worker，不阻塞 textarea；
- 避免 scroll handler 中读写交错导致 layout thrashing。

React Profiler 用于记录 commit duration；INP/自定义 input-to-paint 用于衡量真实交互，不能只看 FPS 平均值。[React Profiler](https://react.dev/reference/react/Profiler)、[INP](https://web.dev/articles/inp)

## Bundle 与启动

- Mermaid、KaTeX、Mammoth、syntax highlighter、settings 大面板按需加载；
- 初始 bundle 预算由 12 冻结，新增依赖必须提供增量大小；
- static app 首屏不等待 models/session 全量 scan 才可交互；
- 最近 workspace/session 用快照先画 shell，再用 Host snapshot reconcile；
- skeleton/启动动画保持现有风格，不用空白页换取指标。

## 实施切片

1. UI/performance fixture + visual/motion manifest。
2. OmpwebClient 注入和 static build PoC。
3. heavy module lazy boundaries 与 bundle report。
4. long-chat measured window PoC，仅在实验 flag 下。
5. selection/minimap/anchor/animation 回归通过后默认启用。
6. streaming adaptive scheduler、background throttling。
7. 浏览器/Tauri WebView/mobile matrix。

## 退出标准

- static client 在 Fixture、HTTP/SSE、LocalHost、Remote adapters 下行为一致；
- 视觉 diff、动画 manifest、reduced-motion 全通过；
- 5k message fixture 的 DOM 数和内存有界，输入/滚动满足 12 预算；
- 流式更新不重渲染 committed transcript；
- 初始 bundle/启动时间不超过冻结预算；
- 用户看不到“重构导致的新风格”。

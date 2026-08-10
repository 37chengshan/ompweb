# omp-web UI/UX 全面重塑设计：温暖人文（Warm Paper）

- 日期：2026-07-27
- 状态：待用户审阅
- 范围：视觉打磨、聊天主流程、配置表单、反馈与状态系统

## 1. 背景与目标

omp-web 是 oh-my-pi 的 Web 界面（Next.js 16 + React 19 + Tailwind CSS 4 + 自定义 CSS 变量双主题）。现状基础扎实（双主题、响应式、a11y、加载/空/错误态齐全），但视觉中性、组件全部手写、无组件库支撑、反馈系统不统一。

目标：在不改变任何功能、数据流、快捷键、路由的前提下，完成一次"个性重塑"——**温暖人文**风格（纸感浅色 + 暖炭深色），并借开源组件库消灭重复造轮子。

## 2. 已确认的决策（拷问结论）

| 决策点 | 结论 |
|---|---|
| 优化范围 | 视觉打磨 + 聊天主流程 + 配置表单 + 反馈状态系统（四项全做） |
| 风格走向 | 个性重塑（非克制进化） |
| 品牌质感 | 温暖人文（Notion/Readwise 方向：纸感、暖灰、衬线标题） |
| 深色模式 | 暖深色（暖炭灰/墨黑背景 + 暖白文字，深浅同气质） |
| 字体策略 | 衬线标题 + 无衬线正文（Source Serif 4 + Noto Serif SC / 系统 sans / 现有 mono） |
| 改动边界 | 深度重构可接受；既有功能、数据流、快捷键、路由不变（新增 ⌘K 命令面板等纯前端交互增强除外） |
| 推进方式 | 令牌先行 + 分批落地；Phase 0 用聊天主界面做视觉验证 |
| 组件库 | shadcn/ui（Base UI 变体）+ cmdk + lucide-react + motion |

## 3. 设计令牌体系

全部落在 `app/globals.css` 的 CSS 变量层，经 Tailwind 4 的 `@theme inline` 暴露为 utility token。组件代码逐步换用语义 token，消灭裸色值与 inline style。

### 3.1 色板

浅色 · 纸感（paper）：

| 令牌 | 值 | 用途 |
|---|---|---|
| `--bg` | `#FAF9F6` | 页面背景（暖纸白） |
| `--bg-panel` | `#F2F0EA` | 侧栏/面板/工具栏 |
| `--bg-hover` | `#EAE7DF` | 悬停 |
| `--bg-selected` | `#E5E0D4` | 选中 |
| `--border` | `#E2DDD2` | 边框 |
| `--text` | `#2B2823` | 正文（暖墨黑） |
| `--text-muted` | `#6E6860` | 次要文字 |
| `--text-dim` | `#948D82` | 弱化文字 |
| `--accent` | `#C24A2E` | 赭红主色（按钮/链接/焦点环） |
| `--accent-hover` | `#A83D24` | 主色悬停 |
| `--user-bg` | `#F5EDE1` | 用户消息气泡（奶油） |

深色 · 暖炭（ember）：

| 令牌 | 值 |
|---|---|
| `--bg` | `#1B1916` |
| `--bg-panel` | `#231F1B` |
| `--border` | `#38322B` |
| `--text` | `#EBE6DC` |
| `--text-muted` | `#A39B8E` |
| `--accent` | `#E07B54` |
| `--user-bg` | `#2C2721` |

深色未列出的令牌按同原则推导（悬停/选中在面板色上提亮一档）。所有文字/背景组合满足 WCAG AA（≥4.5:1），在 globals.css 注释标注实测比值。

### 3.2 字体与字阶

- 标题（会话标题、弹窗标题、空状态大字、Toast 标题）：`Source Serif 4` + `Noto Serif SC`（Google Fonts，`next/font` 加载，`display: swap`）
- 正文/控件：现有系统无衬线栈不变
- 代码：`--font-mono` 现状不变
- 字阶：12 / 13 / 14（正文）/ 16 / 20 / 28px，行高 1.5–1.6

### 3.3 形状、阴影、动效

- 圆角：控件 8px / 卡片与气泡 12px / 弹窗 16px
- 阴影：浅色为暖调漫射（`rgba(60,50,35,.06–.12)` 三档）；深色为环境光晕（低透明度暖黑 + 1px 暖边）
- 动效：统一 `150ms / 220ms / 320ms` 三档，缓出 `cubic-bezier(.22,1,.36,1)`；`prefers-reduced-motion` 全局降级为即时切换

## 4. 组件栈

| 库 | 用途 | 备注 |
|---|---|---|
| shadcn/ui（Base UI 变体） | Dialog/AlertDialog/DropdownMenu/Tooltip/Tabs/ScrollArea/Field/Form/Popover/Collapsible 等基元 | 源码拷入 `components/ui/`，可自由改造；主题契约即 CSS 变量 |
| Base UI Toast（随 shadcn） | 全局通知 | 不引 Sonner |
| cmdk | ⌘K 命令面板 | React 19 社区验证可用，接入前先冒烟测试 |
| lucide-react | 统一图标，替换全部内联 SVG | tree-shaken |
| motion | 弹窗/Toast 进出、布局动画 | 悬停/聚焦仍用纯 CSS |

不引入 Radix Themes（定制美学受限）、React Aria（i18n 价值重复、更重）。

## 5. 区域改造方案

### A. 视觉打磨（地基）

1. 重建 `globals.css`：双主题暖色板 + `@theme inline` token + 圆角/阴影/动效令牌
2. 接入衬线字体并建立标题体系
3. 内联 SVG → lucide-react；inline style → Tailwind + 语义 token
4. 触达目标 ≥44px；focus-visible 暖赭焦点环统一

### B. 聊天主流程

1. 消息气泡：用户=奶油底 + 赭红左边线；助手=纸白卡片 + 暖阴影；工具调用=米灰可折叠卡片（Base UI Collapsible）
2. 输入框：聚焦暖光晕、多行自适应；@提及/斜杠命令与 ⌘K 命令面板（cmdk：切会话/搜文件/切主题/换模型）
3. 流式：打字光标 → 呼吸暖点；minimap 暖色刻度；回到底部按钮 → 悬浮胶囊
4. 消息操作条（复制/分叉/编辑）→ Base UI Toolbar + Tooltip

### C. 配置表单（Models/Skills/Plugins）

1. 迁移至 Base UI Dialog + Field + Form：字段分组卡片化
2. 必填/格式校验即时反馈，错误文案挂字段下方（暖红）
3. 保存成功走 Toast；危险操作（删除/重置）用 AlertDialog 二次确认

### D. 反馈与状态系统

1. Toast 四类：成功 / 错误 / 信息 / 任务完成；右下角堆叠；暖色图标 + 衬线标题
2. 骨架屏统一暖色 shimmer
3. 空状态：衬线大标题 + 步骤引导 + 主按钮
4. 错误页（error.tsx / global-error.tsx）：插画级排版 + 重试/返回双按钮

## 6. 阶段计划

- **Phase 0（视觉验证）**：令牌重建 + 衬线字体 + 聊天主界面（消息气泡/输入框/顶栏）落地 → 用户确认方向
- **Phase 1**：聊天主流程剩余（cmdk 命令面板、流式细节、minimap、操作条）
- **Phase 2**：侧栏 + 文件面板（TabBar/FileViewer/FileExplorer）
- **Phase 3**：配置弹窗三件套（Models/Skills/Plugins）
- **Phase 4**：反馈与状态系统收尾（Toast 全量接入、骨架/空态/错误页打磨）

每 Phase 结束跑 `npm run lint` + `npm run build` 验证，深色/浅色、桌面/移动端双查。

## 7. 错误处理与降级

- cmdk 冒烟失败 → 退回自研简单面板，不阻塞主线
- Google Fonts 加载失败 → `next/font` 自动回退系统衬线（Georgia/宋体系）
- motion 动画在 `prefers-reduced-motion` 下全部禁用
- Base UI 组件样式缺口 → 在 `components/ui/` 内修补，不改库源码语义

## 8. 验证与测试

- 每 Phase：`npm run lint`、`npm run build` 必须通过
- 人工走查清单：浅色/深色 × 桌面/移动 × 主要流程（开会话、发消息、看文件、改配置）
- 对比度抽查：accent on bg、muted on panel ≥ 4.5:1
- 现有快捷键（Esc 中止、Ctrl+Alt+N 新会话）回归确认

## 9. 非目标（YAGNI）

- 不做引导式 onboarding 教程、不做拖拽重排消息/标签页
- 不重构状态管理、不引入 zustand/redux
- 不改变 i18n 架构（新增文案按现有三语字典补齐）
- 不做品牌 logo/营销页设计

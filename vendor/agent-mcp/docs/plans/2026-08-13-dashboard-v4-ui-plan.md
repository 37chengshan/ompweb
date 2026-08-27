# Agent MCP 仪表盘 UI 深度升级计划（v4）

**日期**：2026-08-13 ｜ **现状**：v3 全屏分页（总览/Token/协作/策略/工作区），功能齐全但视觉简陋
**目标**：从"功能面板"升级为"完整仪表盘"——有设计系统、视觉层次、图表、交互质感，保持零依赖/无构建约束

---

## 0. 现状诊断（简陋根因）

| 维度 | 现状 | 问题 |
|---|---|---|
| 布局 | 顶部一排 Dock + 全屏单页 | 无导航层级、无侧栏、无全局信息骨架 |
| 数据呈现 | 纯文字数字卡 + 一张预算环 | 零图表、零趋势、零时间维度 |
| 视觉质感 | 卡片列表、平铺 | 无渐变、无玻璃拟态、无阴影层级、留白不足 |
| 字体层级 | 统一 10-12px | 无 Hero 数字、无标题层级、无品牌感 |
| 交互 | 点击切页、hover 变框 | 无数据变化反馈、无排序/过滤、无三态（空/载/错） |
| 动效 | 入场/呼吸 | 无状态过渡、无数字跳动、无图表动画 |

## 1. 设计系统（Design Tokens）

### 1.1 视觉令牌（扩展现有 30 个 CSS 变量）
```
颜色：
  --bg-deep:#0E0E0D（舞台背景，比现有更深）  --bg（卡片区）
  --card / --card-hover / --card-active
  --line / --line-soft（边框分层）
  --ink / --ink-2 / --ink-soft（文字三级）
  --accent:#D96B4F → --accent-deep / --accent-soft / --accent-glow
  语义：--green/--amber/--red + 各自 soft/deep
  品牌渐变：--grad-accent（linear-gradient 135deg 暖橙→琥珀）、--grad-status
字体：
  --serif 标题（Georgia/Songti）· --sans 正文（系统栈）· --mono 数字/代码
  Hero 数字 32px / 卡标题 13px / 标签 9px mono 大写
间距：4px 网格（4/8/12/16/24/32）
圆角：--r-sm 8 / --r 12 / --r-lg 16 / --r-xl 20
阴影：--shadow-soft / --shadow-pop / --shadow-glow（accent 辉光）
动效：--ease（现有 cubic-bezier）+ 时长分级（150/250/350/500ms）
```

### 1.2 组件库（纯函数渲染 + 复用，不引框架）
```
StatCard      统计卡：Hero 数字 + 标签 + 副文案 + 迷你 sparkline + hover lift
Sparkline     迷你折线（最近 N 点，SVG path 自绘）
BarStack      堆叠柱（输入/输出/缓存 构成）
DonutChart    环形占比（复用预算环模式，支持多段）
DataTable     可排序表：点击表头排序 + 斑马纹 + 悬停高亮 + 数值右对齐
Timeline      时间线流：圆点 + 连接线 + 内容（分级缩进）
Badge/Tag/StatusDot  状态徽章（现有点位 + 辉光）
PanelHeader   面板标题：小标签 + 标题 + 操作区（刷新/过滤/展开）
三态组件      empty / loading（骨架屏）/ error（重试）
```

## 2. 舞台骨架重构（v4 Layout）

```
┌────────────────────────────────────────────────────────┐
│ 顶部 Header：品牌 · 全局胶囊（运行中/异常/成本实时）·   │
│            token 迷你条 · 会话选择 · 时间 · 关闭        │
├────────┬───────────────────────────────────────────────┤
│ 侧栏    │  主内容区（grid 12 列响应式）                  │
│ 导航    │  ┌─────────────────────────────────────────┐ │
│ 总览 ▸  │  │ 面板内容（分页切换，保留常驻/可见性机制） │ │
│ Token  │  │                                         │ │
│ 协作    │  └─────────────────────────────────────────┘ │
│ 策略    │                                               │
│ 工作区  │                                               │
│ ─────  │                                               │
│ SSE 点  │                                               │
└────────┴───────────────────────────────────────────────┘
底部状态条：SSE 状态 · 最近事件一行 · daemon 端口 · 版本
```

- **侧栏**：88px 图标导航（SVG 内联图标 + 文字），激活态 accent 竖条 + 呼吸点；窄屏折叠为底部图标栏
- **顶部 Header**：全局统计胶囊（运行中 N / 异常 N / 成本 $X，SSE 实时）+ token 使用率迷你条（当前/预算）
- **主内容**：12 列 grid，每面板按语义布局（下节）

## 3. 各面板升级设计

### 3.1 总览（Hero 仪表盘）
```
┌─────────────────────────────────────────────────────────┐
│ Hero 区：6 张 StatCard（横向，带 sparkline）             │
│   总Agent · 运行中(呼吸) · 已完成 · 异常(红)             │
│   总Token(趋势线) · 总成本(趋势线)                       │
├──────────────────────────┬──────────────────────────────┤
│ 左栏（宽）               │ 右栏（窄）                   │
│ 运行中 agent 泳道卡      │ 预算进度环（大 140px + 渐变） │
│ （CLI 色条 + 任务 + 状态）│ Token 构成 Donut              │
│ 最近 24h 活动时间线      │ 每小时事件密度柱（迷你）      │
└──────────────────────────┴──────────────────────────────┘
```
- 新数据：`/api/usage/series?hours=24`（每小时 token 聚合）→ sparkline + 密度柱

### 3.2 Token 用量
```
│ 全局卡 7 张（输入/输出/缓存读/缓存写/总Token/成本/ET）   │
│ ┌────────────────────┬──────────────────┐               │
│ │ 按小时堆叠趋势柱图  │ 成本占比 Donut    │               │
│ │ （输入/输出/缓存）  │ （按 agent 切片） │               │
│ └────────────────────┴──────────────────┘               │
│ 明细表（可排序：ID/任务/输入/输出/缓存/成本/占比条）      │
```
- 排序：点击表头切换 asc/desc + 方向箭头；行 hover 高亮 + 占比条动画

### 3.3 协作泳道
```
│ 泳道卡片网格（2 列响应式）                                │
│ 每卡：CLI 色条(左 3px) + 任务名 + 状态徽章 + 活动流(最新3条) │
│ 审查请求：浮动置顶卡片（writer→reviewer + diff 预览 + flash）│
│ 过滤器：全部/运行中/完成/异常 + CLI 下拉                  │
```

### 3.4 策略可视化
```
│ 左侧：预算环（大 + 渐变 + 呼吸） + 数值/上限/已派发       │
│ 右侧：策略链可视化（3 策略开关卡，启停状态）              │
│ 底部：审计日志表（时间/策略/结果徽章/原因，最新 100 条）  │
│ 决策流：SSE policy_decision 实时追加 + 高亮               │
```

### 3.5 工作区视图
```
│ worktree 卡片网格（每卡：分支名 + 状态徽章 + 路径 + 任务）│
│ 操作：合并/丢弃按钮（hover 上浮 + 执行中 loading）        │
│ 反馈：成功绿色 flash / 失败红色 inline 提示               │
│ 终态（merged/discarded）卡片降透明 + 无按钮               │
```

## 4. 后端最小补充

| 端点 | 说明 | 实现 |
|---|---|---|
| `GET /api/usage/series?hours=24` | 按小时 token/成本聚合（sparkline/柱图） | db 新增 `usage_series(hours)`：从 usage jsonl 或 events 聚合；daemon_http 路由（token 保护） |
| `GET /api/usage/by-agent`（可并入 snapshot） | per-agent 汇总（已有 per_agent） | 复用现有，不新增 |

> 目标：**后端只加 1 个端点**，其余全部消费现有 `/api/snapshot` + `/api/policies/state` + `/api/workspaces`。

## 5. 交互与动效规范

- **数字变化**：值变化时 bump（scale 1→1.22→1，150ms）——复用 index.html statBump 模式
- **卡片 hover**：translateY(-2px) + border accent + shadow-glow
- **图表**：SVG 宽度过渡（stroke-dasharray / width 500ms ease）
- **新数据行**：顶部插入 + 背景 accent-soft 渐隐（amNew）
- **三态**：加载骨架屏（shimmer 渐变条）/ 空态（icon + 文案）/ 错误（红色 + 重试按钮）
- **无障碍**：prefers-reduced-motion 全部降级；键盘 Tab 可达；aria 标签
- **性能**：DOM 复用 + 指纹 + 隐藏暂停渲染（保留 v2/v3 机制）+ IntersectionObserver 懒加载图表

## 6. 实施阶段（P1→P7）

| 阶段 | 内容 | 验收 |
|---|---|---|
| P1 设计系统 | tokens 扩展 + 组件库（StatCard/Sparkline/BarStack/Donut/DataTable/Timeline/三态）+ 骨架重构（侧栏/Header/底部条） | 新 CSS 变量 + 组件函数就位；舞台骨架渲染（node --check + 浏览器） |
| P2 图表 | Sparkline/BarStack/Donut 自绘组件 + `/api/usage/series` 端点（db 查询 + 路由 + 测试） | 组件纯函数单测（node）+ 端点 pytest |
| P3 总览页 | Hero 卡 + 双栏布局 + 趋势 sparkline + 事件密度 | 浏览器实测数据渲染 |
| P4 Token 页 | 堆叠趋势 + 成本 Donut + 可排序表 | 浏览器实测 + 排序交互 |
| P5 协作/策略/工作区 | 网格化 + 过滤器 + 图表化 | 浏览器实测 |
| P6 打磨 | 动效规范落地 + 三态 + 无障碍 + 性能审计 | reduced-motion 降级；无 console error |
| P7 收尾 | test_web 断言更新 + README 截图占位 + 提交推送 | 全量 pytest 绿 |

## 7. 风险与约束

- **零依赖硬约束**：图表全 SVG 手绘，不引 Chart.js/ECharts（~400 行内实现）
- **index.html 零改动约束**：舞台/面板全在 web/panels + web/css；仅 index 注入 loader（已 v3）
- **性能**：5s 轮询 + SSE 增量，图表数据量小（24 点/agent 数）无压力
- **兼容**：loader v4 版本号 + no-store 已就位，浏览器强刷即新

## 8. 验收总纲

- 浏览器打开仪表盘：侧栏导航 + Header 胶囊 + 5 面板全部图表化渲染
- 全局统计随 SSE 实时跳动（数字 bump）
- `/api/usage/series` pytest 覆盖（聚合正确性 + token 保护）
- 全量 pytest 绿 + node --check 全过 + 零 console 错误
- prefers-reduced-motion 下无动画

---

**下一步**：确认计划后从 P1（设计系统 + 骨架）开始实施。

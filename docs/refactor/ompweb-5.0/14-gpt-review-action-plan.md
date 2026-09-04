# ompweb 5.0 评审收敛行动计划（GPT 评审落地）

| 项 | 值 |
|---|---|
| 状态 | 计划已定稿；S-1/S-2 核心修复已先行落地于工作树（未提交、未过门）；正式执行待 Go/No-Go |
| 日期 | 2026-08-31 |
| 依据 | 外部评审（GPT）：对当前工作树的 4.0.12 增强版生产就绪评估 |
| 关联文档 | `README.md`、`PROGRESS.md`、`12-performance-quality-migration-release.md`、`baseline/perf-baseline.md`、`baseline/security-triage-w05.md` |
| 适用 | 启动与开屏、长对话渲染、Rust Host 生产接管、Remote/Relay、发布可追溯性 |

> 本计划把评审意见落地为可执行的三轮收敛行动，全部沿用目录既有约束：不做 Big Bang、OMP 唯一权威、UI 视觉与动画不动、性能是发布门、Remote 是协议收敛、不自创密码协议、未知能力安全失败。
>
> 评审中引用的代码位置（文件:行号）为评审当时工作树快照，执行时以最新工作树重新定位为准。
> **工作树现状快照（2026-08-31 收尾核验）**：评审快照早于当前工作树。当前树已先行落地 S-1/S-2 核心修复——主进程 `serverReady` 闩存 + `desktop-server-ready-state` 查询、splash 初始化后主动 `isServerReady()` + 事件监听、8 秒兜底只切「视频 → 加载层」不再绕过就绪门（`bin/splash.test.mjs` 2 测试覆盖）——均未提交、未过门验证。经本次核验，L-1/L-2（ChatWindow 全量 JSX 构造后 slice、ChatMinimap 全节点 tooltip/碰撞）、S-3（`app/layout.tsx` boot skeleton 硬编码 `#faf9f6`）、S-4（`waitForServer` 无 `res.ok` 校验）在当前树仍存在；`package.json` 已升至 4.0.15（R-1 的未提交/无同 SHA 候选问题仍然成立）；`npm test` 549 通过 / 0 失败 / 2 跳过、`tsc --noEmit` 干净、lint 0 error / 61 warning、`cargo test --offline` conformance 1/1 + storage 2/2。

## 0. 评审结论（原意转述，不修改）

**总体判定：当前应用作为 4.0.12 增强版可以继续内部使用，但不能认定为「ompweb 5.0 已全部完成」，也不建议现在按 5.0 正式发布。综合生产就绪评分约 58/100。**

| 维度 | 评审结论 |
|---|---|
| 现有 4.x 功能稳定性 | 较好 |
| 启动与开屏逻辑 | 可用，但有明确竞态与闪屏风险 |
| 长对话服务端读取 | 表现良好（1003 会话冷列表 p50 14.16ms / p95 129.46ms；Chat-XL 6000 条冷加载 13.74ms / 15.55ms；JSONL 解析 269MB/s） |
| 长对话浏览器渲染 | 已有优化（DOM 分页），但缺少真正虚拟化和实测证明 |
| Rust 后端 | 原型/基础库阶段，尚未接管生产主链路 |
| 新 Remote/Relay | 协议与模拟器阶段，没有真实安全传输端点 |
| Tauri/Mobile/W6 默认切换 | 未开始 |
| 发布可追溯性 | 不合格：工作区仍有大量未提交代码，版本号仍为 4.0.12 |

**安全面：未发现新的已证实 P0 数据破坏或直接 RCE，但存在数个发布阻断级 P1 问题。**

## 1. 问题清单（P1/P2，含证据与目标行为）

### 1.1 启动与开屏（P1 × 2，P2 × 2）

| ID | 级别 | 问题 | 证据位置（评审快照） | 目标行为 |
|---|---|---|---|---|
| S-1 | P1 | `server-ready` 信号丢失竞态：splash 页面 IPC 监听注册晚于事件发出，事件非持久状态、丢失不补发，最终靠 8 秒兜底跳转 | `desktop/main.js:381`、`desktop/preload.js:28`、`desktop/splash.html:79` | 可查询、可确认的状态握手：主进程保存 `serverReady=true`；splash 初始化后主动 `invoke("get-server-ready")`；同时监听后续 ready 事件；`did-finish-load` 后主进程补发当前状态 |
| S-2 | P1 | 8 秒兜底绕过服务器就绪检查直接 `go()`，与「只有服务器就绪才跳转」冲突；慢机可能导航到未就绪 URL → `did-fail-load` → 空窗口/失败页；重试达上限后无稳定错误页/重试按钮 | `desktop/splash.html:124`、`desktop/main.js:302` | 8 秒只结束视频、切换到持续加载层；不绕过健康门；「跳过动画」只跳视频不跳就绪；超过 20–30 秒显示明确错误、日志位置、重试与退出按钮 |
| S-3 | P2 | 深色主题闪白 + 加载状态三段跳：boot skeleton 硬编码浅色 `#faf9f6`；AppShell 一挂载就移除 skeleton | `app/layout.tsx:81`、`components/AppShell.tsx:162` | skeleton 用主题变量或在预加载脚本同步背景；splash 与 Web skeleton 同一视觉终态；用 `shell-mounted`、`session-ready` 两级状态撤遮罩；fade 后第一帧已具备正确主题与基本布局 |
| S-4 | P2 | 健康检查过宽：任何 HTTP 响应（含 404/500）即视为就绪 | `desktop/main.js:206` | 至少校验 `response.ok` + 专用 `/api/health` 标记 + 当前 App/Host 版本 + 必需依赖初始化完成 |

### 1.2 长对话渲染（P1 × 2）

| ID | 级别 | 问题 | 证据位置（评审快照） | 目标行为 |
|---|---|---|---|---|
| L-1 | P1 | 当前是「DOM 分页」不是真虚拟化：`CommittedTranscript` 仍先遍历完整 messages、构造全部 ReactNode，最后才 `rendered.slice(startIndex)`；6000 条时仍有 O(n) 全历史扫描、O(n) JSX 构造、完整数据常驻、`visibleCount` 只增不回收 | `lib/chat-lazy-load.ts:1`、`components/ChatWindow.tsx:307`、`components/ChatWindow.tsx:395` | 建立消息组索引后只为窗口范围构造 JSX；双向虚拟窗口（屏幕上下都回收 DOM）；动态高度缓存；每页加载不叠加全量 DOM |
| L-2 | P1 | ChatMinimap 遍历全部消息并读节点位置；悬停时为全部节点算 tooltip、10 轮碰撞处理、渲染全部节点、每鼠标帧找最近节点，几千条后成为滚动/悬停掉帧源 | `components/ChatMinimap.tsx:105`、`components/ChatMinimap.tsx:283`、`components/ChatMinimap.tsx:319` | Minimap 按像素高度聚合/抽样，最多渲染约 100–200 节点；tooltip 只渲染最近节点 |

### 1.3 后端完成度（明确未完成项，非缺陷但阻断 5.0 判定）

| ID | 现状 | 证据位置 |
|---|---|---|
| B-1 | Rust Host 只有 `version/health` 健康检查骨架；OMP Supervisor、PTY、File、Git、journal 接线均未做 | `crates/ompweb-host/src/main.rs:1` |
| B-2 | 生产主链路仍是 `Electron → Node/Next → OMP child process`，不是 `Tauri → Rust Host → OMP` | `desktop/main.js:134` |
| B-3 | `ompweb-storage`（SQLite journal/WAL/snapshot/resume/reopen）已实现并有测试，但未接生产 Host/UI，主要由独立测试消费 | crates 目录 |
| B-4 | Remote v1 只有 `MessageTransport` 抽象 + 内存双工 pipe；真实 WebSocket 端点、二进制数据、加密传输、relay 安全协议未启动 | `docs/refactor/ompweb-5.0/PROGRESS.md:22` |
| B-5 | W5（Relay/Tauri/Mobile）、W6（默认切换）明确未启动 | `docs/refactor/ompweb-5.0/PROGRESS.md:43` |

### 1.4 测试、安全与发布状态

**正向基线（本轮评审重新验证通过）：**

- `npm test`：543 通过 / 0 失败 / 2 跳过
- TypeScript：通过；ESLint：0 error / 61 warning
- Rust：协议 conformance 1 个 + SQLite 2 个通过；**Rust Host 自身 0 个单元测试**
- 官方 npm registry 生产依赖审计：0 个已知漏洞
- Motion manifest：通过（32 keyframes、30 组件动效面同步）
- `git diff --check`：通过

**发布阻断项：**

| ID | 项 | 现状 |
|---|---|---|
| R-1 | 版本与可追溯性 | `package.json` 仍为 `4.0.12`；Rust crates 与大量 5.0 文件未提交；工作区不是可追溯的同 SHA 发布候选 |
| R-2 | 发布矩阵 | 未重新执行当前工作树的签名、安装、升级、回滚矩阵 |
| R-3 | 浏览器侧性能证据 | INP、React commit、DOM、heap、FPS、真实冷启动分段仍未测量；项目基线明确承认（`baseline/perf-baseline.md:20`） |
| R-4 | 安全残留 | 仍保留 4 个 env→tunnel/SSRF 中危链路（`baseline/security-triage-w05.md:25`），移交 Remote 波次治理 |
| R-5 | 常驻进程证据口径 | 常驻 30177 进程不一定对应当前未提交工作树，其测量只能作运行环境参考，不是当前候选版本的同 SHA 发布证据 |

## 2. 收敛路线（三轮，先收敛再扩面）

> 评审建议：不要马上扩展新功能，先做三轮收敛。每轮以实测证据过门，未过门不进入下一轮。

### Iteration 1 — 启动与性能证据（最高收益）

**目标：** 消除启动竞态与闪屏，建立可测量、可门禁的启动链路。

| # | 任务 | 完成标准 |
|---|---|---|
| T1.1 | 修复 `server-ready` 丢信号竞态 | 主进程保存就绪状态；splash 主动查询 + 事件监听 + `did-finish-load` 补发；暖启动不再出现「服务已好但等 8 秒」 |
| T1.2 | 取消 8 秒绕过健康检查的强制跳转 | 8 秒只切「视频 → 持续加载层」；导航仍以就绪状态为门 |
| T1.3 | 建立明确启动状态机 | `spawning → listening → assets_warmed → shell_mounted → session_interactive → failed`，每态有埋点与超时 |
| T1.4 | 失败路径 UX | 20–30 秒超时显示错误页：错误说明 + 日志位置 + 重试 + 退出按钮；`did-fail-load` 重试上限后不再裸奔 |
| T1.5 | 深色主题 skeleton 闪白修复 | skeleton 使用主题变量或预加载脚本同步背景；splash 与 Web skeleton 同一视觉终态 |
| T1.6 | 两级遮罩撤除 | AppShell 用 `shell-mounted`、`session-ready` 两级状态，不再 mount 即撤 |
| T1.7 | 健康检查收紧 | `response.ok` + `/api/health` 标记 + App/Host 版本 + 依赖初始化完成 |
| T1.8 | 启动分段埋点 + Electron 集成测试 | 每态时间戳入日志/上报；集成测试覆盖竞态（快速就绪）、慢启动、失败路径 |
| T1.9 | 真机冷/暖启动测量 | p50/p95/p99 报告；窗口出现 p95 < 400ms；splash fade 后到首个正确 App 帧间隔 p95 < 100ms；视频期间允许后台继续预热 |

**Iteration 1 退出门：** T1.1–T1.9 全部完成，冷/暖启动指标达标，深色主题全程无白屏，失败路径有可操作错误页。

### Iteration 2 — 长对话真正有界

**目标：** 保持现有 UI 风格、尺寸、动画与交互不变，只替换渲染机制；超长会话（Chat-XL 6000 条）内存与交互有界。

| # | 任务 | 完成标准 |
|---|---|---|
| T2.1 | 索引先行、窗口内构建 | 先建立消息组索引，再只为窗口范围构造 JSX，禁止全历史 JSX 构建后 slice |
| T2.2 | 双向虚拟窗口 + 动态高度缓存 | 屏幕上下都回收 DOM；高度缓存使滚动不重排全量；`visibleCount` 不再只增不减 |
| T2.3 | Minimap 聚合/抽样 | 最多渲染约 100–200 节点；tooltip 只渲染最近节点，不做全量碰撞处理 |
| T2.4 | 大文件解析优化（次优先） | Worker 或服务端分页，避免主线程全量解析 |
| T2.5 | 实测证据 | React Profiler、INP、long task、heap、滚动掉帧；流式 token、自动滚动、用户向上阅读分别测试 |

**Iteration 2 验收门（评审建议）：**

| 指标 | 目标 |
|---|---|
| Chat-XL 6000 条时挂载消息节点 | ≤ 200–300 |
| 输入到下一帧 p95 | ≤ 50ms |
| 普通点击 p95 | ≤ 100ms |
| 流式输出期间 React commit p95 | ≤ 16ms |
| 连续滚动长任务 | ≤ 50ms |
| 流式运行 10 分钟后 heap | 进入平台期，不随 token 持续线性增长 |

### Iteration 3 — 后端生产接管（feature flag 分步）

**目标：** 按 feature flag 逐步把生产主链路切到 Rust Host，任何一步可回滚 Node。

| 步 | 内容 | 退出条件 |
|---|---|---|
| 3.1 | Electron 管理 Rust Host 生命周期与诊断 | 进程树/退出码/日志/健康上报完整；Node 一键回滚开关保留 |
| 3.2 | Rust Host 接入 SQLite continuity journal | conformance 脚本在 SQLite 持久化实现通过（已有基础，接生产接线） |
| 3.3 | 接入 OMP Supervisor | 与 Node 路径状态等价测试通过 |
| 3.4 | 迁移 PTY、File、Git | 逐能力等价测试 + 回滚演练 |
| 3.5 | 落地真实本地 WebSocket endpoint | 真实传输端点替代内存 pipe；协议 conformance 全过 |
| 3.6 | 设备身份、安全传输、权限 capability、真实 Relay | 成熟协议 + 审查实现；威胁模型评审通过（关联 ADR-004/005） |
| 3.7 | 同路径 Node 回滚开关 | 每步 flag 可切；升级/降级矩阵通过 |
| 3.8 | Tauri 默认切换 | 前置：Rust Host 稳定 + 性能门全过 + 10 静态 build 决策落地；未过门前不启动 |

关联切片：`03-remote-protocol.md`、`04-connectivity-and-open-source-references.md`、`05-security-and-device-identity.md`、`06-rust-runtime-and-projections.md`、`09-desktop-tauri-migration.md`。

## 3. 发布门（最终候选要求，全部满足才允许按 5.0 发布）

- [ ] 干净、提交完整的工作树；同 SHA 构建 + 测试（npm test / tsc / lint / cargo / 密封扫描）
- [ ] 版本一致：`package.json`、Rust crates、安装产物、升级路径统一
- [ ] 签名、安装、升级、回滚矩阵在当前工作树重新执行并通过
- [ ] 浏览器侧性能基线全项落地（INP、React commit、DOM、heap、FPS、真实冷启动分段）
- [ ] 长对话验收门（Iteration 2 指标）全部达标
- [ ] 安全分诊收敛：4 个中危 env→tunnel/SSRF 链处置完毕或明确接受并记录
- [ ] Rust Host 达到生产接管状态（非原型）；Remote/Relay 有真实安全传输端点
- [ ] 发布物为同 SHA 可追溯候选

## 4. 执行纪律与停止条件

- 每轮以实测证据过门才进入下一轮；「口头假设」不算完成（用户既定偏好：真实实跑验证）。
- 遵守 README 全局不可退让约束：OMP 唯一权威、不做 Big Bang、UI 视觉/动画不动、性能是发布门、Remote 是协议收敛、不自创密码协议、未知能力安全失败。
- 复用 README 波次停止条件：出现视觉/动画回归未解释、关键交互或长对话性能退化超预算、OMP 权威状态无法收敛、Remote mutation 可能重复、安全依赖自创实现、兼容路径无法回滚，即停止扩面。
- 未过 Iteration 1/2/3 门之前，不启动多 Region Relay、完整 Mobile UI、Tauri 默认切换、自研 NAT traversal 或大规模仓库重排。

## 5. 与现有波次/切片映射

| 迭代 | 对应工作包 | 现状（如实） |
|---|---|---|
| Iteration 1 | 启动/开屏（12 发布门中的启动段） | S-1/S-2 核心修复已先行落地于工作树（未提交、未过门）；T1.3–T1.9（状态机、失败页 UX、健康检查收紧、埋点、实测）未开始 |
| Iteration 2 | 10 Web + UI Fidelity 长对话性能（10 Slice 3+） | 部分基础已有（React.memo、streaming coalescer、DOM 分页）；真虚拟化与实测未开始 |
| Iteration 3 | 03/04/05/06/09 后端与 Remote/Tauri | W1–W4 核心完成、W3 slice 1–2 完成；W5/W6 未启动；SQLite 与 relay simulator 已落地未接生产 |

## 6. 证据与交付物矩阵

| 迭代 | 交付物 | 存放位置（建议） |
|---|---|---|
| 1 | 启动埋点 JSON、Electron 集成测试、冷/暖启动 p50/p95/p99 报告 | `baseline/` 下新增 `startup-baseline.*` |
| 2 | React Profiler / INP / long task / heap / 滚动掉帧报告；挂载节点数证据 | `baseline/perf-baseline.*` 更新 + Chat-XL 截图/回放 |
| 3 | Rust Host 生命周期诊断、等价测试、回滚演练记录 | crates 测试 + `PROGRESS.md` 波次日志 |
| 发布 | 同 SHA 候选清单、发布矩阵结果、版本一致性核对 | 发布 checklists + `PROGRESS.md` |

## 7. 当前对外口径（模板）

> 现阶段的准确表述：**W0–W4 的契约、协议、测试和部分优化基础已经完成；5.0 生产后端、真实 Remote、Tauri、移动端和完整性能门尚未完成。当前属于质量较好的中期候选，不是 5.0 完成版；作为 4.0.12 增强版可继续内部使用。**

对外/发布措辞一律使用此口径，不得宣称「ompweb 5.0 已全部完成」。

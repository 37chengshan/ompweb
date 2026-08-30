# 13 — 实施 Agent 目标与首批交接

## 总目标

以 [`README.md`](./README.md) 为唯一入口，按依赖波次实施 ompweb 5.0。必须遵守：OMP authority、Strangler migration、UI/动画完全保真、性能门、Remote 安全门、单写/可回滚。不得直接照抄原始 v3 的 26 PR 序列。

## 首次启动时的工作范围

先执行 **W0/M0 + 01 的 Slice 1**，完成后再根据门禁进入后续波次。本轮不要开始 WebSocket、Rust、Tauri、Mobile 或 Relay 实现。

### 必做

1. 阅读仓库 `AGENTS.md`、本目录 `README.md`、`00`、`01`、`10`、`12`。
2. 建立 ADR 目录和 ADR-001/002/003/004/005/007 草案；对尚需技术 spike 的内容标记决策门，不自作主张宣称已定。
3. 清点并机器可读地记录现有直接 `/api` fetch 与 EventSource 调用，按领域、读写、stream 分类。
4. 为新增调用建立 lint/测试防回退：新 UI 代码不能绕过 client adapter；现有调用用逐步收敛 allowlist 管理。
5. 建立 UI 黄金 fixture 和截图矩阵；生成 motion manifest，覆盖 CSS keyframes、inline transition、Web Animations、SMIL、splash 与 reduced-motion。
6. 建立 4.x 性能 harness 和首份基线：冷/暖启动、Chat-S/L/XL、Sessions-L、Stream、PTY、长任务、input-to-paint、DOM/heap。
7. 将 Quick Tunnel 的文档/UI语义明确为开发/临时分享；非 loopback 诊断说明 VPN/HTTPS 要求。不得在同一 PR 重做 Remote UI。
8. 扩展 `lib/agent-client.ts` 前先冻结现有 Agent/Session API/error/SSE contract fixture；本轮只允许建立边界和测试，不改变用户行为。

### 禁止

- 修改现有视觉风格、design tokens、组件布局或动画节奏；
- 删除动画换性能，或用空白首屏/延迟关键控件伪造启动快；
- 同时写旧/新 mutation 路径；
- 新建完整 13-crate Rust workspace；
- 引入自定义 binary protocol、E2EE handshake、自研 NAT traversal；
- 把旧 pairing Cookie 静默升级为 cryptographic device identity；
- 大规模移动目录、改包管理器或更换 UI 框架；
- 运行 `next build` 作为日常验证（仓库规则明确禁止开发期运行）。

## 首批验收

- 基线报告可在固定 fixture/硬件重复运行，含 p50/p95；
- UI screenshot 与 motion manifest 能检测删除/节奏/终态/reduced-motion 回归；
- 直接 API 调用清单完整，新调用防回退生效；
- ADR 草案清楚区分已决定、待 spike、外部依赖；
- Quick Tunnel/非 loopback 安全语义准确；
- typecheck、lint、相关测试通过；
- `git diff` 不含 `.mimosa/` 或用户无关改动；
- 提交前给出下一波次 Go/No-Go 证据，不因“脚手架已建”自动进入 W1。

## 可直接写入任务系统的目标文本

```text
在 /Users/cc/code/ompweb 按 docs/refactor/ompweb-5.0/README.md 实施 ompweb 5.0。先只完成 docs/refactor/ompweb-5.0/13-execution-handoff.md 规定的 W0/M0 + 01 Slice 1：ADR 草案、API/EventSource 调用清单与防回退、UI/动画黄金基线、4.x 冷启动/长对话/交互/PTY/会话侧栏性能基线、Quick Tunnel/非 loopback 安全语义止血、Agent/Session contract fixtures。严禁修改现有 UI 风格、布局、设计令牌和动画节奏；不得开始 WS、Rust、Tauri、Mobile、Relay，不得 dual write，不得触碰 .mimosa/。遵守 AGENTS.md，使用现有测试方式，开发期不要运行 next build。完成首批验收后基于证据报告 Go/No-Go，再进入下一波次。
```

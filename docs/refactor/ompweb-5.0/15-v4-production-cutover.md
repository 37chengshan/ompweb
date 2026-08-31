# ompweb 5.0 生产切换落地计划（v4 主计划 × 当前工作树）

| 项 | 值 |
|---|---|
| 状态 | 落地基线（对照完成，执行未开始） |
| 日期 | 2026-08-31 |
| 上游 | `/Users/cc/Downloads/ompweb_5.0_master_upgrade_plan_v4_production_cutover.md`（v4.0，6775 行） |
| 定位 | v4 是本目录 5.0 实施基线的**最终总体架构与生产切换权威文档**；本文件把 v4 的 R0–R23 路线逐条对照当前工作树，产出可执行的落地计划 |
| 关联 | `06-rust-runtime-and-projections.md`、`09-desktop-tauri-migration.md`、`14-gpt-review-action-plan.md`、`README.md`、`PROGRESS.md`、ADR-002/004/005/006 |
| 适用 | Rust Production Cutover、Ownership Matrix、三种 Host 形态、Remote/Relay、Tauri、No Hidden Fallback |

> **执行门禁（2026-08-31 修正）**：任何 Domain 的 Cutover 必须在内部走完「实现 → shadow 等价 → Go/No-Go 检查 → canary 切流 → Rust primary → 观察期 → 删除 Node authority」七个子步后才能标记该域完成；Go/No-Go 是阶段内检查点，不是计划终点。仅「实现 + shadow 验证通过」不得宣告该域完成（对应 v4 P9 Cutover State Machine）。
>
> v4 相对 v3 的关键修订：把 **Rust Production Backend Cutover 提升为 5.0 硬性完成条件**；明确「存在 Rust crate ≠ Rust 已接入生产」；规定 Node/Next/Electron 的退出条件与允许保留的兼容职责；每个 Domain 必须走五阶段 Cutover State Machine，不能「写完 Rust 就算迁移」。
>
> 与 `14-gpt-review-action-plan.md` 的关系：评审收敛计划（Iteration 1/2/3 + 发布门）继续有效，作为执行纪律与发布门；v4 的 R 路线是其 Iteration 3（后端生产接管）的完整化版本。**执行顺序约束不变：Iteration 1/2 未过门前不启动 W5/W6（R17+ 的 Relay/Tauri/Mobile 与 W5/W6 同域）。**

## 0. 落地结论：现状 vs v4 硬性完成定义

v4 规定 5.0.0 stable 必须六条全部成立，当前工作树前五条全部未达成，第六条因尚无 Rust 生产路径为 N/A（R8 起生效）：

| # | 硬性定义 | 当前状态 |
|---|---|---|
| 1 | OMP Ownership：只有 Rust Agent Supervisor 可启动/停止/重连/监管 OMP | ❌ `lib/rpc-manager.ts` + `lib/omp/rpc-process.ts`（Node）持有全部 OMP 生命周期 |
| 2 | State Ownership：Session/Agent/Journal/Device/Remote 权威状态在 Rust | ❌ 权威状态全在 Node 内存 + OMP `.jsonl` |
| 3 | Mutation Ownership：Prompt/Cancel/Approval/Settings/Commands/PTY/File/Git 修改全经 Rust | ❌ 全部经 Node route |
| 4 | Remote Ownership：手机正式远控直连 Rust Remote Runtime | ❌ Remote v1 只有 TS 协议层 + 内存 pipe，无真实端点 |
| 5 | Desktop Node Independence：Node 不存在时 Desktop 完整工作 | ❌ Desktop 启动 `.next/standalone/server.js`，依赖 Node |
| 6 | No Hidden Fallback：Rust 失败不能静默切回 Node | — 尚无 Rust 生产路径可回退（N/A）；R8 起强制，禁止静默降级 |

**一句话判定**：当前工作树 = v4 定义的「仓库里已经有 Rust」（Rust 0% 生产 Authority）；v4 的「立即开始的五件事」中有 4 件已在本仓库完成（见 §3），剩余 1 件（真实 Remote WS）部分完成。

## 1. Production Ownership Matrix（对照当前代码）

v4 P2 矩阵落到本仓库文件，逐域标注现状与差距：

| Domain | 4.x Authority（当前文件） | 已有 5.0 基础 | 差距（R 步骤） |
|---|---|---|---|
| OMP Process | `lib/rpc-manager.ts`（global registry、并发 start lock、idle disposal）、`lib/omp/rpc-process.ts`（spawn + NDJSON） | rpc-frame/rpc-utility/rpc-process-runtime 测试；W1 facade 已抽象会话边界 | Rust AgentSupervisor（R8） |
| OMP RPC | 同上（v2 framing、1MiB/64MiB 限制） | `lib/omp/rpc-frame.ts` + 测试 | Rust OMP Adapter（R8） |
| Agent State | `hooks/useAgentSession.ts` + RPC get_state | `lib/contracts/agent-envelope.ts` + agent-contract 测试 | Rust Runtime State（R8/R9） |
| Session Projection | `lib/session-reader.ts`（1003 会话冷列表 p50 14.8ms）、`lib/omp/session-files.ts` | Chat-S/L/XL fixture + 性能基线；`crates/ompweb-protocol`（oracle 移植，conformance 1/1） | Rust Session Engine + shadow（R7）→ authority（R10） |
| Event Bus | SSE routes + `lib/session-change-bus.ts` | W1 `subscribeSessionsChanged` 接口化（HTTP adapter 委托本地 bus） | Rust Event Bus（R9） |
| Event Journal | `lib/continuity/journal.ts`（MemoryJournal：reliable/coalesced/ephemeral、snapshot compaction、bounded live-tail） | `crates/ompweb-storage` SQLite WAL/checkpoint/reopen（conformance 2/2）；共享 conformance 脚本 8 场景双语言通过 | 接生产 shadow（R6）→ authority（R9） |
| Snapshot/Replay | `lib/remote-protocol/host-connection.ts` RESUME 分支（REPLAY/SNAPSHOT_THEN_REPLAY/NO_CHANGE/…） | 握手状态机 7/7 测试 | Rust 侧（R9/R16） |
| Command Idempotency | `lib/continuity/mutations.ts`（MutationLedger：accept/duplicate/conflict/unknown/tombstone）、host-connection receipt | 测试覆盖 | Rust 侧（R9/R16） |
| PTY | `lib/terminal-shell.ts` + `app/api/terminal/*`（node-pty） | — | Rust PTY Manager（R11） |
| File Service | `app/api/files/*` + `lib/file-access.ts`（allowlist 安全边界） | 允许根规则 + W0.5 upload sink 修复 | Rust File Service（R12） |
| Git / Worktree | `app/api/git/{diff,status}`、`app/api/worktrees`、`lib/worktree.ts`、`lib/git-*.ts` | W0.5 字面量 argv（无 shell 拼接） | Rust Git Service（R12） |
| Settings Registry | `lib/omp/settings-service.ts`（07 Slice 1–3：probe→CLI→legacy→unsupported）、`app/api/omp-settings`、`lib/omp/models-config.ts` | CLI adapter argv-array、credential redaction、fixture + 8 测试 | Rust Settings Registry（R13） |
| Settings Mutation | `app/api/omp-settings`（写 config.yml，原子写） | settings-service reset 语义 | Rust write（R13） |
| Slash Registry | `hooks/useAgentSession.ts` `toSlashCommandInfo`（08 Slice 1：完整 OMP registry、ompBuiltin 分组）、`lib/web-slash-commands.ts` | `lib/command-registry.test.mjs` 3 测试冻结 | Rust Command Registry（R14） |
| Command Execution | `app/api/scripts/run`、`app/api/agents`、`lib/contracts/ui-request.ts`（HostUIRequest：单次 settle/超时/终态） | ui-request 7 测试 + `command-execution-matrix.md` | Rust Command Executor（R14） |
| Pairing | `app/api/pair/*`（token/accept/config/tunnel/heartbeat/devices）+ `lib/remote-pairing.ts` | W0-7 Quick Tunnel 止血文案与降级 | Rust Device Enrollment（R15） |
| Device Registry | `app/api/pair/devices/*`（JSON state） | — | Rust Runtime DB（R15） |
| Remote Auth | middleware/cookie | — | Rust Security Runtime（R15） |
| Remote Transport | SSE + `lib/remote-protocol/*`（codec/scheduler/host-connection，内存双工 pipe） | 7/7 测试（codec 黄金向量、握手三态、resume 回放、receipt、流控预算） | 真实 WS 端点（`ws` 依赖决策门）→ Rust WS Runtime（R16） |
| Relay Client | `lib/relay/simulator.ts`（in-process blind relay：opaque 帧、配额、shedding、确定性丢包） | 6/6 测试 | 真实 relay + 加密帧格式（ADR-005 冻结后）（R17） |
| Diagnostics | `app/api/diagnostics` | — | Rust Telemetry + Backend Ownership dashboard（P40） |
| Desktop Shell | Electron（`desktop/main.js`、`desktop/preload.js`、`desktop/splash.html`） | S-1/S-2 修复（server-ready 闩存、8 秒不绕过就绪）、OMP bin 解析、splash 测试 | Tauri 2 薄壳（R18/R19） |
| Desktop UI | React | 不变（约束 #3：视觉/动画不动） | 不变 |
| Web UI | Next/React | W1 facade | Option A/B 决策（P30；5.x 再议，不阻塞 Cutover） |
| Compatibility HTTP | Next `app/api/*` | facade 的 HttpSseAdapter | Thin Adapter（R22 后保留） |

**共性差距**：所有 Domain 的 Rust 侧都缺「真实生产接线 + Cutover State Machine 五阶段」（shadow → canary → cutover → legacy adapter → delete）。TS 侧协议/契约基础（W1–W4）已齐，Rust 侧只有 oracle/SQLite 原型。

## 2. 三种正式运行模式 → 现有产物映射

| v4 模式 | 目标形态 | 当前对应 | 落地入口 |
|---|---|---|---|
| P3.1 Desktop Native Host | Tauri WebView + Tauri Rust Process（link `ompweb-core`），不启动 `.next/standalone`、不依赖 Node | Electron + Node standalone server + OMP child | R18/R19（前置：06 Host 可用、10 静态构建、01 LocalHostAdapter、12 基线冻结、Electron 可回滚） |
| P3.2 Headless Host | `ompweb-host` binary：core + Remote WS + Local IPC + optional static UI | `crates/ompweb-host`（仅 `--version`/`--health` 骨架，main.rs 自述） | R5→R8 逐步填 Supervisor/services/listeners；与 Tauri 共用同一 `ompweb-core`（禁止两套 Runtime） |
| P3.3 Legacy Web Compatibility Host | 迁移期 Next 只做适配与兼容 HTTP | 当前 Next `app/api/*`（生产主链路） | 迁移期形态；R22 后降级为 Thin Adapter，无 Domain Authority |

## 3. v4 实施路线 R0–R23 × 当前工作树

> 状态图例：✅ 已完成（当前树）｜◐ 部分完成 ｜⬜ 未开始。Exit Gate 为 v4 原文，执行时逐条实测过门（用户既定偏好：真实实跑验证）。

| 步骤 | 内容 | 状态 | 当前代码锚点 / 落地说明 | Exit Gate |
|---|---|---|---|---|
| R0 | Architecture Freeze | ✅ | 本目录 00–14 + ADR-001..007 已冻结契约/协议/安全边界；**缺** `backend-ownership.yaml`（见 PR-C02，即 R0 收尾项） | Ownership Matrix review；Node 允许/禁止职责写清 |
| R1 | Client SDK Facade | ✅（核心） | `lib/client/`（OmpwebClient + HttpSseAdapter + FixtureAdapter）；ESLint 防回退门（`eslint.config.mjs` 禁止业务组件直接 fetch/EventSource）；直接 fetch/EventSource = 0 | 业务组件直接 fetch/EventSource = 0（已达成） |
| R2 | Protocol / Domain Types | ◐ | 错误码/SSE/envelope fixtures、`lib/contracts/ui-request.ts`、`lib/remote-protocol/protocol.ts`（unknown 字段保留）；Rust↔TS 兼容经共享 conformance 脚本验证；**缺**完整 Domain DTO 统一生成（Session/Agent/Device/Capability） | contract tests + unknown field forward-compat tests |
| R3 | Node Remote Stabilization / WS PoC | ✅ | 协议层完成（握手/RESUME/receipt/流控 7/7 测试），传输仍是内存 pipe；`ws` 依赖 = 决策门 | Mobile/Web test client 双向连接；SSE 不再是新 Remote v1 基础 |
| R4 | Event Continuity PoC | ✅ | `lib/continuity/*` + conformance 8 场景 TS/Rust 双通过；SQLite 持久化通过 | 断网 Agent 继续运行 → 重连 → state converges（conformance 已证，生产接线未做） |
| R5 | Rust Workspace / Core Skeleton | ✅ | `crates/`（零外部依赖离线构建：`ompweb-protocol` 397 行 oracle、`ompweb-storage` 347 行 SQLite、`ompweb-host` 骨架）；**缺** Backend Ownership diagnostics（P40 dashboard） | crate 边界冻结；schema pipeline 工作 |
| R6 | Rust Event Journal Shadow | ✅ | `ompweb-storage` 已具备全部能力，只被测试消费；接生产 shadow = 首个 Rust 生产进程 | shadow parity、无界增长检查 |
| R7 | Rust Session Projection Shadow | ✅ | 以 `session-reader.ts` 为参照实现 Rust 扫描，双读对比（复用 Chat-S/L/XL fixture 与 perf 口径） | semantic mismatch 阈值；1k/10k benchmark |
| R8 | Rust OMP Supervisor Cutover | ◐ R8.1 实现 ✅ / R8.2 shadow 等价 ✅ / **R8.3 Go-No-Go → R8.4 canary → R8.5 Rust primary → R8.6 观察 → R8.7 删 Node authority：未完成**（R8 完成 = 全部子步过门） | **第一次 Authority 切换**；前置：ADR-002 Host 生命周期冻结、离线依赖策略决策、feature flag `backend.agent=rust`；参照 `lib/rpc-manager.ts`/`lib/omp/rpc-process.ts` 行为等价清单（06 文档「OMP Supervisor」节） | Node 不 spawn OMP；crash recovery 经 Rust；CI ownership scan pass |
| R9 | Rust Event Authority Cutover | ◐ 能力 ✅（journal 接入 IPC；EventBus=attach 订阅）；**切流（EventBus 权威、legacy SSE 变 adapter）未完成** | Journal/EventBus 接管；legacy SSE 变 adapter；`backend.event=rust` | Node 无 authoritative RpcSession events；resume 经 Rust journal |
| R10 | Rust Session Authority Cutover | ◐ 能力 ✅（scan/rename/delete 经 IPC）；**切流（生产 read/mutation 经 Rust、删 Node scanner）未完成** | 所有 session read/mutation 经 Rust；删除生产路径 Node scanner | projection rebuild、branch/archive/delete parity |
| R11 | Rust PTY Cutover | ⬜ | 替代 `lib/terminal-shell.ts`（node-pty）；`backend.pty=rust` | 无 production node-pty；三平台 PTY E2E |
| R12 | Rust Files / Git Cutover | ⬜ | 收敛 `app/api/files/*`、`app/api/git/*`、`lib/worktree.ts` 安全边界；`backend.files/git=rust` | 直接 Node file/git mutation = 0；workspace 安全测试 |
| R13 | Rust Native Settings Cutover | ⬜ | 以 `lib/omp/settings-service.ts` 为行为参照；`backend.settings=rust` | Registry/write/reset Rust authority；parity CI |
| R14 | Rust Native Commands Cutover | ⬜ | 以 `toSlashCommandInfo` + `command-execution-matrix.md` 为参照；`backend.commands=rust` | Registry Rust authority；dynamic updates；执行策略集中 |
| R15 | Device Identity / Security Cutover | ⬜ | 替换 `app/api/pair/*` cookie 权威；ADR-005 冻结后选成熟握手（Noise 评审）；`backend.remote=rust` 依赖此步 | legacy cookie 非权威；security suite pass |
| R16 | Rust Remote Runtime Cutover | ⬜ | 真实 WS 端点（R3 决策门的产出）+ Rust core 承载；`backend.remote=rust` | Prompt/stream/approval/resume 不经过 Next；网络切换/多设备测试 |
| R17 | Relay MVP | ⬜ | 行为层 simulator 已落地；真实 relay 差加密帧格式与部署形态（ADR-005） | relay 不可解密 payload；Relay-only E2E |
| R18 | Tauri Preview | ⬜ | Tauri link `ompweb-core`；Client SDK `TauriCoreAdapter`；前置：静态构建 CI 决策（仓库规则禁开发期 `next build`） | 不依赖 Next API 跑通核心功能；Electron 仅对比构建 |
| R19 | Tauri Production Cutover | ⬜ | P23 十步顺序（shell→link core→adapter→core 承载→PTY/File/Git→Remote→updater/tray/deep-link→Electron fallback→默认 Tauri→删除 Electron packaging） | 默认包 Tauri；Node-independent 测试；进程树 gate |
| R20 | Mobile MVP | ⬜ | ADR-006 决策门：W2 指标稳定后三方 spike；直连 Rust Remote Runtime | Wi-Fi/5G 切换；前后台收敛 |
| R21 | Push Notification | ⬜ | 仅通知，无状态权威；不阻塞其他路线 | 丢 push 不破坏状态正确性 |
| R22 | Legacy Backend Retirement | ⬜ | 删除 Node OMP spawn / RpcSession / PTY / Session mutation / Device authority / Next Remote SSE 生产路径；保留 compatibility adapters | production Node domain requests = 0 |
| R23 | Stable Release Gate | ⬜ | 全部 gate 通过（§7 清单）+ 14 号评审计划发布门 | 版本标记 5.0.0 stable |

## 4. Cutover 顺序与依赖

v4 Critical Path（139 节）：`Domain Contract → Event Journal/Resume → Client SDK → Rust Core → Remote Security → Relay → Tauri/Mobile`

本仓库映射与当前站位：

```text
Domain Contract (01)      ✅ 已完成
Event Journal (02/W1-2)   ✅ 已完成（TS oracle + Rust oracle + SQLite）
Client SDK (W1)           ✅ 已完成（lib/client/）
        ↓
Rust Core（R6 shadow → R8 首切）   ⬜ ← 当前站位
        ↓
Remote Security（R15，ADR-005 冻结）⬜
        ↓
Relay（R17）→ Tauri/Mobile（R18–R21）⬜（W5/W6 门禁未开）
```

- **R8（OMP Supervisor 首切）是全局关键路径节点**：OMP Ownership（硬性定义 #1）与 Mutation Ownership（#3）都挂在它后面。
- R6/R7（shadow）不改变生产响应，**不依赖评审 Iteration 1/2，可立即并行准备**。
- R8 正式执行前必须过：ADR-002 生命周期冻结 + 离线依赖策略 + Iteration 1/2 门（评审计划 §4：未过门前不启动 W5/W6；R8–R16 属 W3/W4 范畴，R17+ 属 W5/W6）。
- v4 P38 要求每模块独立 feature flag（`backend.agent=rust` 等），Beta 期可单模块切，Stable 全部 rust 并移除用户可见开关——与 README「不做 Big Bang、可回滚」约束一致。

## 5. 里程碑（v4 附录 H × 当前版本 4.0.15）

| 里程碑 | v4 内容 | 本仓库前置/现状 |
|---|---|---|
| 5.0-alpha.1 | Client SDK facade、WebSocket transport、basic reconnect | SDK facade ✅ 已有；WS transport ◐（决策门） |
| 5.0-alpha.2 | Event Journal、Resume、Idempotency | ✅ 原型已全（TS+Rust+SQLite，未接生产）；alpha.2 实际是「接生产 shadow」 |
| 5.0-alpha.3 | Rust Event/Session Core、settings registry preview | ⬜ R6/R7/R13 起步 |
| 5.0-beta.1 | Rust Agent Supervisor、PTY、Native Settings parity、Command registry | ⬜ R8/R11/R13/R14 |
| 5.0-beta.2 | Device Identity、E2EE、Relay MVP | ⬜ R15/R17（ADR-005 前置） |
| 5.0-beta.3 | Tauri preview、mobile preview | ⬜ R18/R20 |
| 5.0-rc.1 | Tauri default、Mobile approvals/push、migration tools、chaos suite | ⬜ R19/R21 + MAN-01..06 |
| 5.0.0 | 全部 release gates + rollback documented + legacy deprecated | ⬜ R22/R23 + 14 号评审发布门 |

## 6. 落地决策（与现有约束/ADR 的收敛）

1. **Client SDK 不拆 `packages/client-sdk`**：v4 P4 的价值（插拔点 + UI 不重写）已由 `lib/client/` + ESLint 门实现；monorepo 拆分遵守既有决策（第一批切片 1：不立即搬 monorepo），留 5.x。
2. **文档位置不另起 `docs/architecture/`、`docs/protocol/`**：v4 R0 的产物映射到本目录既有体系（01–15 + adr/）；唯一新增是 `backend-ownership.yaml`（PR-C02）+ 本文件的 production-cutover 定位。
3. **`ws` 依赖 = 决策门**：R3/R16 前置；保持接口不变（MessageTransport），只换真实端点实现。
4. **离线依赖策略 = R8 前置**：`ompweb-storage` 已引入 rusqlite（bundled）；Supervisor/PTY/WS 的依赖引入需一次决策（06 文档既有门）。
5. **ADR-002（Host 生命周期）冻结 = R8/R18 前置**：关窗口不终止 Agent；Quit UI 与 Stop Host 分离。
6. **ADR-005（设备握手协议选型）冻结 = R15/R17 前置**：不自创密码协议；成熟协议 + 独立安全评审。
7. **静态构建 CI 决策 = R18 前置**：仓库规则禁止开发期 `next build`；Tauri 需要 `output: 'export'` 的独立构建流水线。
8. **No Hidden Fallback 从 R8 起强制执行**：feature flag 显式切换，禁止静默回退；回滚走显式 flag + RB1–RB4 策略（只读域可安全回，写域回滚防双写分叉）。
9. **Web 模式（P30）选型不阻塞 Cutover**：5.0 Desktop 优先 Option A 风格 Native Client；Web 去 Next 与否放 5.x。
10. **评审计划执行纪律继续适用**：每轮以实测证据过门；视觉/动画回归、性能退化、权威状态不收敛、Remote mutation 重复、自创安全实现、兼容路径不可回滚 → 停止扩面。

## 7. 提交批次与门禁

### 提交批次（v4 PR-C01..C17 映射，单人项目按批次提交）

| 批次 | 内容 | 对应 |
|---|---|---|
| C01 | Client SDK Boundary（✅ 已完成，补：facade 覆盖审计与文档） | R1 |
| C02 | Backend Ownership Manifest（`backend-ownership.yaml`：9 域当前全 node；CI 静态扫描） | R0 收尾 |
| C03 | Rust Core IPC Server（Local IPC：request/response/errors/streaming channel/same-user auth/协议版本） | ✅（`--ipc` + token 认证 + 实时流式 emit） |
| C04 | Rust OMP Supervisor | R8 |
| C05 | Rust Event Authority | R9 |
| C06 | Rust Session Authority | R10 |
| C07 | Rust PTY Authority（删 production node-pty） | R11 |
| C08 | Rust File/Git Authority | R12 |
| C09 | Rust Settings Authority | R13 |
| C10 | Rust Command Authority | R14 |
| C11 | Rust Device Identity | R15 |
| C12 | Rust Remote WS | R16 |
| C13 | Relay MVP | R17 |
| C14 | Tauri Embedded Core | R18 |
| C15 | Desktop Node-free（删 Next standalone 正式路径） | R19 |
| C16 | Mobile Remote MVP | R20 |
| C17 | Legacy Delete | R22 |

每个批次提交前过 Part IV 审查 Checklist（Ownership/State/Protocol/Security/Performance/Migration 六组问题——见 v4 原文，本目录以 `00-plan-audit.md` 与代码审查流程为准）。

### 门禁清单（v4 Part X + 附录 G + 14 号评审计划）

- [ ] Backend Ownership Gate：manifest 与 CI 静态扫描一致；Stable 时 9 域全 rust
- [ ] Cutover Metrics：`production_node_domain_request_count = 0`；每模块切换前后记录 request count/error rate/p50-p95/mismatch/fallback/crash/memory/CPU
- [ ] Node-independent Gate（MAN-01）：无 Node 环境跑通 launch/session/prompt/streaming/tool/cancel/approval/terminal/files/git/settings/commands/remote
- [ ] Runtime Process Tree Gate（P27）：目标进程树为 Tauri/headless → Rust Core → OMP
- [ ] Production Bundle Ownership Gate（P26）：CI 静态扫描产物不得含 Node 权威路径
- [ ] Crash Boundary（P28）：Rust Core crash 有恢复路径与诊断，不静默降级
- [ ] 手工验收 MAN-01..06：Node-free Desktop、真实手机漫游、Host 睡眠唤醒、OMP Crash、Rust Runtime Crash、Relay Compromise Simulation
- [ ] 14 号评审计划发布门：同 SHA 候选、版本一致、发布矩阵、浏览器侧性能基线、长对话验收门、安全分诊收敛、Rust Host 生产接管状态
- [ ] 回滚策略 RB1–RB4 演练：只读域重建、写域防双写分叉、runtime.db 分类（rebuildable / durable ompweb-owned / OMP-owned）

## 8. 第一批可执行切片（不依赖评审 Iteration 1/2 过门）

1. **C02 Backend Ownership Manifest**：9 域当前全 `node` 的 yaml + CI 静态扫描（低成本、立即生效，后续每迁一域改一行）。
2. **R6 Rust Event Journal Shadow**：`ompweb-storage` 从「测试消费」接入生产 shadow（不改变生产响应），对比事件顺序/崩溃恢复/replay。
3. **R7 Rust Session Projection Shadow**：Rust 独立扫描 session 目录，与 `session-reader.ts` 双读对比（复用 fixture 与 perf 口径）。
4. **R3 ws 依赖决策 + 真实 WS 端点**：落地 Node 侧真实传输端点（协议层已 7/7），为 R16 提供网络行为参照。
5. **P40 Backend Ownership Dashboard**：`/api/diagnostics` 展示 9 域 authority 状态（agent=node 等），开发/测试一眼看出迁移进度。
6. **R0 收尾**：`backend-ownership.yaml` 之外，把本文件登记进 `README.md` 索引（随本文件一并提交）。

以上切片全部是只读/影子/观测性质，不触碰 Authority；R8（OMP Supervisor 首切）仍是正式执行起点，需 ADR-002 + 离线依赖决策 + Iteration 1/2 门。

## 9. 对外口径（与 14 号计划一致）

> v4 计划已落地为本仓库实施基线：5.0 = Rust Core 生产接管（OMP 仍为 Agent/Session/Provider/Auth 唯一权威，Rust 做 Supervisor/Projection/Continuity/服务层）+ Tauri 薄壳 + Remote 控制面。当前工作树仍为「仓库里有 Rust」阶段（Rust 0% 生产 Authority），5.0 硬性完成六条全部未达成；按 v4 路线从 shadow 开始逐步 Cutover，任何一步可回滚 Node。

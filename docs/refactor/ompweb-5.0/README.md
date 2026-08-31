# ompweb 5.0 重构计划目录

- 状态：审计后实施基线
- 审计日期：2026-08-30
- 本地基线：ompweb `v4.0.12`，OMP `18.0.10`
- 原始材料：`/Users/cc/Downloads/ompweb_5.0_master_upgrade_plan_v3.md`
- 适用范围：Native Runtime、Remote Continuity、OMP Capability Parity、Desktop/Web/Mobile

## 实施状态

- **W0/M0 + 01 Slice 1：已完成（2026-08-30）。** 产物与验收对照见 [`baseline/README.md`](./baseline/README.md)；ADR 草案见 [`adr/README.md`](./adr/README.md)。
- 下一波次：W1（01 Slice 2 Client Facade + 02 Event/Resume oracle）——进入前须有 W0 的 Go/No-Go 证据。
- **外部评审（GPT）收敛计划：已落地（2026-08-31）。** 评审判定当前为「4.0.12 增强版 / 中期候选，非 5.0 完成版」；三轮收敛行动见 [`14-gpt-review-action-plan.md`](./14-gpt-review-action-plan.md)，正式执行未开始；S-1/S-2 核心修复已先行落地于工作树（未过门），其余待 Go/No-Go。
- **v4 生产切换主计划：已落地（2026-08-31）。** `ompweb_5.0_master_upgrade_plan_v4_production_cutover.md` 已对照当前工作树落为 [`15-v4-production-cutover.md`](./15-v4-production-cutover.md)——Rust Production Backend Cutover 为 5.0 硬性完成条件（当前仍为「仓库里有 Rust」，六条硬性定义未达成）；执行未开始，第一批只读/影子切片见 15 号文档 §8。

原始 v3 计划的产品方向可以保留，但不能直接按原来的 26 个 PR 执行。本目录把它改写成有依赖门禁、可回滚、可验证的实施计划。原始文档只作为待审材料；本目录才是后续实施基线。

## 全局不可退让约束

1. **OMP 仍是 Agent、Session、Provider、Auth 的唯一权威。** ompweb 只做 Supervisor、Projection、Continuity 和 Client Surface。
2. **不做 Big Bang Rewrite。** 每条新路径都必须能与 4.x 并存、影子验证、逐步切流和回滚。
3. **UI 视觉风格严禁借重构名义修改。** 现有 warm-paper / warm-ember 设计令牌、排版、间距、组件形态、主题、响应式布局保持不变。
4. **细节动画是功能基线。** `app/globals.css`、组件内联 transition、启动动画、主题扩散动画、消息进入、面板折叠、状态脉冲和 `prefers-reduced-motion` 语义都必须建立回归清单。
5. **性能是发布门，不是愿景。** 冷启动、长对话、流式输出、输入响应、侧栏、PTY、内存和安装体积必须先测 4.x，再对每个迁移切片做同机对比。
6. **Remote 是协议和状态收敛，不是暴露网页 URL。** Quick Tunnel 只允许开发/临时演示；生产远程必须有可信传输、设备认证、授权和恢复语义。
7. **不自创密码协议。** 身份、握手、密钥轮换和消息保护必须采用成熟协议与经过审查的实现；算法名称不是协议设计。
8. **未知能力默认安全失败。** 未知事件可忽略/保留，未知设置可只读展示，未知高风险命令绝不自动执行。

## 文档索引

| 文档 | 工作包 | 主要输出 | 启动前置 |
|---|---|---|---|
| [00-plan-audit.md](./00-plan-audit.md) | 计划审计与纠偏 | 结论、现状证据、接受/修改/拒绝项 | 无 |
| [01-contracts-and-client-boundary.md](./01-contracts-and-client-boundary.md) | Domain Contract + Client Boundary | 领域契约、统一客户端、兼容适配器 | 00 |
| [02-event-continuity.md](./02-event-continuity.md) | Event Continuity | Journal、Snapshot、Resume、幂等边界 | 01 |
| [03-remote-protocol.md](./03-remote-protocol.md) | Remote Protocol v1 | WS 协议、流控、恢复、版本协商 | 01、02 |
| [04-connectivity-and-open-source-references.md](./04-connectivity-and-open-source-references.md) | Connectivity + Relay | 开源参考矩阵、LAN/VPN/Relay、路径策略 | 03、05 |
| [05-security-and-device-identity.md](./05-security-and-device-identity.md) | Security | Threat Model、Enrollment、E2EE、Capability | 01、03 |
| [06-rust-runtime-and-projections.md](./06-rust-runtime-and-projections.md) | Rust Host Runtime | Host 进程、OMP Supervisor、Projection、PTY/FS/Git | 01、02 |
| [07-native-settings-parity.md](./07-native-settings-parity.md) | Native Settings | OMP CLI/RPC 适配、Schema UI、冲突与漂移门 | 01 |
| [08-native-command-parity.md](./08-native-command-parity.md) | Native Commands | Runtime Registry、执行能力、UI Request | 01、05 |
| [09-desktop-tauri-migration.md](./09-desktop-tauri-migration.md) | Desktop | Electron → Tauri 薄壳、静态前端、功能保真 | 06、10、12 |
| [10-web-client-and-ui-fidelity.md](./10-web-client-and-ui-fidelity.md) | Web + UI Fidelity | Web 解耦、视觉/动画基线、长对话性能 | 01、12 |
| [11-mobile-and-push.md](./11-mobile-and-push.md) | Mobile + Push | 客户端选型、离线快照、通知注意面 | 03、04、05 |
| [12-performance-quality-migration-release.md](./12-performance-quality-migration-release.md) | Quality + Delivery | 性能预算、测试矩阵、迁移波次、发布门 | 贯穿全部 |
| [13-execution-handoff.md](./13-execution-handoff.md) | 执行交接 | 给实施 Agent 的目标、首批范围与禁止事项 | 阅读全部计划 |
| [14-gpt-review-action-plan.md](./14-gpt-review-action-plan.md) | 评审收敛 | GPT 评审落地：启动/长对话/后端三轮行动 + 发布门 | 阅读全部计划 |
| [15-v4-production-cutover.md](./15-v4-production-cutover.md) | 生产切换 | v4 主计划落地：Ownership Matrix、R0–R23 路线对照、里程碑与门禁 | 阅读全部计划 |

## 依赖主线

```text
审计与 4.x 止血
        ↓
领域契约 / Client Facade ──────────────┐
        ↓                              │
Event Continuity                      │
        ↓                              │
Remote Protocol ─────→ Security ─────→ Connectivity / Relay
        │                              │
        ├──────────────→ Mobile / Push │
        │                              │
        └→ Rust Host Runtime ─→ Web 静态客户端 ─→ Tauri

Settings / Commands Parity 在统一客户端之后独立推进，
但最终都必须接入同一权限、事件与能力协商模型。
```

## 实施波次与停止条件

| 波次 | 内容 | 进入条件 | 退出条件 |
|---|---|---|---|
| W0 | 4.x 安全止血、契约、性能/视觉基线 | 当前 main 可验证 | Quick Tunnel 明确降级；基线报告和黄金样例入库 |
| W1 | Client Facade、Event/Resume 语义原型 | W0 通过 | 双路径结果等价；断网恢复 PoC 通过 |
| W2 | WS v1、设备安全协议 PoC | W1 通过 | 协议互操作、限流、恢复、威胁模型评审通过 |
| W3 | Rust Host、Projection、Supervisor | W1/W2 通过 | Node/Rust 等价测试；可一键回退 Node |
| W4 | Settings/Commands、Web 解耦、UI/长对话优化 | W1 通过 | 不改视觉；能力漂移门与长对话预算通过 |
| W5 | Relay、Tauri、Mobile Preview | W2-W4 通过 | 平台矩阵、恢复、安全、性能和 UI 保真通过 |
| W6 | 逐步默认启用、Legacy 收敛 | 观测数据满足门槛 | 回滚演练、迁移文档、稳定版门全部通过 |

任一波次只要出现下列情况就停止继续扩面：

- 视觉或动画回归未解释；
- 参考硬件上的关键交互或长对话性能退化超过预算；
- OMP 权威状态与 ompweb Projection 无法自动收敛；
- Remote mutation 可能重复执行且无法检测；
- 安全协议或密钥存储仍依赖自创、未审查实现；
- 兼容路径无法回滚。

## 第一批可执行切片

1. 把 88 处直接 `/api`/`EventSource` 调用按领域登记，不立即搬 monorepo。（W0 机器实测为 138 处/29 文件，含 helper 间接调用，见 `baseline/api-call-inventory.json`）
2. 扩展已有 `lib/agent-client.ts`，先建立 `lib/client/` facade 与 HTTP/SSE adapter。
3. 为当前主题、布局、组件状态、动画和长对话建立固定 fixture、截图与性能基线。
4. 以当前 OMP `get_available_commands`、`available_commands_update` 和 `omp config ... --json` 建 compatibility adapter。
5. 用测试夹具验证 `epoch + stream + seq`、snapshot、resume 和 mutation receipt；原型只作为协议 oracle，不成为第二套长期 runtime。

在上述切片完成并过门前，不启动多 Region Relay、完整 Mobile UI、Tauri 默认切换、自研 NAT traversal 或大规模仓库重排。

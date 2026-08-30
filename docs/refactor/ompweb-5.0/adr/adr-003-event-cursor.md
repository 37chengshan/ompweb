# ADR-003 — 事件 Cursor：`hostEpoch + streamId + seq` 与分层持久化

状态：草案（Cursor 模型与事件分级已决定，保留参数待测）· 日期：2026-08-30 · 关联：`02-event-continuity.md`

## 背景

per-session `seq` 无法表达 Host 重建与多 stream。现有 SSE（`useAgentSession` + reconcile poll）在断网/休眠后依赖快照兜底，缺少可解释的 resume 语义。

## 已决定

1. v1 cursor 为三元组 `{ hostEpoch, streamId, seq }`；`hostEpoch` 变化必须 full resync。
2. 事件分三级：`reliable`（状态边界/mutation receipt/approval）、`coalesced`（流式 delta、todo/diff、token 采样）、`ephemeral`（typing/presence/动画）。**禁止逐 token 永久写入**。
3. Snapshot 在 turn 结束、关键状态变化、reliable 阈值、优雅退出时生成；同步期间实时事件进有界 tail buffer，禁止 replay 与 live 交叉乱序。
4. Resume 响应携带可观察原因（`FULL_SNAPSHOT` / `SNAPSHOT+tail` / `REPLAY` / `PROTOCOL_ERROR`）。
5. Runtime DB 可删除重建；OMP JSONL 永远是 Agent/Session 事实源，Projection 只存 origin（`ompEntryId`/`rpcRunId`）用于对账。

## 待 spike（02 Slice 1/2 fixtures 输出后冻结）

1. 各 stream 的事件/字节/时间保留阈值与 compaction 触发点。
2. coalesced 窗口大小与 snapshot 生成频率的实测值（Stream fixture 10/30/60/120 updates/s）。
3. `hostEpoch` 的生成与轮换规则（Host DB 重建 = 新 epoch；Epoch 不因 Host 重启变化）。

## 外部依赖

- SQLite 版本 ≥ 3.51.3（WAL-reset 修复），版本检查进入启动诊断（02 的约束）。

## 后果

- 现有 `useAgentSession` 的 reconcile 逻辑保留为 4.x 路径；02 Slice 2 在实验 flag 下做等价 PoC，不接生产流量。
- cursor 是 wire contract 的一部分，进入 01 的 `lib/contracts/` fixture 冻结。

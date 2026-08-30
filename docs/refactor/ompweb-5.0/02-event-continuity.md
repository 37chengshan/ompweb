# 02 — Event Continuity：Journal、Snapshot、Resume 与 Mutation Receipt

## 目标

让临时断网、浏览器休眠、Host 重启、OMP 子进程重启和多客户端切换后，客户端能回到可解释、可收敛的权威状态。Event Journal 服务于恢复，不取代 OMP session JSONL。

## 权威边界

```text
OMP JSONL / OMP RPC       Agent 与 Session 事实源
ompweb Runtime DB         可重建 Projection + 连接连续性 + 设备/命令记录
Client Cache              带 lastSyncedAt 的非权威快照
```

Runtime DB 可以删除后重建；OMP session 和 credential 不因重建被改写。启动时必须 reconciliation，不能直接把旧 snapshot 当作当前 OMP 状态。

## Cursor 与事件模型

单独的 per-session `seq` 不足以表达 Host 重建和多 stream。v1 采用：

```ts
type EventCursor = {
  hostEpoch: string;   // Runtime DB/identity generation
  streamId: string;    // session:<id>, host, devices, settings...
  seq: number;         // stream 内严格递增
};
```

事件 envelope 至少包含：

```ts
interface ReliableEvent<T = unknown> {
  cursor: EventCursor;
  eventId: string;
  type: string;
  payloadVersion: number;
  occurredAt: number;
  recordedAt: number;
  class: "reliable" | "coalesced" | "ephemeral";
  origin?: { ompEntryId?: string; rpcRunId?: string };
  payload: T;
}
```

`hostEpoch` 改变时客户端必须 full resync。未知 event type 可记录 telemetry 并安全忽略；未知 mutation/result 不允许推测成功。

## 持久化策略

### Reliable

- approval create/resolve；
- session/agent/tool 的状态边界；
- message started/completed 与最终内容 checkpoint；
- mutation accepted/committed/failed/unknown；
- device revoke、capability 变更；
- settings/commands registry revision 变化。

### Coalesced

- streaming message delta 合并为固定时间窗或大小的 checkpoint；
- todo/diff/tool semantic progress 保留最新值和结束值；
- token/context/tps 采样，不做逐 token 永久写入。

### Ephemeral

- typing、presence tick、光标、纯动画状态；
- 网络断开即允许丢失。

Snapshot 默认在 turn 结束、关键状态变化、可靠事件阈值和优雅退出前生成。禁止每个 token snapshot。

## 数据库最小结构

第一版只需要：

- `runtime_meta(host_epoch, schema_version, created_at)`；
- `streams(stream_id, next_seq, compacted_through, updated_at)`；
- `events(stream_id, seq, event_id, type, class, payload_version, payload, recorded_at)`；
- `snapshots(stream_id, seq, state_version, payload, created_at)`；
- `commands(device_id, client_msg_id, request_hash, status, result, updated_at)`；
- `projection_sessions(...)`；
- `devices(...)`。

不要在 Phase 1 复制 OMP message 全文作为第二事实源。FTS 和搜索投影在 06 单独处理。

## SQLite 约束

- Runtime DB 必须位于本机磁盘，禁止网络文件系统。
- 使用单 writer queue、短事务、prepared statement、busy timeout。
- WAL 需要显式 checkpoint/size telemetry，并覆盖 checkpoint starvation。
- 绑定的 SQLite 必须是 3.51.3+ 或 SQLite 官方列出的 WAL-reset bug 修复回移版本；版本检查进入构建和启动诊断。[SQLite WAL](https://www.sqlite.org/wal.html)
- 备份/复制 DB 时必须使用 SQLite backup API 或先安全 checkpoint，不能只复制主文件遗漏 `-wal`。

## Resume 流程

```text
Client: HELLO + subscriptions(cursor[])
Host:
  epoch mismatch            → FULL_SNAPSHOT
  cursor < compactedThrough → SNAPSHOT + replay tail
  cursor in retained range  → replay cursor+1...head
  cursor > head             → PROTOCOL_ERROR + full resync
Host: SYNC_COMPLETE(head cursors + snapshot revision)
Client: 原子替换/应用 → connected
```

同步期间实时事件进入有界 tail buffer；snapshot/replay 完成后按 seq 接续，禁止 replay 与 live 交叉乱序。

## Mutation 幂等边界

原计划的“exactly once”需要降级为可实现语义：

1. key 为 `(device_id, client_msg_id)`，同时存 `request_hash`；同 key 不同 payload 返回冲突。
2. Host 在调用 OMP 前持久化 `accepted`，执行后写 `committed/failed`。
3. 如果 Host 在 OMP 已产生副作用后、写 result 前崩溃，状态标记 `unknown`；恢复时通过 OMP entry/session state reconciliation 尝试确认。
4. 无法确认时绝不自动重放高风险命令；向客户端返回 `OUTCOME_UNKNOWN` 并要求读取新 snapshot。
5. Prompt 等能关联 OMP entry id 的 mutation 在完成后记录 origin；Terminal write 等不可事务化行为只承诺重复检测，不虚假承诺 exactly-once。
6. dedup retention 必须长于客户端最大重试窗口；过期 key 返回明确错误而不是当新命令执行。

## 实施切片

### Slice 1 — 纯语义模型

- 在 TypeScript 中实现内存 journal/snapshot/resume oracle。
- 产出语言无关 fixtures：正常 replay、compact fallback、epoch change、live-tail merge、重复 mutation、unknown outcome。
- 该实现只服务 contract test，禁止接生产流量。

### Slice 2 — 4.x Node PoC

- 在测试/实验 flag 下把现有 SSE event normalize 成 envelope。
- 断网 30 秒期间 OMP 继续输出，重连后完整收敛。
- 不落永久生产 DB；验证事件分类、速率、snapshot 大小和 replay 时间。

### Slice 3 — Rust 持久化实现

- 由 06 的 Host Runtime 实现唯一生产 journal。
- 对同一 fixture 与 TypeScript oracle 做字节/语义等价。
- 加 crash point：事务前、accepted 后、OMP 调用后、result 前、checkpoint 中。

### Slice 4 — Retention 与 rebuild

- 按 stream 设置事件/时间/字节阈值。
- snapshot 校验通过后才能 compact。
- 提供 `runtime db check/rebuild`；重建不触碰 OMP 文件。

## 测试与性能门

- 单元：seq、epoch、cursor、request hash、状态机。
- 属性/模糊：重复、乱序、截断、未知字段、损坏 payload。
- Crash：kill -9、磁盘满、只读目录、SQLITE_BUSY、损坏最新 snapshot。
- 负载：10k/100k reliable event replay，持续 reader 下 checkpoint，journal 上限。
- 目标值由 12 的基线冻结；任何实现都必须保证 UI 同步期间仍可输入/滚动。

## 退出标准

- 断网、Host/OMP 重启后客户端最终与 OMP 权威状态一致。
- replay、snapshot fallback、full resync 都有可观察原因和耗时。
- 重复 mutation 可检测；crash ambiguity 不会静默重放。
- Runtime DB 可删除重建，且不会破坏 OMP session。
- Journal 写入与 replay 满足已冻结性能预算。

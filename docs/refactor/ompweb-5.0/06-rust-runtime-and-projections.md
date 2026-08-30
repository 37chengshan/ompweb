# 06 — Rust Host Runtime、OMP Supervisor 与 Projection

## 目标

把长生命周期、IO 密集、需要安全边界的能力从 Next server 迁到可独立运行的 Rust Host，同时保持 OMP 为 Agent/Session 权威、React 为 UI、Node 路径可回滚。

## 首要架构决策：Host 生命周期

原计划的“Tauri Shell → Rust Core”容易让 Core 随窗口退出。长任务和远程控制要求更清晰的模型：

```text
ompweb-host (user-scoped process/service)
  ├─ OMP Supervisor
  ├─ Event/Projection DB
  ├─ Remote listeners/relay connection
  ├─ PTY / File / Git services
  └─ authenticated local endpoint

Tauri / Web / Mobile = clients
```

推荐默认：关窗口不终止正在运行的 Agent；“Quit UI”和“Stop Host”分开。最终行为由 `ADR-002` 冻结，并提供清晰 tray/menu 状态。不能在未决定生命周期前写 Tauri 集成。

## 起步 crate 结构

不按原计划立刻拆 13 个 crate。第一阶段：

```text
crates/
  ompweb-protocol/   wire/domain types、codec、fixtures
  ompweb-storage/    journal、projection、migration
  ompweb-host/       supervisor、services、listeners、binary
  ompweb-platform/   必要时才拆 PTY/keychain/platform adapter
```

只有出现独立发布、明显依赖隔离或编译时间收益时，再拆 event/session/terminal/files/git/settings/commands。

## OMP Supervisor

必须等价迁移当前 [`lib/rpc-manager.ts`](../../../lib/rpc-manager.ts) 与 [`lib/omp/rpc-process.ts`](../../../lib/omp/rpc-process.ts) 的真实行为：

- 每 active session 一个 OMP `--mode rpc-ui` 子进程；
- ready/协议 v2 negotiation 与 1MiB/64MiB framing limit；
- concurrent start lock、global registry、idle disposal；
- prompt/agent lifecycle、queued count、fatal reconnect；
- extension UI request、host URI/tool、subagent subscription；
- stdout/stderr flood、malformed NDJSON、late frame；
- external session change、unsupported command 的稳定错误。

Rust 不 import/reimplement OMP SDK，不读取 `agent.db`，不重写 provider/auth/agent loop。

## Session Projection

权威输入仍是 OMP v3 JSONL 和 RPC：

- 初次 scan 复用现有 fixture：title slot、旧 header、entry tree、compaction、blob、artifact、archive；
- watcher 只作为 change hint；overflow/filename null/平台差异时回退 bounded rescan；
- tail parse 必须处理 incomplete trailing line 和外部 truncate/rewrite；
- Projection 表只存 sidebar/search/metadata 所需字段和 origin offset/hash；
- 每条 Projection 都有 source mtime/size/generation，可检测过期；
- 提供全量 rebuild，并与 Node `listAllSessions/buildSessionContext` 做 equivalence。

FTS 默认不索引 thinking、terminal raw output、credential、图片 OCR 或用户标记为 sensitive 的内容。索引策略和 clear/rebuild UI 必须可见。

## PTY、File、Git

### PTY

- 先保持 Node `node-pty`，Rust adapter 影子跑平台 fixture；
- 评估 `portable-pty` 但不预先锁库；
- 保留 UTF-8/CJK/IME、resize、Ctrl+C/D、Windows ConPTY、macOS/Linux PTY；
- raw output 有 byte-bounded scrollback，远程默认 semantic log，interactive raw PTY 需单独 capability；
- flow control 对接 03，断开不允许无界积压。

### File

- canonicalize → root resolution → symlink policy → capability → operation limit → audit；
- 与 [`lib/file-access.ts`](../../../lib/file-access.ts) 跑同一 traversal/symlink fixture；
- read/write/upload/watch 都有 size/range/rate limit；
- 写操作使用原子替换/预期 revision，不能覆盖并发变化。

### Git

- read 与 write capability 分离；
- 默认只迁 status/diff/log/branch list；
- checkout/reset/commit/push 逐项加策略和高风险确认；
- 参数数组调用 Git，禁止 shell string 拼接；
- 工作树 dirty/force 语义与现有 API 等价。

## Local Endpoint

- Unix domain socket / Windows named pipe 优先；必要时 authenticated loopback TCP。
- endpoint 权限绑定当前 OS user，握手验证 Host instance/epoch。
- Tauri IPC 只负责壳动作；不让 remote web content 获得任意 Tauri command。
- Host 支持 foreground/debug mode，便于 npm/CLI 用户不安装 system service。

## 迁移切片

1. Rust workspace、protocol fixtures、health/version，不接生产 UI。
2. Storage + Event Continuity，通过 02 全套 conformance。
3. Session Projection 影子运行，比较 Node/Rust session summaries/context hashes。
4. Host local endpoint + Http compatibility bridge，UI 仍走 Next。
5. OMP Supervisor canary；按 session feature flag 切流，失败回 Node。
6. PTY → File → Git 逐模块等价迁移。
7. Node route 变薄 adapter，不再持有真实 runtime state。
8. 观测稳定后才让 Tauri/Web 直接连接 Host。

## 性能与可靠性

- Host idle RSS/CPU、spawn latency、5 active sessions、stdout flood；
- 1k session list、超大 JSONL tail update、FTS rebuild；
- 100k event replay 和 WAL checkpoint；
- PTY throughput/keypress echo；
- crash loop/backoff、Host/OMP kill -9、sleep/wake；
- 所有数值使用 12 的同机 p50/p95 门，不以“Rust 理论更快”代替结果。

## 回滚

- 每个 service 有 `node | rust-shadow | rust` flag；
- mutation 始终单写，shadow 只读比较；
- Runtime DB schema migration 可备份/回退，Projection 可直接重建；
- Electron/Next 打包在 Tauri Stable 前持续可发布。

## 退出标准

- 活跃 Agent 生命周期由 Host 管理，UI 关闭/重开行为符合 ADR；
- Node/Rust contract/equivalence suite 全通过；
- Projection 可重建且不会修改 OMP 权威文件；
- PTY/FS/Git 安全和平台矩阵通过；
- 关键性能不低于冻结预算；
- 任一模块能在一次发布内切回 Node 路径。

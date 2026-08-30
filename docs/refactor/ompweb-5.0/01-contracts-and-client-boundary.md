# 01 — Domain Contract 与统一 Client Boundary

## 目标

先在当前 4.x UI 与 Next API 之间建立稳定、可测试、与传输无关的客户端边界，再替换后端实现。完成后，React 组件不再知道 `/api/...`、SSE、Tauri IPC 或 Remote WebSocket 的具体形态。

本工作包不重排仓库、不改 UI、不引入 Rust，也不改变任何用户行为。

## 当前基线

- [`lib/agent-client.ts`](../../../lib/agent-client.ts) 只封装了 `/api/agent/[id]` 的 POST 命令，证明 facade 模式已经可行。
- `app/`、`components/`、`hooks/`、`lib/` 中仍有约 88 个直接 `fetch('/api...')` 或 `EventSource` 调用。
- [`hooks/useAgentSession.ts`](../../../hooks/useAgentSession.ts) 同时承担领域状态、SSE、RPC 映射、重连、滚动和 UI 衍生逻辑，是最需要拆边界但也是风险最高的文件。
- 76 个 route 涉及 Agent、Session、Files、Git、Terminal、Models、Auth、MCP、Plugins、Skills、Projects 等多个领域，不能一次迁完。

## 目标模型

客户端只暴露领域能力：

```ts
interface OmpwebClient {
  host: HostClient;
  sessions: SessionClient;
  agent: AgentClient;
  approvals: ApprovalClient;
  terminal: TerminalClient;
  files: FileClient;
  git: GitClient;
  settings: SettingsClient;
  commands: CommandsClient;
  devices: DeviceClient;
  diagnostics: DiagnosticsClient;
}
```

适配器：

```text
HttpSseAdapter       当前 Next route + SSE
RemoteWsAdapter      Remote Protocol v1
LocalHostAdapter     本地 daemon socket/loopback
TauriAdapter         仅壳能力：窗口、对话框、通知、平台集成
FixtureAdapter       contract / UI / performance 测试
```

TauriAdapter 不复制 Agent/Session API；它只负责 Tauri 特有能力。桌面 UI 与 Host Runtime 的领域调用仍通过同一 `OmpwebClient`。

## Contract 规则

1. ID、时间、cursor、错误码和状态 enum 都是 wire contract，不允许组件自行发明。
2. 每个 response 包含 `contractVersion` 或由 transport handshake 固定版本。
3. 错误统一为 `{ code, message, retryable, details? }`；UI 分支匹配 `code`，不匹配英文错误字符串。
4. 分页只暴露 opaque cursor，不让客户端构造 byte offset/数据库 rowid。
5. mutation 统一接收 `clientMsgId`、`expectedState?`、`expectedRevision?`；旧 HTTP adapter 可忽略不支持字段但必须报告 capability。
6. subscription 统一返回 `close()`、连接状态、最后 cursor 和 `resync()`，不能只返回裸 `EventSource`。
7. 类型源保持单一。第一阶段放在 `lib/contracts/`，用固定 JSON fixtures 校验；Rust 边界出现后再通过 ADR 决定 JSON Schema/代码生成方向。

## 实施切片

### Slice 1 — 清点与防回退

- 生成直接 API 调用清单，按领域、读/写、stream/one-shot 标注。
- ESLint 增加受控规则：新组件不得直接添加 `/api` fetch；现有位置进入 allowlist 并逐步清零。
- 为当前 API error shape、分页、SSE terminal event 建 contract fixture。
- 只加测试和文档，不改运行路径。

### Slice 2 — Agent / Session

- 把已有 `sendAgentCommand` 扩为 `AgentClient`。
- 封装 session list/get/context/create/rename/archive/delete/fork。
- 把 per-session SSE 和 running-session SSE 封装为 subscription。
- `useAgentSession` 先依赖 interface，默认仍注入 HttpSseAdapter。
- 双读影子验证：旧路径与 facade 的 snapshot hash 相同，mutation 仍只走旧单写路径。

### Slice 3 — Terminal / Files / Git

- 封装 PTY open/input/resize/stream/close，保留现有 1MiB replay 行为。
- 封装 file range/watch/upload 和 allowed-root error。
- 封装 Git status/diff/log 与 Worktree mutation。
- 所有大结果强制分页/range，禁止领域层返回无界字符串。

### Slice 4 — Settings / Commands / Extension surfaces

- 接入 07、08 的 registry/value/execute contract。
- HostUIRequest 统一 confirm/select/input/editor 生命周期。
- Auth/credential 单独接口，绝不混入通用 settings。

### Slice 5 — 提升为 workspace package

只有以下条件同时满足才从 `lib/client/` 移到 `packages/client-sdk`：

- 至少 HttpSseAdapter 和 FixtureAdapter 两个实现通过同一 contract suite；
- React 组件不直接 import Next route 类型；
- 类型没有 Node/DOM 专属对象；
- 包边界不会导致前端 bundle 引入 server-only 代码。

## 测试与门禁

- 每个 adapter 跑同一组 contract tests。
- mutation 的旧/新路径做单写、双读，不允许 dual write。
- SSE 断开、重复事件、旧 run 晚到事件继续复用现有 reconcile fixture。
- Bundle 分析确保 server-only 模块未进入浏览器。
- UI screenshot、动画和性能指标必须无变化；本工作包不接受“因为重构所以略有变化”。

## 退出标准

- 直接 API/EventSource 调用只存在于 adapter 和明确的登录/bootstrap 边界。
- `useAgentSession` 不再拼 URL、不直接创建 EventSource。
- 所有主要领域都有 FixtureAdapter，并能在不启动 Next/OMP 时渲染关键 UI 状态。
- HttpSseAdapter 默认路径与 4.x 行为等价，能通过一个 feature flag 回退到旧实现。
- 后续 Remote、Rust、Tauri 只新增 adapter，不要求重写 UI。

# 00 — 原始升级计划审计与纠偏

## 结论

**有条件通过产品方向，拒绝直接执行原始 PR 序列。**

“Native Runtime + Remote Continuity + OMP Capability Parity”是合理的 5.0 方向，但原计划混合了已经实现的 4.x 能力、尚未验证的协议设计、上游 OMP 依赖和过早的仓库拆分。如果直接开工，最可能出现三种失败：先换 Tauri 壳但仍带完整 Node/Next、实现两遍 Journal 后再迁 Rust、以及在没有性能/视觉基线时让 UI 迁移产生不可见回归。

后续实施以本目录为准；原始 v3 文档保留作背景，不作为任务清单。

## 本地基线证据

| 事实 | 证据 | 对原计划的影响 |
|---|---|---|
| 当前版本为 4.0.12，Next 16.3、React 19.2、Electron 44、Node 22.19+ | [`package.json`](../../../package.json) | 不能按早期 4.x 假设设计迁移 |
| 当前架构明确把“通用远程控制面”列为非目标 | [`DESIGN.md`](../../../DESIGN.md) | 5.0 必须先做产品/架构 ADR，显式修订契约 |
| Desktop 确实是 Electron → Node → Next standalone，并监听 `0.0.0.0` | [`desktop/main.js`](../../../desktop/main.js) | Tauri 迁移方向成立，但安全止血必须提前 |
| 已有 one-time token、设备列表、心跳、撤销、诊断、Quick Tunnel | [`lib/remote-pairing.ts`](../../../lib/remote-pairing.ts)、[`app/api/pair`](../../../app/api/pair) | 不是“只有 QR + Cookie”；这些行为要迁移/兼容，不能重做后丢失 |
| Remote gate 仍依据 Host 和配对 Cookie；Cookie 未设置 `Secure` | [`proxy.ts`](../../../proxy.ts)、[`app/api/pair/accept/route.ts`](../../../app/api/pair/accept/route.ts) | Host 不能继续作为信任根；公网/非可信 LAN 需要 HTTPS 或 VPN |
| Agent 生命周期已有全局 registry、单会话 OMP RPC、SSE 与 reconcile | [`lib/rpc-manager.ts`](../../../lib/rpc-manager.ts)、[`hooks/useAgentSession.ts`](../../../hooks/useAgentSession.ts) | Rust Supervisor 应做等价迁移，不从空白模型开始 |
| OMP JSONL reader 已支持 1GiB 上限、分支、Blob、归档、缓存 | [`lib/omp/session-files.ts`](../../../lib/omp/session-files.ts)、[`lib/session-reader.ts`](../../../lib/session-reader.ts) | Projection/增量索引应复用 fixture 和行为测试 |
| 已有 Node PTY、1MiB replay buffer、会话 TTL/上限 | [`lib/terminal-session-manager.ts`](../../../lib/terminal-session-manager.ts) | PTY Rust 化要做跨实现等价与流控，而不是只替换库 |
| 已有文件 allow-list、Git/Worktree、MCP、Skills、Plugins 等 API | [`lib/file-access.ts`](../../../lib/file-access.ts)、[`lib/worktree.ts`](../../../lib/worktree.ts) | Runtime 工作量比原计划表格显示的更大 |
| 当前有 76 个 API route、95 个测试文件、88 处直接 API/EventSource 调用 | Git 跟踪文件与 `rg` 审计（2026-08-30） | “先建 Client SDK”正确，但必须分领域迁移，不能一个 PR 完成 |
| 已有 `lib/agent-client.ts`，不是完全没有 facade | [`lib/agent-client.ts`](../../../lib/agent-client.ts) | 从现有 helper 扩展，边界稳定后再提升为 workspace package |
| 长对话当前只做 50 条增量加载；用户继续向上加载后 DOM 仍持续增长 | [`lib/chat-lazy-load.ts`](../../../lib/chat-lazy-load.ts)、[`components/ChatWindow.tsx`](../../../components/ChatWindow.tsx) | 必须实现有界渲染窗口/虚拟化并保持锚点、选择和 minimap |
| UI 已有大量 motion token、keyframes、内联 transition 和 reduced-motion 路径 | [`app/globals.css`](../../../app/globals.css)、[`hooks/usePrefersReducedMotion.ts`](../../../hooks/usePrefersReducedMotion.ts) | UI/动画必须建清单和自动回归，不允许“重构时顺便重做” |

本次生产依赖 `npm audit --omit=dev --registry=https://registry.npmjs.org` 返回 0 个已知漏洞；默认镜像 `npmmirror` 不实现 audit endpoint，因此发布门必须显式使用支持审计的 registry 或等价扫描器。

## 联网核验结果

1. **Quick Tunnel 判断正确。** Cloudflare 官方当前仍说明 Quick Tunnel 仅用于测试/开发、无 SLA、最多 200 个并发 in-flight request，且不支持 SSE。现有 Quick Tunnel + Agent SSE 不能作为生产链路。[Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
2. **Tauri 不能直接承载当前 Next server 形态。** Tauri 官方把自己定义为静态 Web host，并明确要求 Next 使用 `output: 'export'`；它不原生支持 SSR/server-based solution。因此“换壳”前必须完成 Client/API 分离。[Tauri Next.js guide](https://v2.tauri.app/start/frontend/nextjs/)
3. **WebSocket 本身没有浏览器背压。** 稳定的 `WebSocket` API 在消息消费不过来时可能持续堆内存/CPU；因此应用层必须有有界队列、优先级和 `bufferedAmount`/credit 策略，不能只画 multiplex header。[MDN WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)
4. **WebTransport 已更成熟但仍不进入 v1。** 2026 年成为较广泛可用能力，但需要 HTTPS/HTTP3，旧设备兼容和运维复杂度仍高；保持 transport adapter 设计即可。[MDN WebTransport](https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API)
5. **SQLite WAL 可用但有明确边界。** WAL 允许读写并行但仍只有一个 writer，长 reader 可导致 checkpoint starvation；WAL 不能放网络文件系统。更重要的是 SQLite 官方在 2026-03 公布 WAL-reset bug，需使用 3.51.3+ 或列出的修复回移版本。[SQLite WAL](https://www.sqlite.org/wal.html)
6. **Push 只能做注意面。** Apple 明确说后台通知不保证送达、会节流、只保留较新的待发通知；FCM 也可能延迟、折叠或丢弃。状态同步必须依赖 reconnect + resume。[Apple background notifications](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)、[FCM message lifespan](https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-lifespan)
7. **OMP 当前能力比原计划假设更强。** OMP 官方 RPC 已提供协议 v2 分块、`get_available_commands`、动态 `available_commands_update`、UI requests、分页消息等；但当前 canonical RPC 并没有通用 Settings Schema RPC 或结构化 builtin command execute。[OMP RPC reference](https://github.com/can1357/oh-my-pi/blob/main/docs/rpc.md)
8. **Settings 立即兼容路径已存在。** OMP 的 `config list/get/set/reset --json` 由上游 schema 驱动，JSON list 会对已配置 credential 删除 value 并标记 redacted。它可以先替代大部分手写 YAML 语义，但仍缺完整 default、enum options、scope/restart metadata。[OMP config CLI](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/cli/config-cli.ts)
9. **Tauri 使用系统 WebView。** macOS WKWebView、Windows WebView2、Linux WebKitGTK；体积可能下降，但兼容性和性能必须逐平台实测。[Tauri process model](https://v2.tauri.app/concept/process-model/)
10. **性能必须测量真实交互。** React Profiler 能记录 commit 成本，INP 衡量点击/键盘到下一帧；长 DOM、长任务和主线程解析都会直接伤害交互。[React Profiler](https://react.dev/reference/react/Profiler)、[web.dev INP](https://web.dev/articles/inp)

## 接受、修改与拒绝

| 原计划项 | 审计结论 | 修订 |
|---|---|---|
| OMP Authority / Core Projection | 接受 | Projection 必须可删除重建，禁止写 OMP `agent.db` |
| Client SDK 先行 | 接受并细化 | 从 `lib/client/` 增量封装 88 个调用；稳定后再移动 package |
| Journal / Snapshot / Resume | 接受并收窄 | 只持久化恢复必需事件；不把每 token delta 永久双写 |
| “所有 mutation 绝不重复” | 修改 | 定义为持久化接收、重复检测和 crash 后可判定/可收敛；没有下游事务时不虚假承诺 exactly-once |
| WebSocket + 自定义 Binary Frame 首发 | 修改 | v1 先用版本化 JSON control/event + 可选 binary data；自定义 header/编码必须由 benchmark 证明 |
| 12 条并行 Workstream | 修改 | 改为依赖波次；协议、安全、性能门未过前禁止扩面 |
| 13 个 Rust crates | 拒绝作为起步结构 | 先 3–4 个粗粒度 crate，出现独立发布/依赖边界后再拆 |
| Node 生产 Journal 再完整重写 Rust | 拒绝 | TS 只做限时语义 oracle/conformance fixtures；生产持久化只实现一次 |
| Tauri 迁移 | 接受但后置 | 先静态前端、Host Runtime、IPC 和 UI/性能基线 |
| Tauri 内嵌 Core | 修改 | 先决策 Host 生命周期；推荐独立 user-scoped host，Tauri 是薄客户端，关窗不应杀活跃 Agent |
| React Native / PWA 二选一写进总计划 | 暂缓 | 协议稳定后用 PWA、Tauri Mobile、React Native 三方 spike 决策 |
| Zero-Knowledge Relay | 修改命名 | 称“payload-confidential blind relay”；Relay 仍可见连接和路由元数据 |
| Ed25519 + X25519 即安全协议 | 拒绝 | 采用成熟握手协议/库并做独立安全评审，算法只作为候选套件 |
| 1.5 秒冷启动等绝对数字 | 修改 | 先测平台 p50/p95，再冻结预算；仍设置交互硬上限防止“基线本来就慢” |
| UI 借 5.0 重新设计 | 明确拒绝 | 像素、主题、组件、动画、reduced-motion 全部保真 |

## 进入实施前必须完成的 ADR

1. `ADR-001`：修订 `DESIGN.md`，明确从“非远程控制面”演进为 local-first agent host 的产品边界。
2. `ADR-002`：Host 生命周期——独立 daemon/user service 还是跟随桌面进程；活跃 Agent 的关闭语义是什么。
3. `ADR-003`：事件 cursor（`host_epoch + stream_id + seq`）、保留策略和 OMP JSONL reconciliation。
4. `ADR-004`：Remote v1 编码与流控；JSON/binary 边界及何时允许引入 CBOR/Protobuf。
5. `ADR-005`：设备握手协议、库、浏览器密钥安全等级、轮换和恢复。
6. `ADR-006`：Mobile 技术栈与 Push provider；不得在协议稳定前决定。
7. `ADR-007`：性能参考硬件、fixture、p50/p95 计算和允许回归阈值。

## 4.x 立即止血项

这些工作不等待 Rust/Tauri：

1. UI、README 和诊断页把 Quick Tunnel 标记为开发/临时分享，禁止用“生产远程”措辞。
2. 非 loopback 启动时给出明确安全等级：可信 LAN/VPN、HTTPS Named Tunnel 或不安全；不能把 Host + Cookie 文案写成“安全”。
3. 对 token issue/accept、login、heartbeat 和 mutation 建立速率限制/滥用测试；反向代理场景不允许通过重写 Host 绕过认证。
4. Pair token 不再长期放 query/history/referrer；新 enrollment 采用 fragment 或 app-handled QR payload，并在本机确认。
5. 建立 UI/动画/性能黄金基线，再允许数据层和桌面壳迁移。

## 审计后的最短关键路径

```text
4.x 止血 + ADR + 基线
  → Client Facade
  → Event/Resume Conformance
  → WS v1 + Security PoC
  → Rust Host（可回退）
  → Web 静态客户端 + 长对话性能
  → Relay / Tauri / Mobile Preview
  → 观测、迁移、回滚、Stable Gate
```

原始文档里的 Native Settings/Commands 可以并行，但只能消费 OMP 真实 registry/CLI/RPC，不能重新定义 OMP 行为。

# Agent MCP 重构设计（v0.3）

日期：2026-08-03 · 状态：已确认（brainstorming 流程定稿）

## 1. 概述

重构 codex 中的 grok-cli MCP（`~/.codex/mcp-servers/grok_cli_mcp.py`，v1.4.0）为通用多 agent 调度 MCP：

- **主载体（host，MCP client）三端**：omp（底层 pi）、codex、claude code
- **任务模型池（被派发 CLI）四端**：claude、grok、opencode、omp(pi)，互为载体（主载体可派发给池内任一 CLI，含自身）
- **可视化网页**：Claude UI 风格、单文件 HTML、低内存（常驻 <100MB）、SSE 实时，知识导图式任务树（任务节点 → agent 分支 → 汇合）+ 节点详情面板 + token 统计
- **配套 skill**：三端分发，内置 agent 预设（只提示词、去模型化），六步工作流
- **验收标准**：任务池四 CLI 派发全通、三主载体可用、监控网页达标、skill 开箱即用、数据准确、性能好内存低、MCP 稳定、Windows/macOS 双平台

## 2. 架构总览

三进程拓扑：

```
主载体（omp / codex / claude code，规划/审查/编排）
  └─ MCP stdio（JSON-RPC，随主载体会话起停）
       └─ MCP 薄层 mcp_server.py（零依赖：工具面/参数校验/透传/原子拉起 daemon，无状态）
            └─ HTTP/SSE（127.0.0.1:8765 · Host 校验 + 写操作 X-Auth-Token）
                 └─ daemon agent_daemon.py（常驻单例）
                      ├─ 派发执行器：spawn 四 CLI 子进程（各自适配器 → 统一规范化事件）
                      ├─ SQLite WAL 单写者（任务树/事件/token）
                      ├─ SSE 统一广播（15s 心跳 · 连接上限 32）
                      └─ HTTP 控制端点 + 静态文件托管
                           └─ 网页（单文件 HTML，只读）
```

| 进程 | 生命周期 | 职责 | 技术 |
|---|---|---|---|
| mcp_server.py | 主载体会话 | 工具面、参数校验、转发、拉起 daemon | Python stdlib，零依赖 |
| agent_daemon.py | 常驻单例 | CLI 派发、事件解析、SQLite、SSE、网页托管、认证检测 | Python stdlib + psutil |
| CLI 子进程 | 单任务 | 执行 agent 循环（自管认证） | claude / grok / opencode / omp |

**原子拉起协议**：MCP 探测端口 → 无则 spawn 分离进程（macOS `start_new_session` / Windows `DETACHED_PROCESS`）→ 轮询 `GET /health`（1s×10）→ 失败结构化报错。锁文件（`~/.codex/agent-mcp/daemon.lock`）含 pid+时间戳，先验存活，残留锁覆盖。端口占用先打 /health 区分本 daemon 与他人占用（后者报错 + 建议 `AGENT_MCP_PORT`）。

**关键决策**：主载体退出后任务继续跑、网页继续可看、历史不丢；重启后 MCP 重连同一 daemon。daemon 是唯一有状态组件。

## 3. 工具面（V2 六原语本地化降级 + 监控）

| 工具 | 语义（本地化） | 关键参数 |
|---|---|---|
| `spawn_agent` | 创建任务并启动 CLI 子进程 | target_cli (claude/grok/opencode/omp) · task_name（/root/task1 分层）· prompt · cwd · permission_mode · model · context（父摘要注入，替代 fork_turns）· resume · max_turns · timeout_seconds · parent_agent_id · session_id |
| `send_message` | 投递到 daemon 消息队列：运行中挂起、终止后标 undelivered；永不触发执行 | agent_id · message |
| `followup_task` | 唯一触发新 turn 的入口：合并挂起消息进 prompt | agent_id · prompt · interrupt |
| `wait_agent` | 短阻塞 30s + 轮询指引 | agent_id · timeout(≤30s) |
| `interrupt_agent` | SIGTERM 进程树（psutil）→ cancelled；中断前读最后 usage，缺失标"usage 不完整" | agent_id |
| `list_agents` | agent 树/状态/last_message，自省/可视化/轮询 | session_id（默认本会话）· parent_agent_id |
| `get_agent_activity` | 实时活动流（按 seq 分页） | agent_id · since_seq |
| `get_token_usage` | 单任务/子树/全局统计（按模型拆分 + 成本估算，标"派发侧估算"） | agent_id · scope · session_id |

**审查修正（CRITICAL）**：
- `fork_turns` 在本地 CLI 无实现路径 → 降级为 `context`（父摘要文本注入）+ `resume`（daemon 记录各 CLI session_id 透传 `--resume`）；文档声明文本继承有重复计费
- `send_message` 在 `-p` 单次进程语义空洞 → 定义为 daemon 消息队列，仅 `followup_task` 触发执行；skill 中"发消息"一律用 followup_task

**四 CLI 能力矩阵**（实现第一步实测填表）：

| 能力 | claude | grok | opencode | omp(pi) |
|---|---|---|---|---|
| 事件流格式 | stream-json --verbose | streaming-messages-json | run --format json | 待实测（headless） |
| 流式输入 | --input-format stream-json ✓ | 待实测 | SDK SSE ✓/CLI 待实测 | 待实测 |
| resume | --resume session_id ✓ | --resume ✓ | 待实测 | 待实测 |
| usage 字段 | result.usage + total_cost_usd | usage（Messages 格式） | 事件 usage | 待实测 |
| 权限模式 | plan/acceptEdits/bypass | plan/acceptEdits/bypassPermissions | plan/edit/-y | 待实测 |
| Windows 二进制 | npm shim | 待实测 | npm shim | 待实测 |

**权限映射**：plan（claude `--permission-mode plan` / grok `plan --no-subagents` / opencode `run -m plan`）；acceptEdits；fullAccess（claude `--dangerously-skip-permissions` / grok `bypassPermissions --always-approve` / opencode `run -y`）。具体 flag 实现时逐一实测。

**汇合约定**：子 agent final 输出即回传父节点（FINAL_ANSWER = 汇合点）；wait_agent 只返回摘要 + 结构化结果（context rot 对策）。

## 4. 事件流 · 状态机 · 数据模型

**状态机**：queued → running → terminated·end_turn；running → error（认证失败/CLI 崩溃/权限拒绝）/ cancelled / incomplete（超时）。并发槽位 `max_concurrent_agents`（默认 4）FIFO 队列。headless 下权限拒绝不进入 requires_action，直接 error + next_actions。终止态必带 stop_reason（end_turn / retries_exhausted / daemon_restart / interrupted）；cancelled/incomplete 永不上报 success。

**事件类型**（规范化 schema；events 是唯一写入源，usage/messages 是投影）：

| 事件 | 含义 | 落库 |
|---|---|---|
| agent.spawned / agent.running | 节点创建（父节点=分支点）/ CLI 启动 | ✓ |
| agent.message | 文本（buffered 权威事件） | ✓ |
| agent.message_delta | 增量预览（打字机）——只广播不落库 | ✗ |
| agent.tool_use / tool_result | 工具调用（详情面板"在干什么"） | ✓ |
| agent.usage | token 消耗（model_usage 四字段，按 id 去重） | ✓ |
| agent.thread_message_sent/received | 跨 agent 通信（parent_agent_id） | ✓ |
| agent.idle / terminated | 状态迁移（stop_reason） | ✓ |
| agent.error / cancelled | 失败/中断（结构化错误 + next_actions） | ✓ |

**token 统计**：model_usage 四字段（input/output/cache_creation/cache_read）+ 按模型拆分 + 成本估算；dedupe 陷阱（并行 tool call 共享 message.id 必须去重）；口径标注"派发侧估算"，对账方法（claude modelUsage / grok trace / opencode 事件）；中断任务标"usage 不完整"。

**SQLite schema（WAL · 单写者 · 0600）**：
- agents：id · parent_id · session_id · task_name · cli · model · cwd · permission_mode · status · stop_reason · created_at · updated_at · finished_at · pid · cli_session_id · command_summary
- events：id(seq) · session_id · agent_id · type · payload(JSON) · created_at（SSE 重连 Last-Event-ID + dedupe 回放）
- usage：agent_id · model · 四字段 token · cost_usd · ts
- messages：agent_id · role · content · ts（详情面板分页）

**保留策略**：events 超 N 万条滚动清理（默认 7 天，保 terminated/usage 汇总）；messages 每任务保留最近 M 条。写入：100ms / 50 条批量 commit；delta 只广播。

**退出码 → stop_reason 判定表**：退出码 0 + result = end_turn；非 0 + error 事件 = error（透传诊断）；超时 = incomplete（可 resume/重派）；信号杀死 = cancelled；daemon 重启发现孤儿存活 = terminated·error（daemon_restart，进程树终止，可 resend 不可 resume）。

## 5. 可视化前端

单文件 HTML + 原生 JS + 手写 SVG 树布局（无框架/构建链/图库依赖），daemon 托管，SSE 实时，**只读**。

- 知识导图：主任务 /root → 分支（各 agent 节点：CLI 标识、状态色、活动、token）→ 汇合回主任务；节点点击展开详情面板（当前活动、消息流分页、token 曲线、CLI 内部活动摘要黑盒）
- 顶栏统计：进行中/排队/已完成/失败任务数（当前会话可切全部）· 总 token（input/output/cache）+ 估算成本 · 按模型拆分 · 每 agent 实时 token
- SSE `/events?last_seq=N`：stream-first + 断线 Last-Event-ID 回放 + dedupe；事件循环统一广播 + 15s 心跳（`: ping`）+ 写失败断开清理 + 连接上限 32；DOM 更新 rAF 合并；消息流分页
- 性能目标（统一口径）：daemon 常驻 <100MB（实测目标 30-60MB）；页面无轮询；导图按 agent 节点全量渲染

## 6. 配套 Skill

三端分发（codex `.agents/skills` / claude `~/.claude/skills` / omp `~/.omp/agent/skills`），内容通用。

**六步工作流**：拆解（主 agent 分析任务 + planner 提示词）→ 规划审查（主 agent 自查）→ 并行派发（spawn_agent 多分支，按任务类型选载体+模型，只收摘要）→ 监控（wait_agent 短阻塞 + list_agents/get_agent_activity 轮询；网页可视）→ 汇合（FINAL_ANSWER 回传，主 agent 综合）→ 审查迭代（code-reviewer/security-reviewer 提示词 + followup_task）。

**内置 agent 预设（只提示词 · 去模型化）**：planner / architect / code-reviewer / security-reviewer / tdd-guide / build-error-resolver / e2e-runner / refactor-cleaner / doc-updater / code-explorer / lang-reviewers（各语言）。预设 = name + description + developer_instructions 提示词模板（来自 `~/.claude/agents/*.md`），**不指定 CLI 载体、不指定模型**——派发参数由主 agent 按匹配指南现场决策（Codex V2 优先级链：显式 spawn 值 > 默认 > 父值）；模型绑定留给各主载体侧配置（codex `[agents] default_subagent_model`、claude agent 配置、omp modelRoles）。

**预设展开示例**：spawn_agent 的 prompt = 角色提示词 + 任务描述 + 输出要求 + 约束；context = 父摘要；cwd = 任务目录；target_cli/model/permission_mode = 主 agent 决策。skill 含工具调用示例、参数速查、错误恢复路径（超时→resume/重派、认证→检查 CLI 登录与 opencodex 代理）。

## 7. 跨平台 · 安全 · 稳定性 · 部署迁移

**安全**：Host 头校验（仅 127.0.0.1/localhost，防 DNS rebinding）；写操作 X-Auth-Token（daemon 启动生成随机 token 写 0600 文件 `~/.codex/agent-mcp/daemon.json`，不经命令行；MCP 携带，网页只读免 token）；认证全部 daemon 侧且 CLI 自管（不碰密钥，只检测缺失/失败并结构化报错；确需注入用环境变量）；SQLite/锁文件/token 0600。

**跨平台**：

| 问题 | macOS | Windows |
|---|---|---|
| 认证 | Keychain + opencodex-loopback（CLI 自管） | CLI 自带；注入用环境变量；Credential Manager 经 ctypes+wincred（标注例外） |
| 进程树终止 | psutil | psutil + TerminateProcess（无 SIGTERM，实测中断语义） |
| daemon 分离启动 | start_new_session=True | DETACHED_PROCESS + CREATE_NEW_PROCESS_GROUP（pythonw 避免控制台窗口） |
| CLI 二进制 | PATH / ~/.grok/bin | shutil.which + PATHEXT |
| 路径 | ~/.grok、~/.codex | Path.home() + GROK_HOME/CODEX_HOME 覆盖 |

四 CLI 的 Windows 安装情况尽早实测（omp 未知）；缺失载体报结构化错误，验收口径调整为"Windows 支持可用载体子集"。

**稳定性**：多会话隔离（agents/events 带 session_id；/root 按会话命名空间；list/get_usage 默认按会话过滤；SSE 事件带 session_id）；daemon 崩溃恢复（终止孤儿进程树 → daemon_restart 标记，SQLite 回放补齐，可 resend 不可 resume）；并发操作幂等；错误处理（结构化错误 root_cause_hint + next_actions；SSE 断线重连 + dedupe）。

**部署与迁移（三主载体注册）**：
1. 代码落位 `~/.codex/agent-mcp/`（或项目目录 + 安装脚本拷贝）
2. 三主载体注册同一 MCP server：codex config.toml `[mcp_servers.agent-mcp]`（旧 grok-cli 删除）；claude `~/.claude.json` 或项目 `.mcp.json`；omp `~/.omp/agent/` MCP client 配置（实现时按 omp 实际格式实测）
3. 主载体识别：MCP initialize 握手 `clientInfo.name` → session_id 与 host 绑定，网页区分显示
4. 工具改名 breaking change：旧 9 工具 → 新 8 工具；旧 skill/提示词按映射表迁移
5. 升级：备份旧文件 → 更新注册 → 重启各主载体会话；回滚：恢复旧文件 + 旧注册
6. 网页 `http://127.0.0.1:8765/`（仅本地回环）

**测试策略**：单元（四 CLI 事件适配器 fixture、状态机、参数校验、权限映射、退出码判定表）；集成（真实 CLI 冒烟可选开关、认证检测、daemon 拉起/重连/崩溃恢复）；前端（无头浏览器断言渲染 + SSE 驱动更新）；跨平台 CI（Win + Mac：进程树终止、daemon 拉起、token 对账）。

## 8. 验收标准对照

| 标准 | 对应设计 | 验证方式 |
|---|---|---|
| 任务池四 CLI 派发全通 | §3 工具面 + 能力矩阵 | 主载体依次 spawn claude/grok/opencode/omp 真实任务 |
| 三主载体可用 | §7 三套注册 + host 识别 | omp/codex/claude 三端 MCP 注册生效、skill 三端可加载 |
| 监控网页达标 | §5 前端 | 实时活动/任务数/token 曲线/导图展开（只读） |
| skill 开箱即用 | §6 skill | 新会话主 agent 按六步工作流自动编排 |
| 数据准确性 | §4 usage + dedupe + 口径标注 | 与各 CLI 自带 usage 对账（派发侧估算） |
| 性能好内存低 | 标准库 daemon + SSE + 无框架前端 | 常驻 <100MB、页面响应 <1s |
| MCP 稳定 | §7 稳定性 + 保留策略 + 迁移 | 中断、超时、daemon 重启、多会话并发回归 |
| Win / Mac 可用 | §7 跨平台抽象 | 双平台 CI 冒烟（进程树、拉起、对账） |

## 9. 参考

- Codex Multi-agent V2：openai/codex PR #17338（工具面 spawn_agent/send_message/followup_task/wait_agent/interrupt_agent/list_agents）；learn.chatgpt.com/api/docs/guides/responses-multi-agent；subagents 文档；config-reference
- Anthropic Managed Agents：platform.claude.com/docs/en/managed-agents/（事件协议、idle+stop_reason 状态机、model_usage 四字段、parent 链路、增量双轨）
- 开源参考：disler/claude-code-hooks-multi-agent-observability（SQLite+WS+Vue 架构）；claude-agent-sdk-python；dagre/手写 SVG 轻量布局
- 现状：~/.codex/mcp-servers/grok_cli_mcp.py（v1.4.0，9 工具，dispatch worker 模式）

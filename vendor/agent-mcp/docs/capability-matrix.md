# 四 CLI 能力矩阵（实测记录）

> 更新原则：每项标 ✅=已实测 / ⏳=待实测。实现 Task 0 时逐项确认。
> 2026-08-13 复核（v0.3 Phase 0）：新增适配器 codex/kimi/copilot/pi/zcode/cline 事件归一化
> 已由 `tests/test_event_normalization.py` fixture 校准 ✅（zcode/cline 为降级文本捕获模式）；
> 表中能力项 ⏳ 表示真实 CLI 环境待实测（fixture 不替代真实环境），不影响适配器归一化可信度。
> **2026-08-24 实测状态声明（B2 诚实化）**：以下 ⏳ 项仍未清偿，引用本矩阵时请连同本声明——
> zcode/cline 降级文本捕获的真实环境验证、omp/opencode 的 resume 续接实测、grok 首启
> >120s 的超时预算标定。usage 结算语义已显式化：omp/opencode=`cumulative`，
> 其余内置适配器=`authoritative`（见 `BaseAdapter.usage_semantics` 与
> tests/test_b2_usage_contract.py）。

| 能力 | claude (2.1.220) | grok (0.2.118) | opencode (1.14.51) | omp(pi) |
|---|---|---|---|---|
| 事件流格式 | `-p --output-format stream-json --verbose` ✅ | `--single --output-format streaming-messages-json` ✅（事件行仅 system/assistant/result 三种，无 message_start） | `run --format json` ✅（事件带 `type` + `sessionID` 字段；默认 provider key 401 失效，需指定 opencodex 模型） | `-p --mode=json` ✅（`/Users/cc/.bun/bin/omp` v17.2.4） |
| result 结构 | `stop_reason` / `session_id` / `total_cost_usd` / `usage`(input/cache_creation/cache_read/output) / `modelUsage`(按模型拆分含 costUSD) —— **嵌套在 `result` 字段内** ✅ | `stop_reason` / `session_id` / `total_cost_usd` / `usage`(input/cache_read/cache_creation/output/server_tool_use) / `modelUsage` —— **全在顶层**，`result` 字段仅为最终文本 ✅（实测修正：snake_case 非 camelCase） | 事件流（message/tool/error/done），usage 字段待实测 | `session`(id)/`agent_start`/`turn_start`/`message_start`(assistant 含 usage{cost.total} + stopReason + model + responseId)/`message_update`(text_delta 增量)/`message_end` ✅ |
| 流式输入（运行中注入） | `--input-format stream-json` ✅ | ⏳ | SDK SSE ✅ / CLI ⏳ | `--mode=rpc` 双向 ✅（rpc-ui 亦可） |
| resume / 会话续接 | `--resume session_id` ✅ | `--resume <session_id>`（-c 续最近会话）✅ | ⏳ | `--profile` 隔离 / session id（待实测 resume flag） |
| 权限模式 | plan / acceptEdits / `--dangerously-skip-permissions` ✅ | plan / acceptEdits / bypassPermissions + `--always-approve` ✅ | `-m plan` / allow 规则 / `-y` ⏳ | `--plan-yolo` / `--allow-home`（权限机制待实测） |
| 首启耗时 | 快（~3s）✅ | 慢（首次模型发现 >120s，之后快）✅ | ⏳ | 快（~5s）✅ |
| 子代理控制 | `--agents <json>` / `--no-subagents` 未知 | `--agent <name>` / `--agents <json>` ✅ | 内置 subagent | `--smol/--slow/--plan` 模型角色 + 未知 |
| 模型角色 | `--model` 单模型 | `-m` 单模型 | `--model` 单模型 | `--model/--smol/--slow/--plan` 四角色（env PI_*），默认 deepseek-v4-pro via opencodex ✅ |
| Windows 二进制 | npm shim ⏳ | ⏳ | npm shim ⏳ | bun 安装 ⏳ |

## 关键结论

1. **claude 与 grok 的 result/usage 结构同构**（stopReason/sessionId/usage 四字段 + modelUsage 按模型拆分）→ 一个解析器覆盖两 CLI（适配器层各自归一化即可）
2. **omp 的事件流最完整**：`message_start` 自带 usage（含 cost.total 成本）+ stopReason + model + `message_update.text_delta` 原生增量 → 打字机预览零成本；`--mode=rpc` 支持双向注入
3. grok 的 usage 含 `reasoning_tokens`（claude 无）；omp 的 cache 字段是 cacheRead/cacheWrite（非 cache_read/cache_creation）——归一化时各自映射，忽略未知字段
4. grok 首次初始化慢（模型发现）：spawn 时 timeout 预算需预留（>120s），或常驻预热
5. 三主载体注册：codex config.toml ✅（已知）；claude .mcp.json ✅（已知）；omp `~/.omp/agent/` MCP client 配置 ⏳（日志已确认支持 MCP 加载）
6. omp 二进制在 `~/.bun/bin/omp`（bun 安装）——Windows 安装路径待实测

## 新增适配器（2026-08-12 接入，⏳ 待实测）

> 依据官方文档/社区调研实现，字段细节待真实输出校准；见 `agent_mcp/cli_adapters.py` 各适配器 docstring。

| 适配器 | headless 命令 | 事件流 | resume | 权限 | 备注 |
|---|---|---|---|---|---|
| codex | `codex exec --json <prompt>` | JSONL：`thread.started`/`item.*`（assistant_message/command_execution…）/`turn.completed`（usage: input/cached→cache_read/output/reasoning） | `codex exec resume --last` / `<thread_id>` | 默认只读沙箱；`--sandbox workspace-write`；`--dangerously-bypass-approvals-and-sandbox` | 字段名有版本漂移（item_type→type），解析兼容两种；归一化 ✅（fixture） |
| kimi | `kimi -p <prompt> --output-format stream-json` | JSONL（仿 claude/grok：assistant/result 行） | `-S/--session <id>`、`-c` 续最近 | `-p` 与 `--yolo/--auto/--plan` 互斥：非交互默认 auto | npm `@moonshot-ai/kimi-code`；归一化 ✅（fixture，复用 claude 解析） |
| copilot | `copilot -p <PROMPT>` | 文本捕获（无 JSONL 文档化）+ `--resume=` 摘要回填 session | `--resume=<id>` / `-c` | `--allow all`（=COPILOT_ALLOW_ALL） | 新一代 github/copilot-cli；`gh copilot` 已弃用；归一化 ✅（fixture，降级文本模式） |
| pi | `pi --mode json <prompt>` | JSONL：首行 `session{id}` + `message_end`（权威 message）/`agent_end` | `pi -c` / `--session <id>` | ⏳ | **Pi 与 omp 是两个项目**；npm `@earendil-works/pi-coding-agent`；归一化 ✅（fixture） |
| zcode | `zcode --prompt <prompt>` | 文本捕获（headless 路径未实证；GUI 走 app-server 协议） | `--session <id>`（⏳） | ⏳ | CLI 直连有 401 认证障碍；**降级模式**：文本捕获（fixture ✅） |
| cline | `cline --prompt <prompt>` | 文本捕获 | `--resume <id>`（⏳） | ⏳ | 主要 VS Code 扩展；独立 CLI headless 不明确；**降级模式**：文本捕获（fixture ✅） |

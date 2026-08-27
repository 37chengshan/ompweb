# 自定义 CLI 适配器（无需改代码）

> Agent MCP 内置 claude / grok / opencode / omp / atomcode 等适配器；遇到不在内置列表里的
> 新 CLI，**不用改任何代码**——写一份 JSON 配置放进 `<state_dir>/custom-clis/`，daemon 启动时
> 自动加载注册，`spawn_agent(target_cli=<你的名字>)` 立即可用。
>
> `state_dir` 默认 `~/.codex/agent-mcp`（可被 `AGENT_MCP_HOME` / `CODEX_HOME` 覆盖）。

## 1. 模板（复制即改）

```json
{
  "cli_name": "mycli",
  "bins": ["mycli", "~/.local/bin/mycli"],
  "first_start_seconds": 10,
  "command": {
    "prefix": ["-p", "--output-format", "stream-json"],
    "permission_flags": {
      "plan": ["--permission-mode", "plan"],
      "acceptEdits": ["--permission-mode", "acceptEdits"],
      "fullAccess": ["--dangerously-skip-permissions"]
    },
    "model_flag": ["--model", "{value}"],
    "resume_flag": ["--resume", "{value}"]
  },
  "parse": {
    "mode": "jsonl",
    "event_field": "type",
    "message_types": ["assistant"],
    "message_text_path": "message.content",
    "result_types": ["result"],
    "usage_path": "usage",
    "cost_path": "total_cost_usd",
    "session_id_path": "session_id",
    "stop_reason_path": "stop_reason"
  }
}
```

## 2. 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `cli_name` | ✅ | `spawn_agent` / `followup_task` 使用的 `target_cli` 名字 |
| `bins` | — | 二进制探测顺序（PATH 优先，可写 `~` 绝对路径兜底）；缺省 `[cli_name]` |
| `first_start_seconds` | — | 返回给主 Agent 的 `min_expected_seconds`（缺省 10） |
| `usage_semantics` | — | usage 结算语义：`authoritative`（最后一条非空 usage 即权威总量，默认）或 `cumulative`（每条为至今累计）。daemon 据此统一结算，禁止二次累加。完整示例见 [custom-cli-examples/](custom-cli-examples/) |
| `command.prefix` | — | 固定前置参数；`{cwd}` 占位替换为工作目录 |
| `command.permission_flags` | — | 按 `permission_mode`（plan/acceptEdits/fullAccess）追加的参数 |
| `command.model_flag` | — | 传 `model` 时追加；`{value}` 替换为模型名 |
| `command.resume_flag` | — | 传 `resume` 时追加；`{value}` 替换为 session id |
| `parse.mode` | — | `jsonl`（默认，逐行 JSON 事件）或 `text`（纯文本捕获） |
| `parse.event_field` | jsonl | 事件类型字段名（缺省 `type`） |
| `parse.message_types` | jsonl | 视为消息的事件类型 → `agent.message` |
| `parse.message_text_path` | jsonl | 消息文本点路径（如 `message.content`；content 可为块数组） |
| `parse.result_types` | jsonl | 终局事件类型 → 提取 usage + 产出 `agent.terminated` |
| `parse.usage_path` | jsonl | usage 对象点路径 |
| `parse.cost_path` | jsonl | 成本字段点路径（缺省 0） |
| `parse.session_id_path` | jsonl | 会话 id 点路径（供 resume 回填；可省） |
| `parse.stop_reason_path` | jsonl | 终止原因点路径（缺省 `end_turn`） |
| `parse.skip_prefixes` | text | 跳过的前缀行（如 `[tokens]` / `[done]`） |
| `parse.usage_regex` | text | 可选 named-group 正则提取 usage，如 `\[tokens\] prompt=(?P<input_tokens>\d+) completion=(?P<output_tokens>\d+)` |

## 3. 如何让 AI 帮你生成配置

把下面这段提示词发给任意 AI（它会照本文件生成一份 JSON）：

```text
请根据 docs/custom-cli.md 的模板，为 <CLI 名字> 生成一份 custom-clis 配置 JSON。
要点：
1. cli_name / bins 按实际二进制填；
2. 告诉我它的非交互（headless）命令与输出格式（JSONL 事件 or 纯文本）；
3. 若为 JSONL：给出 message 事件类型、文本点路径、usage/成本/session_id 字段路径；
   若为纯文本：给 skip_prefixes 和 usage_regex；
4. 生成的 JSON 写到 <state_dir>/custom-clis/<name>.json，然后重启 daemon。
```

## 4. 验证

```bash
# 1) 语法自检：直接 import 触发注册（无 custom-clis 目录则空跑）
python3 -c "from agent_mcp.cli_adapters import load_custom_adapters, adapter_names; \
print(load_custom_adapters('~/.codex/agent-mcp')); print(adapter_names())"

# 2) 重启 daemon 后确认注册日志
python3 start_agent_mcp.py --restart   # 若有该参数；或手动重启
# stderr 应出现: [cli_adapters] registered custom CLI adapter: mycli <- .../mycli.json

# 3) MCP 层验证 target_cli 已出现在 enum
# spawn_agent 的 inputSchema.target_cli.enum 会包含自定义名（mcp_server 启动时同目录加载）
```

## 5. 常见问题

- **配置坏了会不会拖垮 daemon？** 不会——单个文件加载失败仅 stderr 告警，其余配置与内置适配器照常。
- **自定义 CLI 支持 resume 吗？** 取决于 `parse.session_id_path` 与 `command.resume_flag`：两者都配了即可 resume；缺任一则 resume 透传无效（terminated 不会回填 cli_session_id）。
- **改配置要重启吗？** 要——daemon 启动时扫描一次 `custom-clis/`。
- **文本模式拿不到 usage？** 配置 `parse.usage_regex`（named-group 需用 `input_tokens` / `output_tokens` / `cache_creation` / `cache_read` / `cost_usd` 命名，自动归一化）。

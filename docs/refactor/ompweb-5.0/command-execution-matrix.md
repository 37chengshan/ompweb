# OMP 命令执行矩阵（5.0 doc 08 Slice 3）

三个正交问题的登记表：**Discovery**（palette 可见）≠ **Availability**（本 head 可执行）≠ **Execution**（走哪条通路）。`toSlashCommandInfo` 已去掉 builtin 过滤——新装 OMP 命令自动出现在 `ompBuiltin` 分组；本矩阵决定每个命令的执行通路与可用性标签。标签值固定为：`structured_rpc` / `client_action` / `prompt_local` / `tui_only` / `unknown`。

## Web client 自有命令（client_action；客户端拦截，不进 Agent）

| 命令 | 通路 | 备注 |
|---|---|---|
| `/copy` | client_action | 复制最近回复到剪贴板 |
| `/reload` | client_action | 重载 transcript |
| `/session` | client_action | 会话切换器 |
| `/settings` | client_action | 打开设置 |
| `/model` | structured_rpc | `set model` RPC（值来自 models registry） |
| `/thinking` | structured_rpc | thinking level RPC |
| `/tools` | structured_rpc | host tool 预设更新 |
| `/advisor` | client_action | 每会话开关（Settings 联动） |

## OMP builtin（registry 完整呈现；执行通路按 OMP 能力）

| 命令族 |通路 | 备注 |
|---|---|---|
| compact | structured_rpc | RPC `compact`；结果经 `command_output` 回显 |
| name / session title | structured_rpc | `set_session_name` RPC |
| branch / navigate | structured_rpc | 树导航 RPC |
| 模型/思考档位查询 | structured_rpc | `config_update` / `model_changed` 帧回填 |
| 其余已测 prompt-local | prompt_local | 走 prompt 通路；观察 `prompt_result.agentInvoked` + `command_output`；fixture 见 contract 套件 |
| TUI-only / 语义未知 | tui_only / unknown | palette 展示"此客户端不支持"，**绝不静默模拟**（doc 08） |

## 不变量（由测试冻结）

1. Registry 全量呈现：builtin 不被过滤（`lib/command-registry.test.mjs`）。
2. 客户端拦截的命令在 palette 去重（ChatInput `CLIENT_BUILTIN_COMMAND_NAMES`）。
3. availability 不猜测：RPC 没给的字段一律 unknown，UI 不伪造可执行性。
4. 上游给出结构化 execute RPC 后，prompt_local 行逐个迁移（feature probe 优先）。

## 与 HostUIRequest 的关系

Extension 注册的斜杠命令可能触发 `extension_ui_request`（select/confirm/input/editor）。
其生命周期 contract（单次 settle、超时、取消、断连）冻结于 `lib/contracts/ui-request.ts`
+ `lib/ui-request-contract.test.mjs`。

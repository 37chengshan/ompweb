# 08 — OMP Native Command Registry 与执行语义

## 目标

完整消费 OMP runtime command metadata，动态更新 palette，并只在 OMP 明确支持的 head/执行路径上执行原生命令。Web 自有命令保留，但不再用 prompt 模拟 OMP 已有语义。

## 当前事实

- OMP `18.0.10` RPC 启动会发送 `available_commands_update`，并支持 `get_available_commands`；metadata 已含 name、aliases、description、input hint、subcommands、source。
- [`lib/rpc-manager.ts`](../../../lib/rpc-manager.ts) 已把 Web `get_commands` 映射到 OMP RPC。
- [`hooks/useAgentSession.ts`](../../../hooks/useAgentSession.ts) 的 `toSlashCommandInfo()` 当前明确丢弃 `source === "builtin"`。
- [`components/ChatInput.tsx`](../../../components/ChatInput.tsx) 已预留 `ompBuiltin` 分组，但因为上游 mapping 过滤，实际收不到完整 builtin。
- [`lib/web-slash-commands.ts`](../../../lib/web-slash-commands.ts) 会把部分 Web 命令扩为 prompt。
- OMP 官方 RPC 当前支持 command metadata 和 builtin side-channel，但没有通用结构化 `execute_slash_command` 命令。[OMP RPC reference](https://github.com/can1357/oh-my-pi/blob/main/docs/rpc.md)

## 分离三个问题

1. **Discovery**：命令存在、描述、来源、alias、subcommand。
2. **Availability**：当前 RPC/Web/Mobile head 是否能执行，是否需要 UI host。
3. **Execution**：agent text、OMP builtin、extension、prompt template、纯 Client action 分别如何运行。

Discovery 完整不等于所有命令都可以远程执行。

## Normalized Contract

```ts
interface CommandDefinition {
  id: string;
  name: string;
  aliases: string[];
  description?: string;
  inputHint?: string;
  subcommands?: Array<{ name: string; description?: string; usage?: string }>;
  source: "builtin" | "extension" | "skill" | "prompt" | "mcp_prompt" | "client" | "unknown";
  invocation: "agent_text" | "omp_command" | "extension" | "prompt_template" | "client_action" | "unknown";
  availability: {
    rpc: "yes" | "no" | "unknown";
    remote: "yes" | "no" | "unknown";
    mobile: "yes" | "no" | "unknown";
  };
  securityClass: "read" | "mutating" | "dangerous" | "unknown";
  provider?: string;
  shadowedProviders?: string[];
  revision: string;
}
```

现有 OMP metadata 没有 availability/security/precedence 全量信息时保持 unknown，并应用保守策略。

## 执行策略

### Client action

`/settings`、`/copy`、`/reload` 等真正属于 ompweb UI 的行为直接调用 Client API，不发送 Agent prompt。名称冲突时必须在 palette 显示来源。

### Agent text / prompt template

按 OMP input semantics 发送；保留原始 source/args，不能提前展开出不同语义。

### OMP builtin

短期：

- 所有 builtin metadata 可展示；
- 已有结构化 RPC（compact、set model、branch 等）继续走对应 RPC；
- 对已通过当前 OMP range contract test 的 local command，可走 prompt command 并观察 `prompt_result.agentInvoked`、`command_output`、`config_update`；
- TUI-only 或 unknown command 只显示“不支持此客户端”，不静默模拟。

长期：推动 OMP 提供结构化 command execute/capability metadata；ompweb 只做 adapter，不 fork builtin registry。

### Extension / HostUIRequest

复用现有 `extension_ui_request`/response，统一 confirm/select/input/editor；超时、abort、disconnect、reconnect 都有确定结果。Remote 客户端执行前再做 05 capability + command security class 检查。

## Precedence

- 展示顺序和实际 active provider 必须来自 OMP registry 结果；
- 如果上游只返回 resolved command 而没有 shadow metadata，UI 不伪造 shadow list；
- Web client 自有命令使用显式 namespace/id，不能静默覆盖 OMP builtin；
- alias collision 和动态 add/remove 跑固定 fixture。

## 实施切片

1. 去掉 builtin 过滤，完整保留 OMP metadata、aliases、subcommands、source。
2. Palette 用现有样式显示 Native OMP 分组，不改布局/动画。
3. 建 execution matrix：每个当前 builtin 标记 structured RPC、tested prompt-local、TUI-only/unknown。
4. 把 web prompt-emulated commands 分为真正 client action 与临时 compatibility；逐个退出重复语义。
5. HostUIRequest contract 化，并覆盖 reconnect/timeout。
6. 加 capability/security gate 和 mutation receipt。
7. 上游出现结构化 execute 后 feature probe 切换；旧 OMP 保留 allowlisted fallback。

## 测试

- 当前 OMP `get_available_commands` 完整 fixture，确保 builtin 不被过滤；
- startup update、dynamic add/remove、aliases/subcommands；
- 名称碰撞、重复 provider、未知 source；
- local-only command 不错误启动 Agent turn；
- TUI-only command 不伪装成功；
- UI request confirm/select/input/editor 的 success/cancel/timeout/reconnect；
- viewer/operator/power-user capability deny；
- palette 的截图、键盘导航、进入/退出动画无回归。

## 退出标准

- installed OMP 新增可发现命令后，无需发新 ompweb 版本即可在 palette 出现；
- 显示与可执行性分开，unsupported 命令有明确原因；
- OMP 原生命令不再由 Web prompt 文本长期仿制；
- 运行时 registry 更新无需刷新页面；
- Desktop/Web/Mobile 消费同一 registry 和权限结果；
- 视觉风格、交互顺序和动效保持现状。

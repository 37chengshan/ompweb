# Installer 覆盖调研：主流 AI Coding Agent CLI 的 MCP 注册方式

**日期：** 2026-08-13
**目的：** 为 `install.py` 扩展"全覆盖市面上主流 agent CLI 的 MCP 注册"做只读调研。
**方法：** web_search + 直接读取官方文档 / GitHub 源码（aider 的 args.py/commands.py、aichat 的 Cargo.toml/config.example.yaml 为当日 main 分支实测）。
**范围：** 21 个 CLI（现有 6 载体 + 15 个新增调研对象）。
**约定：** "同构"指 MCP 注册的数据结构（顶层键 + 每 server 字段形状）与现有 6 个注册函数之一一致，可直接复用现有函数/仅换路径；"需新增"指结构不同，需写新注册函数。

---

## 0. 基线：install.py 现有 6 个载体（install.py 实测）

| CLI | 配置文件（默认） | 注册格式 | 注册函数（install.py） | SessionStart hook | Headless |
|---|---|---|---|---|---|
| codex | `~/.codex/config.toml`（`CODEX_HOME`） | TOML `[mcp_servers.<name>]`（command/args/startup_timeout_sec） | `codex_registration_toml` | ✅ `~/.codex/hooks.json` matcher `startup\|resume` | `codex exec --json`（仓库实测） |
| claude | `~/.claude.json` / 项目 `.mcp.json` | JSON 顶层 `mcpServers`（command/args） | `claude_registration_json` | ✅ `~/.claude/settings.json` hooks.SessionStart | `claude -p --output-format stream-json`（仓库实测） |
| omp | `~/.omp/agent/mcp.json`（`PI_CODING_AGENT_DIR`） | JSON `mcpServers`（type=stdio/command/args/timeout/requestIdFormat/enabled） | `omp_registration_json` | ❌（懒启动） | `omp --print --mode json`（仓库实测） |
| opencode | `~/.config/opencode/opencode.json` | JSON `mcp.<name>` = {type: local, command:[命令+参数数组], enabled} | `opencode_registration_json` | ❌（懒启动） | `opencode run --format json`（仓库实测） |
| kimi | `~/.kimi-code/mcp.json`（`KIMI_CODE_HOME`） | JSON 顶层 `mcpServers`（command/args） | `kimi_registration_json` | ❌（懒启动） | `kimi -p --output-format stream-json`（仓库实测） |
| zcode | `~/.zcode/cli/config.json` | JSON `mcp.servers`（command/args/env） | `zcode_registration_json` | ❌（懒启动） | `zcode --prompt`（待实测） |

**可复用的三个"同构模板"：**
- **A 模板（claude/kimi 型）**：顶层 `mcpServers`，server = {command, args, env?} —— 生态最广，10+ CLI 同构。
- **B 模板（codex 型）**：TOML `[mcp_servers.<name>]` —— grok 同构。
- **C 模板（opencode 型）**：`mcp.<name>` = {type: local, command: [数组]} —— AtomCode/Kilo 同构。

---

## 1. 调研总表（15 个新增）

| # | CLI | 配置路径（默认） | 格式 | 与现有同构？ | 需新增函数建议 | SessionStart/启动 hook 等价机制 | Headless 可编程调用 | 证据链接 |
|---|---|---|---|---|---|---|---|---|
| 1 | **grok（xAI）** | `~/.grok/config.toml` | TOML `[mcp_servers.<name>]`；另自动合并读取 `~/.claude.json`、`.cursor/mcp.json`、项目 `.mcp.json`（compat，优先级低于 config.toml） | ✅ 同构 **codex（B 模板）**，零改动 | —（复用 codex 函数；可选 `[compat.claude] mcps=false` 关闭兼容源） | 未在官方文档确认 hooks（xAI docs 仅见 MCP/Settings 页） | ✅ `grok -p --output-format streaming-messages-json`（仓库 GrokAdapter 实测） | https://docs.x.ai/build/features/mcp-servers |
| 2 | **cursor** | 项目 `.cursor/mcp.json`；全局 `~/.cursor/mcp.json` | JSON 顶层 `mcpServers`（command/args/env） | ✅ 同构 **claude/kimi（A 模板）** | —（复用 A 模板，仅路径不同） | ❌ 无 SessionStart hooks（IDE 内 agent；无 hook 机制文档） | ✅ `agent -p "prompt"`（cursor CLI，`--output-format text`，脚本/CI 用） | https://cursor.com/docs/mcp 、https://cursor.com/docs/cli/overview |
| 3 | **gemini CLI（Google）** | `~/.gemini/settings.json`（用户）；`.gemini/settings.json`（项目） | JSON 顶层 `mcpServers`：command/args/env/cwd/url(SSE)/httpUrl(streamable HTTP)/headers/timeout/trust/includeTools/excludeTools | ✅ 同构 **claude/kimi（A 模板）**（超集字段，注册只需 command/args） | —（复用 A 模板） | ❌ 无 hooks（settings.json 无 hooks 键，官方配置文档确认） | ✅ `gemini -p`；`output.format: json` | https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html 、https://google-gemini.github.io/gemini-cli/docs/get-started/configuration.html |
| 4 | **pi（earendil-works）** | 标准文件：`.mcp.json`（项目）、`~/.config/mcp/mcp.json`、`~/.agents/mcp.json`；Pi 自有：`~/.pi/agent/mcp.json`（`PI_CODING_AGENT_DIR`）、`.pi/mcp.json`（override） | JSON 顶层 `mcpServers`（command/args + lifecycle/idleTimeout/requestTimeoutMs 等扩展字段） | ✅ 同构 **claude/kimi（A 模板）** | —（复用 A 模板；需先装扩展 `pi install npm:pi-mcp-adapter`；有 `/mcp setup` 一键采纳其他 host 配置） | ❌ 无 SessionStart | ✅ 四种模式（interactive/print/JSON/RPC/SDK）；`pi --print --mode json`（仓库 PiAdapter 实测） | https://pi.dev/packages/pi-mcp-adapter |
| 5 | **copilot（GitHub）** | `~/.copilot/mcp-config.json`（用户）；`.mcp.json`（项目） | JSON 顶层 `mcpServers`（command/args/env） | ✅ 同构 **claude/kimi（A 模板）** | —（复用 A 模板；另有 `/mcp` 交互命令） | ❌ 无公开 SessionStart hooks | ✅ `copilot -p`（仓库 CopilotAdapter 实测） | https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers |
| 6 | **cline** | CLI：`~/.cline/mcp.json`；IDE：`~/.cline/data/settings/cline_mcp_settings.json`；项目 `.cline/` | JSON 顶层 `mcpServers`：stdio {command/args/env/disabled/autoApprove}；remote {type: streamableHttp\|sse, url, headers} | ✅ 同构 **claude/kimi（A 模板）** | —（复用 A 模板；另有 `cline mcp` 向导、`cline config mcp --json`） | ⚠️ 有 hooks（SDK plugins / lifecycle hooks，事件非 SessionStart 语义） | ✅ `cline "task"` 直接 prompt（CLI overview："automated headless workflows"）；`--config` 指定配置 | https://docs.cline.bot/mcp/mcp-overview.md 、https://docs.cline.bot/getting-started/config.md 、https://docs.cline.bot/usage/cli-overview.md |
| 7 | **goose（Block → AAIF/Linux Foundation）** | `~/.config/goose/config.yaml` | YAML `extensions.<name>:` = {name, cmd, args, enabled, type: stdio, timeout, envs}（非 mcpServers！） | ❌ **需新增**（YAML extensions 键，与 6 个均不同构） | `goose_registration_yaml`（合并 extensions 键）；另有 `goose configure` 交互式、`fastmcp install goose` deeplink | ❌ 无 hooks | ✅ `goose run -t "prompt"`（text 非交互） | https://gofastmcp.com/integrations/goose 、https://goose-docs.ai/docs/quickstart |
| 8 | **atomcode（Kilo Code CLI）** | 全局 `~/.config/kilo/kilo.json`；项目 `./kilo.json` / `./.kilo/kilo.json`（`kilo.jsonc`/`config.json` 亦可） | JSON `mcp.<name>` = {type: local, command:[命令+参数数组], enabled, environment?, timeout?}；remote {type: remote, url, headers} | ✅ 同构 **opencode（C 模板）**（差异仅 `environment` vs `env` 键名） | —（复用 opencode 结构，建议新写 `atomcode_registration_json` 以兼容 environment 键） | ❌ 无 SessionStart | ✅ `atomcode -p`（仓库 AtomCodeAdapter 实测）；`kilo mcp list/add` | https://kilo.ai/docs/automate/mcp/using-in-cli |
| 9 | **hermes（Nous Research）** | `~/.hermes/config.yaml`（`HERMES_HOME`） | YAML 顶层 `mcp_servers:`（snake_case）：{command, args, env}；remote {url, headers, auth: oauth} | ⚠️ 结构= A 模板但 YAML+snake_case，**需新增 YAML 渲染**；官方提供 `hermes import-agent claude-code` 直接迁移 `~/.claude.json` 的 mcpServers | `hermes_registration_yaml`（mcp_servers 键）；另有 `hermes mcp install <name>` 目录 | ❌ 无 SessionStart hooks（有 cron/gateway） | ✅ `hermes chat -q "prompt"`（单查询非交互） | https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp 、https://hermes-agent.nousresearch.com/docs/user-guide/cli |
| 10 | **Qwen Code（阿里）** | `~/.qwen/settings.json`（用户）；`.qwen/settings.json`（项目） | JSON 顶层 `mcpServers`：command/args/env/cwd/url/httpUrl/headers/timeout/trust/includeTools/excludeTools（Gemini fork，同 schema） | ✅ 同构 **claude/kimi（A 模板）** | —（复用 A 模板；另有 `qwen mcp add`） | ✅ 支持 hooks（README 宣称与 Claude Code 对齐：Auto-Memory/Auto-Skills/Hooks） | ✅ `qwen -p "..."`（官方 README 表格） | https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/ 、https://github.com/QwenLM/qwen-code |
| 11 | **devin（Cognition）** | 用户 `~/.config/devin/mcp_config.json`（Win `%APPDATA%\devin`）；项目 `.devin/mcp_config.json`；本地 `.devin/mcp_config.local.json`（v3000.3+ 起从主 config 拆出） | JSON 顶层 `mcpServers`：stdio {command/args/env/disabled}；remote {url/transport/headers/oauthClientId/...} | ✅ 同构 **claude/kimi（A 模板）** | —（复用 A 模板；另有 `devin mcp add`；**可直接读 Cursor/Windsurf/Claude Code/Copilot/OpenCode 的 MCP 配置**，无需迁移） | ✅ 有 Lifecycle Hooks（session 生命周期事件） | ✅ `devin -p "prompt"`（--print 非交互，含 `--prompt-file`） | https://docs.devin.ai/cli/extensibility/mcp/configuration.md 、https://docs.devin.ai/cli/reference/commands.md 、https://docs.devin.ai/cli/extensibility/hooks/overview.md |
| 12 | **windsurf（Cognition，现并入 Devin Desktop）** | 全局 `~/.codeium/windsurf/mcp_config.json`；项目 `.windsurf/mcp_config.json` | JSON 顶层 `mcpServers`：{command/args/env}；remote {serverUrl/url/headers}；支持 `${env:VAR}` / `${file:...}` 插值 | ✅ 同构 **claude/kimi（A 模板）** | —（复用 A 模板） | ⚠️ 有 Cascade Hooks（pre/post 命令钩子，非 SessionStart 事件） | ❌ 无公开 headless CLI 文档（agent 主要在 IDE 内） | https://docs.devin.ai/desktop/cascade/mcp.md 、https://docs.sevalla.com/quick-starts/coding-agents/windsurf |
| 13 | **aider** | —（无 MCP 注册点） | 当前 main 实测：args.py 无任何 mcp 选项、commands.py 无 /mcp 命令 | ❌ **不适用**（无原生 MCP client）；生态通过独立项目 aider-mcp-server 把 aider 作为 MCP *server* 暴露给其他 host | 无法注册（建议跳过，或经 aider-mcp-server 反向接入） | ❌ 无 | ✅ `aider --message` / `-m`（单消息后退出） | https://github.com/Aider-AI/aider/blob/main/aider/args.py 、https://github.com/Aider-AI/aider/blob/main/aider/commands.py |
| 14 | **amazon q developer（AWS）** | 全局 `~/.aws/amazonq/mcp.json`；项目 `.amazonq/mcp.json` | JSON 顶层 `mcpServers`：stdio {command/args}；remote {type: http, url} | ✅ 同构 **claude/kimi（A 模板）** | —（复用 A 模板；另有 `qchat mcp add/import`） | ❌ 无公开 hooks | ⚠️ `q chat` 交互为主；headless 未在本次调研中验证 | https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line-mcp-config-CLI.html 、https://awslabs.github.io/mcp/servers/aws-api-mcp-server |
| 15 | **tabby（TabbyML）** | `~/.tabby-client/agent/config.toml` | 仅 `[server] endpoint/token` 等；**无 MCP server 注册点**（tabby-agent 是 IDE 补全/聊天 agent，可作 LSP 暴露，不作 MCP host） | ❌ **不适用** | 无法注册 | ❌ 无 | ⚠️ 非 agent CLI（无 prompt 模式） | https://tabby.tabbyml.com/docs/extensions/configurations/ |
| 16 | **aichat（sigoden）** | `~/.config/aichat/config.yaml`（Linux；macOS `~/Library/Application Support/aichat/config.yaml`） | 当前 main 实测：config.example.yaml / Cargo.toml 均无 MCP 键（README 宣称 "AI Tools & MCP" 走 llm-functions 工具生态） | ❌ **无原生注册点**（间接经 llm-functions） | 无法直接注册（若需支持，须先实测 llm-functions 的 MCP 配置格式） | ❌ 无 | ✅ `aichat <prompt>`（CMD 模式） | https://github.com/sigoden/aichat（README / config.example.yaml / Cargo.toml 当日 main 实测） |
| 17 | **crush（charmbracelet）** | `~/.config/crush/crushrc`（全局）；`./crushrc` / `./.crushrc`（项目） | **bash 风格脚本** + 内建 `mcp add <name> --type stdio\|http\|sse --command ... --args ... --env ... --timeout ...` | ❌ **需新增**（非 JSON/TOML 数据文件，是脚本追加） | `crush_registration_rc`（向 crushrc 追加 `mcp add` 行，需幂等/去重）；另有 crush.json（hooks 位置） | ⚠️ 有 hooks（Claude Code 兼容格式，存 `crush.json` 的 `hooks.PreToolUse`；**暂无 SessionStart 事件**） | ⚠️ 无公开 headless run 文档（有 `crush serve`/logs；TUI 为主） | https://github.com/charmbracelet/crush（README）、https://github.com/charmbracelet/crush/blob/main/docs/hooks/README.md |

> 表中 17 个条目全部附官方文档/GitHub 证据；另 bonus：**Kiro（AWS）** `~/.kiro/settings/mcp.json` 顶层 `mcpServers`（与 A 模板同构，证据同 awslabs 页）。

---

## 2. 分类结论

### 2.1 与现有 6 个同构（零/低改动即可覆盖 —— 11 个）
- **A 模板（mcpServers，复用 claude/kimi 结构）**：cursor、gemini CLI、pi、copilot、cline、Qwen Code、devin、windsurf、amazon q —— 9 个。
  - 实现提示：现有 `claude_registration_json` 产出的 server 对象（command/args）可直接落入这些文件；差异只在**文件路径与合并键**。
- **B 模板（TOML [mcp_servers]，复用 codex）**：grok —— 1 个。现有 `codex_registration_toml` 片段可直接追加到 `~/.grok/config.toml`（xAI 文档明确 Grok 也加载 config.toml 的 [mcp_servers]）。
- **C 模板（mcp 键 + command 数组，复用 opencode）**：atomcode/Kilo —— 1 个。结构一致（type=local/command 数组/enabled），仅 `environment` 键名差异，建议新写薄封装 `atomcode_registration_json` 或在 opencode 函数加参数。

### 2.2 需新增注册函数（3 个）
| CLI | 建议函数名 | 格式要点 |
|---|---|---|
| goose | `goose_registration_yaml` | `~/.config/goose/config.yaml` 合并 `extensions.<name>:` {name, cmd, args, enabled: true, type: stdio, timeout, envs}（YAML，注意保留 provider 等既有顶层键） |
| hermes | `hermes_registration_yaml` | `~/.hermes/config.yaml` 合并 `mcp_servers.<name>:` {command, args, env}（snake_case YAML；与 A 模板字段一一对应，可实现 `_json_to_yaml` 通用转换） |
| crush | `crush_registration_rc` | `~/.config/crush/crushrc`（或项目 crushrc）追加 `mcp add agent-mcp --type stdio --command python3 --args <path>`；需要幂等（已有同名则跳过/替换）与 shell 引号转义 |

### 2.3 无注册点 / 不适用（3 个）
- **aider**：无原生 MCP client（args.py/commands.py 实测）；若用户要求，唯一路径是反向把 aider 接成别的 host 的 MCP server（aider-mcp-server 项目），不属于本 installer 范围。
- **tabby**：配置仅 server endpoint，无 MCP 注册点。
- **aichat**：MCP 经 llm-functions 间接使用，无原生 config 键（低置信，建议实测确认后决定是否支持）。

---

## 3. 给 install.py 的落地建议（按性价比排序）

1. **P0 —— 零代码扩展（仅加 HOSTS 与路径映射）**：grok（复用 codex TOML 函数）、cursor / windsurf / copilot / qwen / gemini / devin / cline / amazon q（复用 A 模板注册对象，路径表 +1 行）。
2. **P1 —— 薄封装**：atomcode（opencode 结构 + environment 键）；pi（A 模板 + 提示先装 pi-mcp-adapter 扩展）。
3. **P2 —— 新注册函数**：goose（YAML extensions）、hermes（YAML mcp_servers）、crush（crushrc 脚本追加）。
4. **P3 —— 明确跳过并文档化**：aider、tabby、aichat（报告标注原因）。
5. **机制红利（跨 host 自动可见）**：
   - **devin CLI** 可直接读取 Cursor/Windsurf/Claude Code/Copilot/OpenCode 的 MCP 配置（官方 Configuration Import）——装好 claude 后 devin 自动可见；
   - **grok** 兼容读取 `~/.claude.json`/`.cursor/mcp.json`/`.mcp.json`（compat）——装好 claude/cursor 后 grok 亦可见；
   - **hermes** 提供 `hermes import-agent claude-code` 一键迁移 claude mcpServers；
   - **pi** 的 `/mcp setup` 可采纳宿主配置。
   - 因此"装 claude 一族"能顺带覆盖 grok/devin/pi/hermes 的用户侧可见性 —— 可在 install.py 提示文案中说明。

---

## 4. 证据链接清单

- grok：https://docs.x.ai/build/features/mcp-servers
- cursor：https://cursor.com/docs/mcp ；https://cursor.com/docs/cli/overview
- gemini：https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html
- pi：https://pi.dev/packages/pi-mcp-adapter
- copilot：https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers
- cline：https://docs.cline.bot/mcp/mcp-overview.md
- goose：https://gofastmcp.com/integrations/goose
- atomcode/kilo：https://kilo.ai/docs/automate/mcp/using-in-cli
- hermes：https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp
- Qwen Code：https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/
- devin：https://docs.devin.ai/cli/extensibility/mcp/configuration.md
- windsurf：https://docs.devin.ai/desktop/cascade/mcp.md
- aider：https://github.com/Aider-AI/aider/blob/main/aider/args.py
- amazon q：https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/command-line-mcp-config-CLI.html
- tabby：https://tabby.tabbyml.com/docs/extensions/configurations/
- aichat：https://github.com/sigoden/aichat
- crush：https://github.com/charmbracelet/crush

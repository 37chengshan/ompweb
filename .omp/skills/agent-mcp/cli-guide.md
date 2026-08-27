# CLI 选型指南（Agent CLI 能力矩阵）

> **本文件是派发选型的唯一权威参考**：`spawn_agent(target_cli=...)` / `followup_task` 选载体、选模型、估等待节奏时对照本表。
> **时效**：2026-08 快照（模型/分数随发布变动，用前可复查）；分数为第三方或厂商自报基准，仅供参考。
> **用法**：先按「任务类型 → 首选/次选」表快速定位，再看各 CLI 能力详情确认，最后回 SKILL.md §3 匹配 target_cli。
> **客观基准快照**：第三方聚合指数（Artificial Analysis via OpenRouter，as_of 2026-08-19）与成本档位速查见
> [docs/research/harness-model-benchmarks-2026-08-24.md](../docs/research/harness-model-benchmarks-2026-08-24.md)——
> 数据仅供参考，最终 CLI × 模型组合始终由调用方显式指定。

---

## 0. 一句话选型

| 你的任务 | 首选 target_cli | 次选 | 理由 |
|---|---|---|---|
| 复杂多文件重构 / 深推理 / 质量优先 | claude | omp(slow) | SWE-bench 顶级、一把过率最高，省多轮修补 |
| 并行批量 / token 敏感 / 自动化流水线 | codex | opencode | Token 效率最高（~1×）、并行子代理、审批门禁 |
| 大仓库探索 / 零成本试水 / 架构理解 | gemini(免费) / opencode | kimi | 1M 上下文 + 免费额度；模型无关随便接 |
| 前端 / IDE 实时补全 / 设计稿转代码 | cursor | codex | Tab 补全 <100ms、截图转代码 |
| LSP/DAP 重度项目（TS/Rust/Go/C++） | omp | cursor | 14 个 LSP 操作、28 个 DAP 操作、hashline 编辑 |
| 视频演示/录屏 → 代码 | kimi | — | 原生视频输入，看演示动手写 |
| 长程任务稳定推进 / 开源模型 | zcode | atomcode | GLM-5.2 长程适配、目标模式、bot 远程控制 |
| 国产模型 / 代码图谱读大仓库 | atomcode | zcode | 任意 OpenAI 兼容 API + 8 个代码图谱工具 |
| 计划纪律强制的复杂任务 | grok | claude | plan 模式先探索后批准，/skillify 捕获流程 |
| 跨 IDE 全覆盖 / GitHub 生态 | copilot | codex | VS Code/JetBrains/Neovim/Xcode 全支持 |

---

## 1. 按「任务性质」匹配（与 SKILL.md 第四步呼应）

| 任务性质 | 推荐 CLI | 说明 |
|---|---|---|
| **读密集**（探索/审查/搜索/调研） | omp(smol) / grok / opencode / kimi | 快模型小步跑；omp smol 角色专门做廉价 fan-out |
| **写密集**（改代码/写文件） | claude / codex / omp | 编辑命中率高（claude 一把过；omp hashline 抗空白差异） |
| **深推理**（规划/架构/疑难 bug） | claude / omp(slow) / grok | 强模型深推理；omp slow 角色、grok plan 模式 |
| **并行 fan-out**（无依赖子任务） | codex / opencode / grok | 原生并行子代理、worktree 隔离 |
| **验证/测试/CI 自动化** | codex / copilot | headless 脚本化、沙箱、GitHub Actions 集成 |
| **长任务持续执行**（long-horizon） | zcode / kimi | 1M 上下文 + 目标模式/会话压缩 + cron 定时 |
| **跨模型工作流**（同一套定义跑多家） | opencode / atomcode | 模型无关：AGENTS.md/skill 格式通用 |

---

## 2. 各 CLI 能力详情

### claude（Claude Code，Anthropic）

- **默认模型**：Claude Opus 5（2026-07-24 起）；可选 Sonnet 5 / Fable 5
- **基准**：Terminal-Bench 2.1 ≈ 89.1%（Opus 5 max effort）；SWE-bench Pro 80.3%（Fable 5，厂商自报）
- **擅长**：深推理与复杂重构（"一把过"率高，少多轮修补）；长任务稳定性；多文件/多模块改动
- **生态**：SKILL.md 标准原创者，子 Agent、Plan 模式、CLAUDE.md 记忆、hooks、skills、Routines 定时任务、云会话
- **短板**：单供应商锁定（只跑 Anthropic 模型）；token 消耗约 4×（但首次通过率高，综合成本未必最高）
- **派发建议**：质量优先的写密集与深推理任务首选；`permission_mode` 写文件才升档

### codex（Codex CLI，OpenAI）

- **默认模型**：GPT-5.6 Sol（2026-07-09 GA，medium effort）；extra-high 达 89.5% Terminal-Bench 2.1
- **三档模型**：Sol（硬任务 $5/$30 每 1M）、Terra（日常 $2/$12）、Luna（高量 $0.2/$1.2）——按任务难度选档
- **擅长**：benchmark 天花板；Token 效率最高（约 1×）；并行子代理（分支线程 + /agent）；explorer/worker/reviewer 内置角色；审批门禁（沙盒越权弹窗）；截图转代码；云端自动代码审查
- **生态**：Apache-2.0 开源（openai/codex，104k stars）；CLI/IDE/Web/桌面/iOS 多端
- **短板**：生态较 claude 小；agent-paired 分数随模型档位浮动
- **派发建议**：token 敏感、并行批量、自动化/CI 场景首选；企业级审批门禁场景

### gemini（Gemini CLI / Antigravity，Google）

- **默认模型**：Gemini 3.1 Pro / 3 Flash 自动路由；1M 上下文；Google Search grounding
- **基准**：Terminal-Bench 2.1 ≈ 70.7%（Gemini 3.1 Pro 配对）
- **擅长**：大仓库探索与架构理解；免费额度（原 1000 req/day 个人账号，2026-06-18 起个人免费迁移到 Antigravity CLI）；性价比约 2×
- **短板**：编程基准低于第一梯队；个人免费通道已切换（企业 Code Assist 不变）
- **派发建议**：读密集探索、零成本试水首选；动手改代码再切 claude/codex

### opencode（OpenCode，Anomaly）

- **定位**：模型无关（任意 provider：GPT/Claude/Gemini/Ollama/LM Studio 本地模型）；MIT，193k stars（开源最星标 agent）
- **内置**：Plan Agent / Build Agent（单会话 tab 切换）；SKILL.md 共享格式；MCP、LSP、子 Agent；open code Zen 精选模型列表
- **擅长**：同一套 Agent 定义/技能/工作流跨所有模型家族运行；免费；跨模型一致性
- **短板**：比 claude 年轻、功能面较薄；模型无关拖慢功能迭代
- **派发建议**：跨模型工作流、预算敏感、需要本地模型（Ollama）时首选

### cursor（Cursor，IDE 优先）

- **定位**：IDE 深度集成 + 混合前沿模型（Claude/GPT/Gemini + 自研 Composer 2.5）
- **擅长**：Tab 实时补全 <100ms；前端开发降维打击；视觉反馈（设计稿/截图）
- **短板**：token 消耗约 3×；$20/mo + 用量；非纯 CLI（本矩阵以 CLI 为主）
- **派发建议**：IDE 交互型任务、前端、实时补全场景

### copilot（GitHub Copilot CLI）

- **定位**：跨 IDE 覆盖最广（VS Code/JetBrains/Neovim/Xcode）；SKILL.md 采用者
- **擅长**：GitHub 生态原生集成（Actions/PR 流）；低价入门（约 $10/mo 或 usage credits）
- **短板**：质量依赖所选模型；纯 CLI 能力中规中矩
- **派发建议**：重度 GitHub 工作流、跨 IDE 团队协作

### kimi（Kimi Code CLI，Moonshot）

- **分发**：npm `@moonshot-ai/kimi-code`（Node/TS）；单二进制、毫秒级启动
- **擅长**：**视频输入**（屏幕录制/演示 → LUT/短切片/可运行代码）；1M 上下文 + 智能压缩（/compact）；子 Agent（coder/explore/plan）；`/mcp-config` 对话式配 MCP；插件生态（skills/MCP/数据源 marketplace）；生命周期 hooks；**会话内 cron 定时任务**；ACP（Zed/JetBrains 驱动）
- **模式**：/plan、/yolo、/auto；/sessions、/usage、/tasks、/goal、/swarm
- **派发建议**：视频→代码、长会话续接、定时/后台任务场景

### zcode（ZCode，Z.ai 智谱）

- **默认模型**：GLM-5.2（开源最强梯队之一，1M 上下文，面向长程 agentic 任务深度适配）
- **擅长**：**长程任务（long-horizon）稳定推进**（规划→执行→校验→状态恢复的目标模式）；工作区/文件引用/Git 分支状态理解；弹性推理强度（复杂任务加深推理）；**微信/飞书/Telegram bot 远程控制**
- **配置**：`~/.zcode/cli/config.json` 的 `mcp.servers`；支持 `.agents/mcp.json` 兼容
- **派发建议**：长任务持续执行、开源模型路线、需要远程接管时

### omp（oh-my-pi）

- **定位**：终端 Agent + "IDE 焊在内部"；Rust 核心（~80k 行），macOS/Linux/Windows 原生
- **擅长**：**hashline 编辑**（内容哈希锚点，抗空白差异，pass rate 显著高于 str_replace）；**14 个 LSP 操作**（rename/跳转/代码动作）+ **28 个 DAP 操作**（lldb/dlv/debugpy）；**持久 Python + Bun 双内核**（可互调 agent 工具）；in-process ripgrep（无 fork/exec）；60+ providers 四角色路由（default/smol/slow/plan/commit…）；Hindsight 跨会话记忆；流规则 mid-token 纠正；隔离工作区并行子代理
- **短板**：需 bun ≥1.3.14；学习曲线略高
- **派发建议**：LSP/DAP 重度项目、强 harness、多 provider 现场换模型（planner 用 Opus / smol 用快模型）

### atomcode（AtomCode，AtomGit）

- **定位**：Claude Code / Cursor Agent 的开源平替（Rust，MIT）；**任意 OpenAI 兼容大模型**
- **内置**：21 个工具（读/写/搜/跑/自验证）+ **8 个代码图谱工具**（list_symbols / read_symbol / find_references / trace_callers / trace_callees / trace_chain / file_deps / blast_radius）——模型真正读懂大仓库
- **模型**：Claude/OpenAI/DeepSeek/GLM/Qwen/SiliconFlow/Ollama
- **平台**：macOS(AS/Intel)/Linux(x64+arm64)/HarmonyOS PC/Windows 六变体
- **生态**：AtomGit OAuth 一键登录、/issue、CodingPlan 免费额度；skills/plugin 与 Claude Code 生态兼容；/goal、/loop、/todo
- **派发建议**：国产模型、代码图谱读大仓库、小步快跑可干预（每步 /undo）场景

### grok（Grok Build，xAI）

- **默认模型**：Grok 4.5（为重度 agent 工作流调优的专用变体）
- **擅长**：**plan 模式纪律**（探索→plan.md→批准后才执行，只读探索期禁写文件）；**/skillify** 把一次成功捕获为可复用技能；**并行子代理 + 深度 worktree 隔离**（reviewer 读 diff 同时 implementer 写下一部分）；marketplace 共享能力包；headless（-p）+ ACP
- **生态**：AGENTS.md/plugins/hooks/MCP 开箱即用；Sandbox 执行；代码审查
- **派发建议**：模糊任务先规划、并行分解、需要技能沉淀的场景；注意 beta 期需 SuperGrok / X Premium Plus 订阅

### cline / aider / kilo / zed（其他开源补充）

- **cline**：VS Code 内模型无关 agent（Apache-2.0，65k stars）；类 opencode 但 IDE 绑定
- **aider**：老牌开源，git 原生结对编程（auto-commit/undo），模型无关，脚本友好
- **kilo code / zed**：模型无关；zed 内置 agent 面板
- **派发建议**：预算敏感或 IDE 内工作流时作 opencode 平替；aider 适合 git 结对小步提交

---

## 3. 落地对照（agent-mcp 相关参数）

| 场景 | target_cli | model 现场决策 | 备注 |
|---|---|---|---|
| 读密集 fan-out | omp / grok / opencode / pi | smol / 快档 | 并行上限按 SKILL.md 分级门 |
| 深推理规划 | claude / omp(slow) / grok | opus 级 / slow | 先 plan 再执行 |
| 写密集落地 | claude / codex | 首档默认 | permission_mode 升 acceptEdits/fullAccess |
| 视频→代码 | kimi | 默认 | 附视频路径 |
| 长任务持续 | zcode / kimi | 默认 | 配 timeout_seconds 与 resume |
| CI/自动化 | codex / copilot | headless | verify_command 自跑验证 |
| GitHub 生态 / 跨 IDE | copilot | 默认 | 与 GitHub Actions/PR 流集成 |
| 终端轻量 harness | pi | 默认 | 扩展/skill 可自建，`--mode json` 事件流 |

> 首启耗时参考（SKILL.md 同口径）：claude ~3s、omp ~5s、atomcode ~8s、grok >120s（首次模型发现，需预热/预留超时）；codex/kimi/copilot/pi/zcode/cline 按 10s 保守估计（⏳ 待实测）。
> 模型名传**纯 API 名**（如 `deepseek-v4-flash`），别带 provider 前缀；AtomCode 仅作任务目标（task-only、one-shot）。
> 新增 CLI：除内置适配器外，任意 CLI 可通过 `docs/custom-cli.md` 的 JSON 配置接入（`<state_dir>/custom-clis/*.json`，无需改代码）。

---

*本指南为资料整理（2026-08），非实测跑分；派发前如需最新信息可复查各 CLI 官方文档。*

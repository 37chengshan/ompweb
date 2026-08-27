# AI Agent Harness / MCP Agent / Coding Tool Landscape — Comparison & Lessons

**Date:** 2026-08-13
**Scope:** GitHub 上与 agent_mcp 同类的基础设施 —— 多 Agent CLI 编排、MCP agent 服务器、agent harness、并行会话管理、自主循环编排、技能/记忆/状态机基础设施。
**Data provenance:** GitHub API 实时查询（★ 为 2026-08-13 当日值）；个别 API 重定向失败的仓库采用 `bradAGI/awesome-cli-coding-agents`（当日更新）标注值，已注明 `[list]`。

---

## 0. 参照物：agent_mcp 的能力画像（用于对比）

| 能力 | agent_mcp 现状 |
|---|---|
| 派发 | `spawn_agent` 统一入口 → 11 个 CLI 适配器（claude/grok/opencode/omp/atomcode/codex/kimi/copilot/pi/zcode/cline）+ JSON 自定义 CLI；事件流归一化 |
| 复杂度分级门 | `estimate_complexity` 本地 S/M/L 判级，零 token，按需才拆 |
| 状态机 | `agent_mcp/state_machine.py`：starting/running/terminated/error…，SQLite 持久化 |
| 队列/并发 | 槽位满自动 queued，run 结束串联 |
| 超时/续接 | 任务级 timeout 终止进程树；`resume` 透传 CLI session；`steer_agent`/`followup_task` 插话 |
| 验证回投 | `verify_command` + `max_fix_attempts`，daemon 自跑验证同 session 回投 |
| 成本 | token_budget 降档、cache_ttl 缓存、summary_chars/context_mode 裁剪 |
| 会话隔离 | session_id 所有权边界 |
| 监控 | 单文件只读 Web UI（SSE 事件流 + 对话图） |
| 记忆 | memory_store/memory_recall 跨会话 SQLite 记忆 |
| 技能 | skill/ 编排五步 + 10 内置 Agent 预设 + 任务简报模板 |
| 安装 | install.py 六 host 注册 + 备份回滚 + curl 一键安装 |

---

## 1. 直接同类（多 Agent CLI 编排 / MCP 派发 —— 最值得深读的竞品）

| 项目 | 链接 | ★ | 语言 | 关键差异化 |
|---|---|---|---|---|
| **CLI Agent Orchestrator (CAO)** — AWS | github.com/awslabs/cli-agent-orchestrator | 1.0k | Python | 与 agent_mcp 最接近的官方级竞品：`cao-server` 常驻 + tmux 隔离会话；9 个 provider CLI（Kiro/Claude Code/Codex/Copilot/OpenCode…）；supervisor profile 委派模式；**多控制面**（Web UI / shell CLI / ops MCP server / plugins 四选一）；**skills 文档**（安装/作用域/作者指南）；**memory + self-learning**（把 workflow 结果转成 lessons 再提升为指令的 opt-in 循环）；agent profile schema；工具权限 allowlist；HTTP API + PTY WebSocket |
| **wshobson/agents** | github.com/wshobson/agents | 38.8k | Python | 多 harness 插件市场：**单 Markdown 源 → 5 个 harness 的原生产物**（Claude Code marketplace / Codex / Cursor / OpenCode / Gemini CLI），非"最低公分母"翻译；94 plugins / 203 agents / 175 skills / 109 commands；**渐进式披露**（激活才载入）；**分层模型策略**（Tier 0-4 按任务类型路由模型）；`plugin-eval` 三层质量评估（静态 + LLM Judge + Monte Carlo） |
| **Symphony** — OpenAI | github.com/openai/symphony | 26.5k | Elixir | **管理"工作"而非监督 agent**：轮询 Linear/GitHub Issues/Jira/Asana/GitLab → 每 issue 一个隔离 workspace → 启动 Codex App Server 自治执行 → **proof of work**（CI 状态、PR review、复杂度分析、walkthrough 视频）→ 验收后安全落地 PR。**Spec-first**：SPEC.md 让任意编码 agent 可重新实现 |
| **Agent Orchestrator (AO)** — Untrivial | github.com/Untrivial-ai/agent-orchestrator | 9.5k | Go | Agent IDE：桌面 + `ao` CLI 监督 20+ agent；**每会话独立 git worktree/分支/PR**；**CI 失败、review 评论、merge 冲突路由回所属 agent 修复** |
| **Omnigent** — Databricks | github.com/omnigent-ai/omnigent | 8.7k | Python | meta-harness：一个编排层统一 Claude Code/Codex/Cursor/OpenCode/Hermes/Kiro/Pi；每个 agent 终端包 bwrap/seatbelt/云沙箱；**审批/预算/工具策略统一执行**；YAML 定义 tech-lead 编排器委派并行 git worktree 子 agent |
| **Citadel** | github.com/SethGammon/Citadel | 900 | JS | Claude Code + Codex 的"操作系统层"：持久项目记忆、intent 路由、安全 hooks、成本遥测、并行 agent fleets |
| **context-mode** | github.com/mksglu/context-mode | 19.8k | TS | 上下文窗口优化：工具输出沙箱化（98% 缩减）+ 会话记忆持久化 + **MCP+hooks 跨 17 平台强制路由** |
| **mcp-supersubagents** | github.com/yigitkonur/mcp-supersubagents | 1 | TS | 与 agent_mcp 同构的最小实现：MCP server 派生并行 Copilot 会话、隔离 workspace、多账号 PAT 轮换 |
| **agent-dispatch** | github.com/ginkida/agent-dispatch | 30 | Python | MCP server + CLI：把任务派发给其他项目目录的 agent；并行派发、session、异步 job、agent 间对话 |
| **omux** | github.com/Happenmass/omux | 95 | TS | tmux 上并行编排 Claude Code/Codex 子 agent；auto-continue、execute-then-review、跨会话记忆 |
| **tmuxlet** | github.com/CodefiLabs/tmuxlet | 7 | Rust | 把交互式 CLI（Claude/Codex/Gemini/opencode/pi）包成**归一化 `claude -p` 风格阻塞接口** —— 与 agent_mcp 适配器归一化同一思路 |
| **outsourcerer** | github.com/alexgreensh/outsourcerer | 114 | — | 把杂活委派给最便宜的已付费 harness；**把主会话的 skills/plugins/MCP 配置携带到执行引擎**（跨 Claude Code/Codex/Cursor/Droid/Hermes/Cline） |
| **Aeon** | github.com/aeonfun/aeon | 653 | — | **一个 Claude-Code 形状契约派发 skills 到 6 个 harness**；cron/事件触发；git 持久记忆；**自愈循环自动重写低分 skills**；MCP server 把每个 skill 暴露为 tool |

**直接竞品小结：** 赛道已成型。CAO（AWS 官方）、Symphony（OpenAI 官方）、AO、Omnigent 都押注"隔离执行 + 监督回收 + 验证证据"；agent_mcp 的差异化空间在 **MCP 原生的工具面（12 个编排工具）、多 CLI 归一化广度（11 适配器）、复杂度分级门** —— 竞品大多锁定 1-3 个 CLI 或需要专门客户端。

---

## 2. 会话管理器与并行运行器（fleet 级）

| 项目 | 链接 | ★ | 差异化 |
|---|---|---|---|
| OpenClaw | github.com/openclaw/openclaw | 386k | 本地个人 AI 助手始祖：CLI + 引导向导 + skills + 多通道（WhatsApp/Slack/Discord）；生态衍生 30+ 实现 |
| Multica | github.com/multica-ai/multica | 45.7k | 自托管 workspace：把 issue 分给 agent 像分给队友（领活/汇报/求助/交审）；驱动 20 个 CLI；**所有界面可脚本化（同一 CLI+API）** |
| Orca | github.com/stablyai/orca | 44.1k | 并行 fleet 开发环境：Codex/Claude Code/OpenCode/Pi 各占 git worktree，Ghostty 分屏滚动保留；`orca` CLI 可编程（worktree/snapshot/click/fill） |
| herdr | github.com/herdrdev/herdr | 28.3k | 终端内 agent 多路复用器，第三方生态（herdr-reviewr 等） |
| cmux | github.com/manaflow-ai/cmux | 26k | 并行运行多个编码 agent 的开源平台 |
| vibe-kanban | github.com/BloopAI/vibe-kanban | 27.8k | 看板管理 agent 工作 |
| Paseo | github.com/getpaseo/paseo | 13.5k | 自托管 daemon 并行跑 5 种 CLI；CLI/桌面/Web/移动四端控制 |
| Superset | github.com/superset-sh/superset | 12.9k | 为编码 agent 造的终端，并行会话编排 |
| Claude Squad | github.com/smtg-ai/claude-squad | 8.3k | tmux 多 Claude Code 会话并排 |
| agent-of-empires | github.com/njbrake/agent-of-empires | 3.1k | 8 种 agent 的 TUI/Web 管理，tmux + worktree |
| Crystal | github.com/stravu/crystal | 3.1k | Codex + Claude Code 并行 worktree 执行 |
| hcom | github.com/aannoo/hcom | 444 | **共享消息/事件总线**：agent 可中途互相发消息、观察、派生，带冲突检测，跨设备中继 |
| AgentBox | github.com/madarco/agentbox | 348 | 每 agent 独立 VM 沙箱（Docker/自托管/云），亚秒 checkpoint |
| amux | github.com/mixpeek/amux | 345 | 单 Python 文件 + tmux 跑几十个并行会话；Web 看板、自愈 watchdog、agent 间 REST API |
| tlbx | github.com/tlbx-ai/tlbx | 101 | 浏览器控制站：任何 PTY 应用远程监督；会话断线存活；`mt` CLI 以 JSON 暴露控制面供 agent 驱动 |

---

## 3. 编排器与自主循环（状态机/验证/循环治理）

| 项目 | 链接 | ★ | 差异化 |
|---|---|---|---|
| DeerFlow — ByteDance | github.com/bytedance/deer-flow | 79.9k | 长程 super-agent harness：子 agent + skills + 记忆 + 沙箱；**每线程独立沙箱工作区**（主机挂载需显式声明）；终端 workbench |
| claude-flow | github.com/ruvnet/claude-flow | 67.7k | 多 agent swarm 协调工作流 |
| gastown | github.com/steveyegge/gastown | 17.6k | 多 agent 编排 + 持久工作跟踪 |
| Kiro Crew — AWS | github.com/kirodotdev/KiroCrew | 2.8k | `kirocrew run TASK.md` 检查点续跑；spawn 子 agent；cron/webhook 触发；**衰减记忆硬化成可复用 skills**；OS 沙箱 + 审批门 |
| ralph-orchestrator | github.com/mikeyobrien/ralph-orchestrator | 3.1k | **Ralph 循环**：维持 agent 循环直到完成（防上下文腐烂的新鲜上下文重试） |
| zeroshot | github.com/the-open-engine/zeroshot | 1.7k | **planner + implementer + 独立 validator** 三角色隔离环境循环，直到变更被验证或带可复现失败拒绝；支持 GitHub/GitLab/Jira 后端 |
| fractal | github.com/plasma-ai/fractal | 688 | 层级 agent 循环：子 agent 各占 worktree；**可配置上限：迭代数/深度/直接子数/成本/时间** |
| h5i | github.com/h5i-dev/h5i | 527 | 多 agent 并行做同一任务 → 互相 peer review → 中立 verifier 重放测试 → 只合并通过者；元数据入 git refs |
| Bernstein | github.com/chernistry/bernstein | 851 | 确定性 Python 编排器：并行派生 → 测试验证 → 自动提交 |
| ORCH | github.com/oxgeneral/ORCH | 140 | **把 CLI agent 管理成带状态机的类型化任务队列**：todo→in_progress→review→done；自动重试；agent 间消息；TUI 仪表盘 |
| LoopTroop | github.com/looptroop-ai/LoopTroop | 118 | LLM Council 规划 → 原子"beads"在隔离 worktree 执行 → Ralph Loop 重试对抗上下文腐烂 |
| Loki Mode | github.com/asklokesh/loki-mode | 1k | reason/act/reflect/verify 闭包 + **盲审完成委员会能否决"完成"**；未过证据不放行 |
| kodo | github.com/ikamensh/kodo | 126 | 独立 architect 与 tester 双重验证，SWE-bench 验证过 |
| agx | github.com/ramarlina/agx | 27 | **checkpoint 执行引擎**：Wake→Work→Sleep 持久循环跨会话即恢复 |
| Podiom | github.com/Podiom/Podiom | 4 | **持久命名 agent 的 chat 会话可在新 backing CLI 会话上重放**（换 provider/profile 不丢上下文）—— 正是 agent_mcp resume 的推广形态 |

---

## 4. Agent 框架 / SDK（harness 构建积木）

| 项目 | 链接 | ★ | 差异化 |
|---|---|---|---|
| microsoft/autogen | github.com/microsoft/autogen | 60.4k | 多 agent 对话编排框架（已迁移 AG2） |
| crewAI | github.com/crewAIInc/crewAI | 57.0k | 角色扮演 agent 团队（Role/Task/Crew 抽象） |
| langgraph | github.com/langchain-ai/langgraph | 39.6k | **图状态机 + checkpointer 持久化**，构建弹性 agent 的行业标准 |
| openai-agents-python | github.com/openai/openai-agents-python | 28.6k | 轻量多 agent 工作流（handoff 模式） |
| smolagents | github.com/huggingface/smolagents | 28.8k | **CodeAgent：让模型"想代码"**，代码即行动 |
| deepagents | github.com/langchain-ai/deepagents | 27.7k | batteries-included agent harness（含 TUI 终端 agent） |
| MetaGPT | github.com/FoundationAgents/MetaGPT | 69.8k | 软件公司 SOP 多 agent 流水线 |
| pydantic-ai | github.com/pydantic/pydantic-ai | 19.3k | 类型安全 agent 框架 |
| camel | github.com/camel-ai/camel | 17.6k | 多 agent 角色扮演与扩展法则研究 |
| open-multi-agent | github.com/open-multi-agent/open-multi-agent | 6.8k | **"描述目标而非画图"**：coordinator 运行时规划任务 DAG，任意 LLM 可跑 |
| inngest/agent-kit | github.com/inngest/agent-kit | 918 | TS 多 agent 网络 + **确定性路由** + MCP 工具 |
| haystack | github.com/deepset-ai/haystack | 26.2k | 生产级流水线编排（RAG/agent 工作流） |
| FastGPT | github.com/labring/FastGPT | 29.3k | 知识库 + 可视化 AI 工作流编排 |
| mcp-agent | github.com/lastmile-ai/mcp-agent | 8.5k | MCP + 简单 workflow 模式构建有效 agent |
| micro/go-micro | github.com/micro/go-micro | 23.0k | Go agent harness/服务框架 |
| harness-sdk | github.com/strands-agents/harness-sdk | 6.9k | Python/TS 端到端构建并控制 agent harness |
| qm — YC | github.com/yc-software/qm | 13.3k | 多人协作 agent harness（工作空间） |

---

## 5. Skills / 插件生态（技能系统的成败样板）

| 项目 | 链接 | ★ | 差异化 |
|---|---|---|---|
| andrej-karpathy-skills | github.com/multica-ai/andrej-karpathy-skills | 202k | 单 CLAUDE.md 改进 LLM 编码行为 —— **最轻形态的"技能"也有巨大传播力** |
| claude-plugins-official | github.com/anthropics/claude-plugins-official | 33.5k | Anthropic 官方插件目录（marketplace 分发协议） |
| claude-skills (alirezarezvani) | github.com/alirezarezvani/claude-skills | 24.4k | 345 skills / 30+ agents / 70+ commands，覆盖 11 种 agent |
| Claude-Code-Game-Studios | github.com/Donchitos/Claude-Code-Game-Studios | 23.8k | 49 agents + 72 workflow skills 的层级协调系统（工作室结构镜像） |
| awesome-claude-code | github.com/hesreallyhim/awesome-claude-code | 52.2k | 资源聚合 + 插件收录 |
| marketing-skills | github.com/coreyhaines31/marketingskills | 44.1k | 垂直领域技能包（CRO/copywriting/SEO） |
| awesome-claude-skills | github.com/travisvn/awesome-claude-skills | 14.6k | 技能目录聚合 |
| skills — Trail of Bits | github.com/trailofbits/skills | 6.6k | 安全研究技能包 |
| skill-optimizer | github.com/fastxyz/skill-optimizer | 75 | **用 LLM 基准测试 SKILL.md 质量并迭代重写直至达标** |
| skillreaper | github.com/thousandflowers/skillreaper | 48 | 扫描真实会话找出"装了但从未触发"的 skills 并隔离 |

---

## 6. 记忆系统（agent_mcp memory bank 的进化方向）

| 项目 | 链接 | ★ | 差异化 |
|---|---|---|---|
| Letta | github.com/letta-ai/letta | 24.2k | 有状态 agent 平台：记忆分层、学习与自我改进 |
| agentmemory | github.com/rohitg00/agentmemory | 26.9k | 编码 agent 持久记忆（基准验证） |
| byterover-cli | github.com/campfirein/byterover-cli | 4.9k | agent 的可移植记忆层（原 Cipher） |
| Vestige | github.com/samvallad33/vestige | 602 | 本地记忆 MCP server：SQLite + **FSRS 记忆保留 + 主动遗忘 + 传播激活 + 混合检索** |
| pi-mem | github.com/jo-inc/pi-mem | 73 | 纯 Markdown 持久记忆（零向量库依赖） |
| GoodMemory | github.com/hjqcan/GoodMemory | 16 | 本地可审计记忆层：SQLite + 可回滚的受管写回 |
| Kiro Crew（见 §3） | — | 2.8k | **衰减记忆 → 硬化成 skills** 的完整闭环 |

---

## 7. 持久执行 / 工作流引擎（状态机与队列的行业级答案）

| 项目 | 链接 | ★ | 差异化 |
|---|---|---|---|
| n8n | github.com/n8n-io/n8n | 200.4k | 公平代码工作流自动化 + 原生 AI 能力 |
| Dify | github.com/langgenius/dify | 152.3k | Agentic 工作流 + RAG + 模型/工具市场 |
| temporalio/temporal | github.com/temporalio/temporal | 22.3k | **持久执行**：工作流状态机可重放、可恢复，超时/重试/信号为原语 |
| hatchet | github.com/hatchet-dev/hatchet | 7.7k | **面向 AI agent 与后台任务的编排引擎**：任务队列、并发槽、重试、持久工作流 —— 与 agent_mcp 槽位/排队同一抽象，但做到分布式 |
| inngest/agent-kit | github.com/inngest/agent-kit | 918 | 事件驱动确定性路由（见 §4） |

---

## 8. 基础设施（路由 / 沙箱 / 上下文经济 / 可观测）

| 项目 | 链接 | ★ | 差异化 |
|---|---|---|---|
| claude-code-router | github.com/musistudio/claude-code-router | 36.6k | Claude Code 路由到任意 provider/endpoint |
| headroom | github.com/headroomlabs-ai/headroom | 66.1k | **工具输出压缩层**：wrap 任意工具缩小输出（编码 15-20%、JSON 60-95% 减 token） |
| OpenCodex | github.com/lidge-jun/opencodex | 9.7k | 本地 provider 代理：Responses API 双向翻译，40+ provider，failover/加权轮询 |
| cc-router | github.com/finch-xu/cc-router | 219 | 订阅配额聚合 → 虚拟 opus/sonnet/haiku 槽位 + failover + 负载均衡 |
| agent-lsp | github.com/blackwell-systems/agent-lsp | 106 | MCP server：类型感知语言智能，**推测执行**（预览编辑不落盘），5-34× token 节省 |
| NemoClaw — NVIDIA | github.com/NVIDIA/NemoClaw | 22.1k | 沙箱化 agent 环境供应（网络/文件/进程级策略） |
| E2B | github.com/e2b-dev/E2B | 13.4k | 企业级 agent 沙箱环境（真实工具） |
| agenttier | github.com/agenttier/agenttier | 72 | Kubernetes 原生沙箱：Sandbox CRD + gVisor |
| brood-box | github.com/stacklok/brood-box | 56 | 硬件隔离 microVM 沙箱 + egress 控制 + MCP 授权 |
| HOL Guard | github.com/hashgraph-online/hol-guard | 432 | 工具调用拦截安全 harness（pre-tool hooks + 审批中心） |
| numbat — Perplexity | github.com/perplexityai/numbat | 917 | agent 活动端点可见性：hooks → OTLP → CEL 规则引擎，事前阻断 + 取证 |
| agenttrace | github.com/luoyuctl/agenttrace | 118 | 跨 8 种 agent 会话日志 TUI：成本/缓存/失败/延迟/健康门 |
| grite | github.com/neul-labs/grite | 10 | git 内 CRDT issue tracker：append-only 事件日志跨 agent 确定性收敛 |
| clu | github.com/arjia-labs/clu | 8 | SQLite 任务领取 + 依赖图 + checkpoint + 审计日志（面向 agent 驱动） |
| Wit | github.com/amaar-mc/wit | 46 | **符号级锁**：Tree-sitter AST 解析，agent 声明意图、按函数加锁防并行冲突 |

---

## 9. 教训与可借鉴特性（对应 agent_mcp 的落点）

按"直接可抄 → 需架构演进"排序，每条标注来源项目。

### 9.1 技能系统（agent_mcp 已有 skill/ —— 差距最大也最值得补）
1. **渐进式披露**：wshobson/agents 的 skills"激活时才载入"，防止上下文膨胀。→ agent_mcp 可给 10 个内置 Agent 预设加按需加载声明。
2. **技能质量评估闭环**：plugin-eval（静态 + LLM Judge + Monte Carlo 三层）与 skill-optimizer（迭代重写至达标）证明"技能也要测试"。→ 为 skill/ 写一个 `validate_skill` 检查器，纳入验收。
3. **技能自我进化**：Kiro Crew 的"衰减记忆硬化成 skill"、Aeon 的"自愈循环重写低分 skills"、Hermes 的"自动技能创建" —— 把 memory bank 的沉淀结果自动提升为 skill 是可落地的下一步。
4. **单一源 → 多 harness 原生产物**：wshobson/agents 证明跨 harness 兼容要用"每 harness 各自的惯用格式"，而非最低公分母。agent_mcp 已归一化 CLI 事件流，可同样归一化 skill 分发（claude 用 SKILL.md、codex 用 .codex/skills、opencode 用 .opencode/skills）。
5. **marketplace 分发**：claude-plugins-official 官方目录 + 社区 marketplaces 是生态增长引擎。agent_mcp 的 install.py 是分发，但发布/发现机制（marketplace.json 式注册表）缺失。

### 9.2 派发与编排（agent_mcp 的核心优势区）
6. **动态 DAG 而非平面池**：open-multi-agent"描述目标而非画图"（coordinator 运行时规划 DAG）与 fractal 的层级委派（子 agent 可再派生）是 agent_mcp 最明显的架构差距。当前 S/M/L 门 + 平面 spawn 可演进为"gate 后可选 DAG 模板"。
7. **管理"工作"而非监督 agent**：Symphony 的 tracker→issue→run→proof-of-work→PR 闭环证明顶层抽象应是任务队列。agent_mcp 的 verify_command + followup_task 已具备雏形，加"证据清单"（CI/测试输出/PR 链接）即可对齐。
8. **错误路由回所属 agent**：AO 把 CI 失败、review 评论、merge 冲突送回对应 agent —— 比 agent_mcp 的 verify 回投覆盖面更广（含异步外部反馈）。
9. **循环治理上限**：fractal 的迭代/深度/子数/成本/时间五重上限、ralph 的新鲜上下文重试、Loki 的盲审否决权 —— agent_mcp 有 timeout 但缺迭代上限与"完成主张需证据"的强制。
10. **多 agent 并行做同一任务 + 中立验证**：h5i（peer review + 重放验证 + 只合并通过者）与 zeroshot（planner/implementer/validator 三角色）可作 verify 模式的增强选项。

### 9.3 状态机与持久性
11. **持久执行语义**：Temporal/Hatchet 把"状态机 + 队列 + 超时 + 重试"做成分布式原语。agent_mcp 的 SQLite 状态机已是正确方向；可借鉴 Hatchet 的显式 retry/backoff 策略与 Temporal 的信号（signal）概念（对应 steer_agent）。
12. **会话重放**：Podiom 的持久 agent chat 在换 provider 后重放到新 CLI 会话 —— 比 agent_mcp 的 resume（同 CLI 同 session）更进一步；agx 的 checkpoint 化 Wake→Work→Sleep 同理。
13. **事件总线外扩**：hcom 让 agent 互相发消息/观察/派生（带冲突检测）；CAO 支持 outbound 事件插件。agent_mcp 的 SSE 监控流可加一个 agent→agent 消息通道，解锁 swarm 模式。

### 9.4 记忆
14. **记忆生命周期**：Vestige 的 FSRS 保留 + 主动遗忘 + 传播激活，pi-mem 的纯 Markdown 零依赖，GoodMemory 的可审计可回滚 —— agent_mcp memory bank 缺遗忘/衰减与审计。
15. **记忆→技能硬化**（见 #3）。

### 9.5 成本与路由
16. **模型/Provider 路由层**：cc-router 的"多订阅聚合 → 虚拟槽位 + failover"、Codewhale 的"每角色固定 provider/模型、便宜模型指挥贵模型"、wshobson 的 Tier 0-4 —— agent_mcp 的 token_budget 降档可升级为显式路由策略表（任务类型 × 底座 × 模型档位），这正是它跨 CLI 定位的天然优势。

### 9.6 上下文经济
17. **工具输出压缩**：headroom（15-95% 减 token）、context-mode（98% 缩减）、agent-lsp 的推测执行 —— agent_mcp 的 summary_chars/context_mode 可加"适配器级输出截断/摘要"默认策略，在事件流归一化时顺手做。

### 9.7 安全与沙箱
18. **每 worker 沙箱**：Omnigent（bwrap/seatbelt）、AgentBox（VM + 亚秒 checkpoint）、NemoClaw/brood-box/AgentTier（策略与 egress 控制）、CAO 的 tool-restrictions（角色 allowlist）—— 这是企业采纳的前置条件；agent_mcp 目前无沙箱，X-Auth 只护 API 面。

### 9.8 分发与生态
19. **脚本化控制面**：Multica"所有表面同一 CLI+API"、Paseo 四端控制、CAO 多控制面 —— agent_mcp 有 MCP + Web UI，补一个 `agent-mcp` CLI（list/spawn/wait/logs）即可让 CI 场景使用。
20. **awesome-list / 模板分发**：OpenClaw 生态（386k 始祖 + 30+ 衍生）证明模板与技能市场是增长主引擎；agent_mcp 可发布 `awesome-agent-mcp` 或技能包市场提升曝光。

---

## 10. 一句话结论

- **直接竞品**：CAO（AWS，tmux + supervisor + 多控制面）、Symphony（OpenAI，工作队列 + proof-of-work）、AO（worktree 隔离 + 错误回投）、Omnigent（沙箱 + 策略）。agent_mcp 的护城河 = MCP 原生工具面 + 11 CLI 适配器广度 + 复杂度分级门；短板 = 无沙箱、无动态 DAG、无 agent 间通信、无技能质量闭环。
- **优先借鉴**（按投入产出比）：① 技能渐进式披露 + 质量评估 + 记忆→技能硬化；② Hatchet 式显式 retry/backoff 与任务级迭代上限；③ Symphony 式 proof-of-work 证据清单；④ headroom 式输出压缩；⑤ 模型路由策略表；⑥ agent 间消息通道。

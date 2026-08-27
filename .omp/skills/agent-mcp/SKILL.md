---
name: agent-mcp
description: Use when a task should be decomposed and dispatched across claude, grok, opencode, omp, or atomcode workers, especially for parallel execution, mid-run steering, durable follow-ups, task monitoring, or multi-CLI result synthesis.
---

# Agent MCP 编排 Skill

主 agent 负责拆解、并行度、权限、模型和验收；Agent MCP 只提供可靠派发、监控、续接与终止基础设施。不要把拆解或文件冲突决策交给 MCP。

## 1. 编排五步（主 agent 的工作）

**第零步：复杂度分级门（先判拓扑，再决定拆不拆）**

主 agent 先对任务做一次复杂度分级，**默认直接做，按需才拆**。多 agent 编排比单线程多耗 3–10× tokens（Anthropic 实测），拆解的收益只在"可并行 / 上下文超窗 / 需要专业角色"三类场景成立。

**用工具判级**：调 `estimate_complexity`（本地直算，零 token、不 spawn），传 `task` + 已知涉及文件（`files`），返回 `level`（S/M/L）+ `rationale` + `delegate` + `suggestion`。判级结果直接决定是否进入编排：

| 级别 | 判据 | 处置 |
|---|---|---|
| S（小改） | 单文件、≤2 处改动、无并行价值、不需要新上下文 | **不拆不 spawn**，主 agent 直接做 |
| M（中等） | 跨 2–3 文件，改动有依赖、顺序执行即可 | 至多拆 1 个子任务（读密集探索可拆，写密集尽量自做）；不并行 |
| L（大型） | 触及 >3 文件、可并行分支、上下文会超窗、需专精角色（架构/安全审查） | 才走完整编排五步 |

> `estimate_complexity` 是确定性启发式（文件数 + 关键词信号），仅供第一版判断；任务真实复杂度以主 agent 对代码的理解为准，工具结果与直觉冲突时按直觉（宁可不拆）。

**不委派清单（命中任一即禁止 spawn）**：两行小改、单文件编辑、强顺序依赖链、快速问答、同文件多处编辑。**子代理有固定启动/简报/汇合开销，拆了反而更慢更贵**——这是编排开销 > 实现收益的最常见来源。

**第一步：拆解规划**
把任务拆成可独立验证的子任务（有明确产出物或验收点），用 `skill/agents/planner.md` 辅助。每个子任务标注：**读密集**（探索/审查/搜索）还是**写密集**（改代码/写文件）。

拆解粒度以"最小必要步骤"为准：S ≤ 1–2 步（几乎不拆）、M 1.8–2.4×、L 2.8–4.5×（拆解粒度指数 DGI 经验最优窗）；**超出即过拆**，协调开销会压过实现收益（实证：过拆区成功率随拆解数下降）。

**第二步：判定并行（关键）**
- **认知局部性优先**：需要同一心智模型/顺序依赖的子任务 → **合并或留主线程**，拆了只会让多个 agent 各自重建相同上下文，开销翻倍（Fowler: Orchestrator's Tax）
- 无数据依赖的子任务 → **并行**派发
- 写同一批文件的子任务 → **串行**（或按依赖分批、同批并行）
- 有依赖的 → 父任务先跑，产出作 `context` 传给子任务

**第三步：MCP 式派发**
对每个子任务调 `spawn_agent`（可并发调用多个）：
- `target_cli` 按 §3 匹配；`model` 现场决策（去模型化，不硬编码）
- `cwd` 必填；`parent_agent_id` 挂到当前任务树；`permission_mode` 默认 plan，写文件才升档
- `prompt` = 角色预设（`skill/agents/*.md`，含 frontmatter 默认值，§7）+ 任务简报（下方六要素）
- **token 裁剪参数**（主 agent 控体积）：
  - `context_mode`：`compact`（默认，超 8K 字符 head+tail 截中间）/`full`（关键路径不压）/`tail`（只保留末尾）
  - `summary_chars`：wait 回传摘要上限，默认 600 读密集/2000 写密集（frontmatter 可覆盖）
  - `return_ref`：true 时 wait 只返 ref+预览，主 agent 按需拉全文（延迟消费）
  - `cache_ttl`：读密集任务结果缓存秒数（默认 0 禁；相同请求 TTL 内 0 token）
  - `token_budget`：单任务 token 预算；超额完成态后自动降档 model 重跑（§8 降档表）
  - `verify_command`+`max_fix_attempts`：daemon 自跑验证，失败自动同 session 回投，只最终结果回主 agent

### 任务简报六要素（prompt 的任务部分；未填字段不出现，控制体积）

1. **目标**：一句话可衡量的结果
2. **工作范围**：允许读/写的文件、目录、命令
3. **边界**：禁止事项——不许动的文件、不许重构/提交/装包
4. **自审级别**：轻量（读密集——核对范围无遗漏、不编造）｜全量（写密集——完整性/质量/测试对照验收）；关键路径强制全量；可显式覆盖；**子代理回传 FINAL_ANSWER 前必须自证达成**（附证据，未达成报 BLOCKED，见 task-brief）
5. **输出格式（输出契约，强制结构化）**：以 `FINAL_ANSWER: <摘要>` 结尾回传，摘要受 `summary_chars` 裁剪（默认 ≤3 行，写密集可放宽）；长报告写文件后回传路径。**契约不合格（散文/无结构）会让主 agent 重读重判，烧掉的正是委派要省的上下文**——输出格式必须是角色预设里规定的结构化形态，禁止自由发挥
6. **卡住升级**：BLOCKED / NEEDS_CONTEXT / NEEDS_DECISION——不瞎猜，列已尝试项与所需帮助；遇歧义不动手回 `NEEDS_DECISION: <问题> + why <理由>`，daemon 标 needs_advisor 态，主 agent wait 收到此态才介入

完整标注版模板与填充示例见 `skill/task-brief.md`。

**第四步：监控（静默等待，优先本地脚本，避免频繁调 MCP）**

**唯一主规则**：派发后**优先跑内置本地脚本** `python3 skill/scripts/wait_agent.py <agent_id>`——它一次本地命令就阻塞等终态（内部循环调本机回环 `/api/agents/wait`，不占 MCP 往返），终态一次性输出 FINAL_ANSWER 摘要 + tokens。**不要调用 `list_agents` / `get_agent_activity` 轮询**——每次 MCP 往返都进主 agent 上下文，脚本等待是 0 上下文成本；`wait_agent` 仅限单次短阻塞（timeout=25s），未完成再循环调用。

脚本用法（**读取/运行一律用完整具体文件名，勿用 glob 通配**——skill:// 内部 URL 不支持 `*` 模式，如 `skill://agent-mcp/scripts/*agent*.py` 会报错）：
- `python3 skill/scripts/wait_agent.py <agent_id>`（完整内部路径：`skill://agent-mcp/scripts/wait_agent.py`）：默认等 600s，单次内部阻塞 25s，终态输出 `FINAL_ANSWER 摘要` + `[status] stop_reason=... tokens=...`
- `--timeout 1200`：放宽总等待；`--json`：输出结构化 JSON（含 usage 五元组，替代另调 get_token_usage）
- 退出码：0=终态，4=总超时（stderr 带存活证据 hint，供"健康 vs 僵住"判断），2/3=HTTP/连接错误
- daemon 不在本机/非默认端口时：`--state-dir <dir>` 覆盖（自动读 daemon.json 的 token 与 daemon.lock 的端口）

无脚本场景（daemon 远程/主 agent 环境不便跑本地命令）才退回 MCP `wait_agent`（timeout=25s）单次静默等待，未完成再循环调用，单次不超过 MCP 客户端 ~30s 截断上限。wait 超时 hint 带**存活证据**（worker_pid alive / 日志增长）——只要 hint 说明 agent 在正常工作中，就继续等待，不轮询。

**例外（仅在此时提前检查）**：中途改向（`steer_agent`）/ 疑似僵住（hint 报 worker_pid 已死且日志停增）。等待期间可规划或派发其他独立分支，但不要为打发时间读无关文件。

- 网页操作台：`start_agent_mcp.py --open`（横向 Conversation Graph 显示 `agent.user_turn` 输入节点；只读监控，写授权仅经 URL fragment 传入，页面读取后立即清除）

**第五步：汇合与迭代（主代理评判协议）**
- 分支以 `FINAL_ANSWER:` 回传摘要；主 agent 综合核对、识别冲突、决定返工
- 不合格分支 → `followup_task`（复用同一 agent 节点）迭代修复，不阻塞其他分支
- 关键路径（认证/支付/数据）必须过 `security-reviewer`
- **主代理评判协议（四查）**：每个分支返回后主 agent �四查评判，**不亲信、不过度**：
  1. **对目标**：FINAL_ANSWER 声称的结果 vs 任务目标是否一致、可衡量——不一致即返工
  2. **查证据**：抽查关键断言/文件/测试输出是否真实存在（**抽查，不重审**——不逐行复核子代理已自查内容）
  3. **判返工**：证据缺失或与目标不符 → `followup_task` 迭代；仅关键路径（认证/支付/数据）才深查
  4. **查成本**：分支返回后调 `get_token_usage`，超 ET 阈值的分支下次降档或拆分（§8 降档表）；频次高的分支优先优化

## 2. 工具速查（12）

| 工具 | 用途 |
|---|---|
| estimate_complexity | 本地复杂度分级（第零步判级工具）：传 `task` + 已知涉及文件 `files`，返回 `level`（S/M/L）+ `rationale` + `delegate` + `suggestion`；本地直算，零 token、不 spawn |
| spawn_agent | 派发新 agent（立即返回 agent_id + status + prompt_chars + estimated_tokens + min_expected_seconds；槽位满返回 queued）。**参数**：context_mode（compact/full/tail，控上下文压缩）、summary_chars（wait 回传摘要上限）、return_ref（true=只返 ref+预览，延迟拉全文）、cache_ttl（读密集结果缓存秒数）、token_budget（超额自动降档重跑）、verify_command+max_fix_attempts（daemon 自跑验证+回投）、min_expected_seconds（按 CLI 首启矩阵估：claude 3/grok 120/omp 5/atomcode 8，便主 agent 规划等待节奏） |
| send_message | 投递消息到队列，不触发执行 |
| steer_agent | 中途插话：先终止当前 run，再在同一节点立即开始下一 turn；稳定 session id 的 CLI 自动恢复原会话 |
| followup_task | 唯一触发新 turn 的入口：合并挂起消息重新 spawn（复用同一 agent 节点）；运行中返回 queued，当前 run 结束后自动串联；interrupt=true 先终止再重派；返回 merged_messages |
| wait_agent | 短阻塞等 agent 终止（timeout 默认 30s、上限 600s）。terminated 返回结构化：**summary**（FINAL_ANSWER 提取）、**stop_reason**、**usage**（五元组：input/output/cache_read/cache_creation/cost_usd）、**events_compressed**（已消费 tool_use/result 压为 [consumed]，保留最近 5 条原文）+ **events** 列表 |
| interrupt_agent | 终止进程树（不可恢复，慎用） |
| list_agents | 列 agent 树（默认只返 id/task_name/status/stop_reason；fields=all 返全量含 CLI/父 id/最近消息） |
| get_agent_activity | 实时活动流（since_seq 增量；默认压缩已消费 payload，include=verbose 返全量原文） |
| get_token_usage | token 统计（派发侧估算；含 ET 有效 token 指标；AtomCode 从 `-v` 的 `[tokens] prompt=… completion=… cached=…` 解析） |
| memory_store | 记忆银行写入（跨会话项目记忆存取）。**参数**：`content` 必填；`kind`/`key`/`tags` 可选 |
| memory_recall | 记忆银行召回（跨会话项目记忆检索）。**参数**：`query`/`kind`/`limit`（默认 5）；会话隔离 |

**工具可见性（tools/list 静态裁剪）**：`tools/list` 默认只暴露四件通用工具（spawn_agent / wait_agent / interrupt_agent / estimate_complexity）；完整工具集（send_message / steer_agent / followup_task / list_agents / get_agent_activity / get_token_usage / memory_store / memory_recall）需 client 在 initialize 的 tools/list 请求 `params._meta.clientCapabilities.extensions` 声明 `io.modelcontextprotocol/tools.used` 扩展（即 `io.modelcontextprotocol/tools` 键下的 `used` 工具名列表）才暴露全量。未声明时用不到的工具会显示为不存在——此时以直接调用工具名（`tools/call` 不拦截）或升级客户端声明为准。

**协议**：兼容 legacy MCP 2025-03-26 与 modern 2026-07-28 双协议；错误返回带 **error_type** 字段（session_mismatch/daemon_unreachable/port_conflict/timeout/cli_exit_nonzero/worker_died），便主 agent 自动化错误分流。实现细节见 `docs/`。

## 3. 派发决策（去模型化）

- **读密集**（探索/审查）→ 快模型：omp `smol`、grok luna/terra 类
- **深推理**（规划/架构）→ 强模型：claude opus 类、grok-4.5 类
- **写密集**（实现）→ 主载体自身或默认，`permission_mode` 升档
- 模型绑定优先级：spawn_agent 显式 `model` → 主载体配置（codex / claude agent 配置 / omp `modelRoles`）
- **成本纪律**：默认低档位/快模型，无明确理由不升级到高成本方案；`get_token_usage` 复核大派发后的消耗
- 各 CLI 能力矩阵见 `docs/capability-matrix.md`；启动/解析怪癖见 §5

## 4. 关键约定

- `session_id` 是所有 agent ID 操作的所有权边界；宿主调用自动注入，不能用另一会话的 agent ID
- **session 生命周期**：session_id 由宿主注入的稳定会话标识派生（claude `CLAUDE_CODE_SESSION_ID` / codex `CODEX_THREAD_ID`，同一对话 resume 不变；无宿主标识时持久化兜底，重启后仍取同一值）——**同一对话重开 MCP 连接后旧 agent 仍可用**。仅当真正换了宿主/对话才失联：先 `list_agents`（include_other_sessions=true）找回旧 agent 状态；确认失联再重新 spawn（prompt 带前次上下文），不要复用旧 agent_id
- **运行中可见性**：daemon 增量 tail 子代理 out/err 日志（AtomCode 的进度在 **stderr**，`[thinking]/[tool→]` 行）并作心跳更新 `updated_at`；wait 超时 hint 带**存活证据**（worker_pid alive + out/err 日志 mtime/大小）——判断"健康 vs 僵住"以存活证据为准，不凭 updated_at 冻结或 stdout 无输出下结论
- `timeout_seconds`（spawn/followup，1–1800）是任务级超时：终止进程树并标记 `incomplete/timeout`；`wait_agent.timeout` 只是轮询阻塞上限
- usage 为派发侧估算；AtomCode 的 verbose token 行会被解析为 `agent.usage`，不会污染最终消息

## 5. 错误恢复

| 症状 | 动作 |
|---|---|
| 工具未在列表中出现 | `tools/call` 仍可直接调用（不拦截）；或按 §2「工具可见性」升级客户端声明暴露 |
| 工具返回 error | 先读 summary 定根因（session 不匹配 / 参数错 / daemon 失联），按本表处理；处理不了回传 BLOCKED 并停手，禁止用 echo/no-op 命令空转试探 |
| session 不匹配（agent 不属于当前会话） | 先 `list_agents`（include_other_sessions=true）找回旧 agent 状态——同一对话重开应能直接取到（见 §4）；确认是不同对话才失联，**不要复用旧 agent_id**，重新 spawn 新 agent，prompt 带前次摘要/上下文 |
| 超时 | 任务级：spawn/followup 传 `timeout_seconds` 自动终止（incomplete/timeout，可 resume）；等待超时 → 读 hint 的**存活证据**：worker_pid alive 或 out/err 日志在增长 → 健康，按第四步纪律再 wait 一次（5-10 分钟）；worker_pid 已死且日志不再增长 → 才判僵住，interrupt + 重派（context 带前次摘要） |
| 疑似僵住 | **不要凭 updated_at 冻结或 stdout 无输出下结论**（AtomCode 输出在 stderr）；先读 wait hint 存活证据：pid 存活或 err.log 增长 = 正常工作中，继续等；pid 死 + 日志停增 = 真僵住，interrupt + 重派 |
| 认证失败 | 查登录态：claude/grok OAuth；opencode provider key；opencodex 代理 (127.0.0.1:10100) |
| AtomCode 403 model not enabled | `model` 传纯 API 名（`deepseek-v4-flash`），别带 provider 前缀/catalog 键，别显式 provider；AtomCode 仅作任务目标（task-only、one-shot、不支持稳定 session-id resume） |
| binary 未找到 | 查 PATH：omp `~/.bun/bin`，grok `~/.grok/bin`，AtomCode `~/.local/bin/atomcode` |
| 权限拒绝 | `permission_mode` 升档：plan → acceptEdits → fullAccess |
| 排队滞留 | 槽位被占；interrupt 低优分支释放 |
| daemon 失联 | MCP 自动拉起；手动 `python agent_mcp/daemon_main.py`；网页 8765 |
| grok 首启慢 | 首次模型发现 >120s：spawn timeout 预算预留，或常驻预热 |
| opencode 401 | 默认 provider key 失效，需指定 opencodex 模型 |

## 6. 内置角色预设

`skill/agents/*.md` 共 10 个角色提示词（planner / architect / code-reviewer / security-reviewer / tdd-guide / build-error-resolver / e2e-runner / refactor-cleaner / doc-updater / code-explorer），**只含提示词、不指定 CLI 与模型**。spawn 时把对应文件内容拼进 `prompt`，任务部分按 §1 六要素填写，`target_cli` / `model` / `permission_mode` 由主 agent 按 §3 决策。

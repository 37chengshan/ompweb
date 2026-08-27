# agent_mcp v0.3 大迭代升级计划 — 多维度审查报告 + 修订版实施计划

> 审查日期：2026-08-13 ｜ 审查方式：子代理开源研究（Omnigent/deer-flow/ruflo/BossConsole/ECC/Symphony 等）+ 本地代码实读
> 结论先行：**方向正确（多 Agent 编排基础设施 + 网页迭代 + 策略治理 + 协作），但原计划建立在三处失真的假设上，需按"现状基线 → 差距分析 → 增强式迭代"重构，而不是推倒重来。**

---

## 一、多维度审查报告（8 维度）

### D1 架构现状核对 —— ⚠️ 计划假设失真
| 计划假设 | 代码实态（证据） | 判定 |
|---|---|---|
| "dispatch.py 仅简单队列" | `agent_mcp/dispatch.py` 已有 **SlotScheduler**：读写分池（read 6/write 2）、followup 优先补位、30s watchdog、进程树终止、分离 worker | ❌ 低估，实为成熟的槽位调度器 |
| "web/ 只有 index.html 占位" | `web/index.html` 是**真实前端**：对话图（conversation graph）+ SSE 实时流 + Gantt 时间线 + 用量面板 + 会话切换 + 回放（replay） | ❌ 低估，实为有价值的可视化资产 |
| "支持 7+ CLI" | `agent_mcp/cli_adapters.py` 已有 **11 个内置适配器**（claude/grok/opencode/omp/atomcode/codex/kimi/copilot/pi/zcode/cline）+ GenericAdapter 配置驱动 + `register_adapter()` 动态注册 | ❌ 低估，"打通所有 CLI"的地基已存在 |
| MCP 工具面薄弱 | `mcp_server.py` 已有 spawn/steer/followup/wait/interrupt/list/get_agent_activity/get_token_usage/estimate_complexity/memory_store/memory_recall | ❌ 低估，编排原语已齐全 |

**结论**：迭代方向应为**增强与补齐**，不是从零构建。推翻 web/ 或重写 dispatch 会浪费现有资产。

### D2 适配器成熟度 —— ⚠️ 最大短板在"实测率"
`docs/capability-matrix.md` 显示：codex/kimi/copilot/pi/zcode/cline **6 个新适配器全部 ⏳ 待实测**（事件流格式、resume、权限模式均未验证）。zcode/cline 甚至无文档化 headless 事件流。
**这是整个 v0.3 的前置依赖**：编排、协作、网页、策略全部依赖归一化事件流；适配器解析不准，上层全空转。

### D3 基线缺失 —— ⚠️ 验收标准不可测量
原计划验收写"调度正确率 > 95%"，但**无基线数据**（当前支持 CLI 数、事件解析覆盖率、测试数）。修订版全部改为"基线 → 目标"对比式指标。

### D4 网页迭代方向 —— ⚠️ 需增强而非重构
现有 index.html 的对话图 + 回放是**差异化资产**（Omnigent 网页只有会话列表，没有可视化时间线）。推倒重写为 Next.js 违背"匹配现有风格"原则，且损失对话图能力。
**修订**：在原生 index.html 上做**渐进式模块化扩展**，新增协作面板 / 策略可视化 / 工作区视图，复用现有 SSE 通道。

### D5 策略引擎落地 —— ⚠️ 缺 enforcement 点设计
原计划只写了 `PolicyEngine.evaluate()` 的孤立代码。真实落地必须回答：**在哪个执行点拦截？**
**修订**：策略作为 **daemon 层 enforcement**，挂在 spawn/interrupt/steer 之前 + 事件流归一化之后，消费现有 `events.py` 的规范化事件；复用现有 `estimate_complexity` 的"零 token 本地判定"模式做预算检查。

### D6 沙箱定位 —— ⚠️ 实现应是"映射层"而非"再造沙箱"
各家 CLI 自带沙箱：codex `--sandbox workspace-write`、claude/grok 权限模式、pi `--allow-home` 等。
**修订**：`sandbox/` 不做新沙箱，做**统一策略 → CLI 沙箱参数映射层** + 进程级兜底（现有 `terminate_process_tree` + 资源限制）。这与"各家 CLI 不都有"的顾虑一致：统一面是策略翻译，不是隔离实现。

### D7 工作区 —— ⚠️ 聚焦任务级 git worktree
项目已有 `.planning/` 目录体系。**修订**：不做全局多工作区目录革命，聚焦 Polly 模式的**编排任务级 git worktree**（每个子代理独立 worktree + 跨厂商审查 + diff 合并回主工作区）。

### D8 测试与文档 —— ✅ 基础好，扩展即可
`tests/` 已有 17+ 测试文件（含 test_mcp_server.py 30.9KB、test_integration.py 18KB）。修订版在其上扩展，不另起炉灶。

---

## 二、差距分析（现状 → 目标 → 动作）

| 能力域 | 现状 | v0.3 目标 | 差距动作 |
|---|---|---|---|
| CLI 适配 | 11 适配器，6 个待实测 | 11 适配器实测率 100%，事件归一化单一 schema | **Phase 0**：逐 CLI 实测 + 校准解析器 + 更新矩阵 |
| 编排 | 单 agent 槽位调度 | 多 agent DAG + worktree 协作 + 跨厂商审查 | **Phase 1** |
| 治理 | 无策略层 | daemon 级 enforcement（审批/预算/限权） | **Phase 2** |
| 网页 | 对话图 + 回放 | + 协作面板 / 策略可视化 / 工作区视图 | **Phase 3**（重点） |
| 沙箱 | CLI 各自权限参数 | 统一策略→沙箱参数映射 + 进程兜底 | **Phase 4** |
| 质量 | 17+ 测试文件 | 基线对比式验收 + 多代理集成测试 | **Phase 5** |

---

## 三、修订版实施计划（10 周）

### Phase 0：适配器实测补全 + 事件归一化基线（1 周）
**目标**：让"打通所有 CLI"从声明变为可验证。

**代码细节**：
```python
# agent_mcp/events.py 新增统一事件 schema（单一真源，所有上层消费它）
EVENT_SCHEMA = {
    "seq": int,            # 全局递增
    "agent_id": str,
    "type": str,           # message_start/message_update/message_end/tool_use/error/result
    "ts": float,
    "data": {
        "text": str | None,
        "tool": str | None,
        "usage": {"input": int, "output": int, "cache_read": int,
                  "cache_write": int, "cost_usd": float} | None,
        "stop_reason": str | None,
        "session_id": str | None,
        "model": str | None,
    },
}
```

**动作清单**：
1. 逐 CLI 实测 6 个待测适配器（codex/kimi/copilot/pi/zcode/cline），校准事件解析（已有 `_normalize_usage`/`_merge_usage` 基础，补全 `_extract_text` 对各 CLI 覆盖）
2. zcode/cline 若 headless 事件流无法实证 → 在 capability-matrix 标注"降级模式（文本捕获）"，不阻塞编排（参考现有 CopilotAdapter 文本捕获路径）
3. 新增 `tests/test_event_normalization.py`：每个 CLI 的原始输出 fixture → 断言归一化事件字段完整
4. 更新 `docs/capability-matrix.md`：⏳ → ✅/降级标注

**验收**：11 适配器归一化事件 100% 通过 fixture 测试；矩阵无 ⏳。

---

### Phase 1：编排引擎增强 — DAG + Polly 模式 worktree 协作（2 周）
**目标**：从"单 agent 槽位调度"升级为"多 agent 有依赖编排"。

**代码细节（在现有 SlotScheduler 之上，不重写）**：
```python
# agent_mcp/dispatch.py 新增
class OrchestratedTask:
    """编排任务节点：id / deps / cli / prompt / worktree / review_by"""
    def __init__(self, task_id: str, deps: list[str] | None = None,
                 cli: str = "claude", worktree: bool = False, review_by: str | None = None):
        ...

class Orchestrator:
    """DAG 调度器：复用 SlotScheduler 的槽位，增加依赖就绪检查"""
    def __init__(self, scheduler: SlotScheduler):
        self.scheduler = scheduler      # 复用现有池调度
        self.tasks: dict[str, OrchestratedTask] = {}
        self.ready: asyncio.Queue[OrchestratedTask] = asyncio.Queue()

    def add(self, task: OrchestratedTask) -> None:
        self.tasks[task.task_id] = task
        if not task.deps:               # 无依赖 → 立即就绪
            self.ready.put_nowait(task)

    async def _on_dep_done(self, dep_id: str) -> None:
        for t in self.tasks.values():
            if dep_id in (t.deps or []) and self._deps_met(t):
                self.ready.put_nowait(t)

    async def run(self) -> dict[str, Any]:
        # 每个 worktree 任务：git worktree add → spawn worker → diff → review → 合并/丢弃
        ...
```

**Polly 模式（参考 omnigent examples/polly）**：
```python
# agent_mcp/orchestrator_polly.py 新增
class PollyOrchestrator:
    """技术负责人编排：规划 → 并行分发到 worktree 子代理 → 跨厂商审查 → 合并"""
    async def plan(self, task: str) -> list[dict]:
        # 调用 estimate_complexity 分级 → 拆解子任务
        ...
    async def delegate(self, plan: list[dict]) -> None:
        # 写者与审查者来自不同 CLI（e.g. claude 写 / codex 审），复用现有 spawn_agent
        ...
    async def review_route(self, diff: str, writer_cli: str) -> str:
        # 返回与 writer 不同厂商的审查 CLI 名
        ...
```

**新增 MCP 工具**：`orchestrate_task`（DAG 声明式入口）、`orchestration_status`。

**验收**：多 agent 并行（2 写者 + 1 审查者）集成测试通过；worktree 冲突回滚可恢复。

---

### Phase 2：策略治理 enforcement 层（2 周）
**目标**：预算 / 审批 / 工具限权成为 daemon 级能力，不是 prompt 级建议。

**代码细节**：
```python
# agent_mcp/policies/__init__.py 新增
class PolicyResult(Enum):
    ALLOW = "allow"; DENY = "deny"; ASK = "ask"

@dataclass
class PolicyEvent:
    type: str                    # pre_spawn / pre_steer / usage_delta / tool_call
    agent_id: str
    data: dict                   # prompt / cost / tool_name ...

class PolicyEngine:
    """声明式策略链：按注册顺序评估，DENY 短路；state 支持预算累计"""
    def __init__(self):
        self.policies: list[Callable[[PolicyEvent, dict], PolicyResult]] = []
        self.state: dict = {"budget_usd": 0.0, "spawns": 0, "tool_calls": 0}

    def register(self, fn: Callable) -> None:
        self.policies.append(fn)

    def evaluate(self, ev: PolicyEvent) -> PolicyResult:
        for fn in self.policies:
            r = fn(ev, self.state)
            if r is not PolicyResult.ALLOW:
                return r
        return PolicyResult.ALLOW

# 内置策略（YAML 可配置，参考 omnigent POLICIES.md）
# policies/builtin.py
def budget_policy(ev, state) -> PolicyResult:
    if ev.type == "usage_delta":
        state["budget_usd"] += ev.data.get("cost", 0.0)
        if state["budget_usd"] > state.get("budget_limit", 10.0):
            return PolicyResult.DENY
    return PolicyResult.ALLOW
```

**enforcement 点接线**（关键：不是独立系统，是钩子）：
```python
# mcp_server.py 修改：spawn_agent / steer_agent / followup_task 入口前
result = policy_engine.evaluate(PolicyEvent("pre_spawn", agent_id, {"prompt": prompt}))
if result is PolicyResult.DENY:
    return {"status": "denied", "reason": ...}
# usage_delta 事件在 daemon 消费归一化事件流时注入（events.py 归一化后挂钩）
```

**新增 MCP 工具**：`policy_add` / `policy_list` / `policy_state`（agent 可在会话内配置策略，参考 omnigent `sys_add_policy`）。

**验收**：预算超限 → spawn 被 DENY 的集成测试通过；策略状态随会话持久化。

---

### Phase 3：网页迭代 — 协作面板 / 策略可视化 / 工作区视图（3 周，重点）
**目标**：在现有对话图上做**渐进式模块化扩展**，不推倒 index.html。

**现状资产（复用）**：SSE 实时流（`sse-dot`/`live-tag`）、对话图、Gantt、用量面板、回放、会话切换。

**迭代结构**：
```
web/
├── index.html          # 保留：对话图 + 回放 + Gantt（现状资产不动）
├── panels/             # 新增：按需 <script type="module"> 加载，不引入构建链
│   ├── collaboration.js    # 协作面板
│   ├── policies.js         # 策略可视化
│   └── workspaces.js       # 工作区视图
├── css/panels.css      # 新增：与现有内联样式风格一致
└── api.js              # 新增：daemon_http 客户端封装（fetch + SSE 订阅）
```

**面板 1 — 协作面板（collaboration）**：
- 多 agent 并行泳道视图（每个编排任务一条泳道：规划→写→审→合并）
- 跨厂商审查流：`review_requested` SSE 事件 → 泳道高亮 + 审查 diff 预览
- 复用现有 `get_agent_activity` 的 seq 增量拉取

**面板 2 — 策略可视化（policies）**：
- 预算仪表盘：`/api/policies/state` 轮询 + `usage_delta` SSE 实时更新（进度环 + 超限红闪）
- 策略链视图：当前生效策略列表 + ALLOW/DENY/ASK 命中日志

**面板 3 — 工作区视图（workspaces）**：
- worktree 列表 + 状态徽章（clean/dirty/merged/discarded）
- 一键合并/丢弃（调用新增的编排工具）

**daemon_http.py 新增端点**：
```
GET  /api/policies/state        → 策略引擎状态快照
GET  /api/workspaces            → worktree 列表 + 状态
POST /api/workspaces/{id}/merge → 合并 worktree（→ Phase 1 编排层）
SSE 新增事件类型：policy_decision / review_requested / workspace_status
```

**验收**：三个面板在现有对话图上叠加可用；SSE 事件驱动刷新；无构建链（原生 JS 模块）。

---

### Phase 4：沙箱策略映射层 + 进程兜底（1 周）
**目标**：统一策略 → 各 CLI 沙箱参数翻译，不重复造沙箱。

**代码细节**：
```python
# agent_mcp/sandbox/mapper.py 新增
SANDBOX_MAP = {
    # 统一意图 → CLI 具体参数（依据 capability-matrix 实测）
    "readonly":    {"codex": ["--sandbox", "read-only"], "claude": ["--permission-mode", "plan"],
                    "grok": ["--permission-mode", "plan"], "pi": ["--plan-yolo", "--allow-home"]},
    "workspace":   {"codex": ["--sandbox", "workspace-write"], "claude": ["--permission-mode", "acceptEdits"], ...},
    "bypass":      {"codex": ["--dangerously-bypass-approvals-and-sandbox"], ...},
}

def map_sandbox(env: str, cli: str, policy_state: dict) -> list[str]:
    """把统一沙箱意图翻译成目标 CLI 参数；未知 CLI → 进程级兜底"""
    ...
```

**进程级兜底（已有基础扩展）**：`terminate_process_tree` + 新增资源限制（`resource.setrlimit` CPU/内存）、超时预算（复用 grok 首启 >120s 的实测经验）。

**验收**：同一策略配置在 codex/claude/pi 上产生等价沙箱行为的映射单测通过。

---

### Phase 5：质量门 + 发布（1 周）
**基线对比式验收**：

| 指标 | 基线（现状） | 目标（v0.3） |
|---|---|---|
| 适配器实测率 | 5/11（45%） | 11/11（100%，zcode/cline 允许降级标注） |
| 归一化事件覆盖率 | 部分 | 100%（fixture 驱动） |
| 编排 | 单 agent 槽位 | DAG + worktree + 跨厂商审查（集成测试） |
| 策略 | 无 | daemon enforcement + 3 内置策略（预算/审批/限权） |
| 网页 | 对话图 + 回放 | + 3 面板（SSE 驱动，无构建链） |
| 测试 | 17+ 文件 | + test_event_normalization / test_orchestrator / test_policies / test_web_api |
| 文档 | 矩阵部分 ⏳ | 矩阵 100% 实测标注 + README 编排/策略/网页章节 |

**发布物**：v0.3 tag + CHANGELOG + README 更新（编排示例、策略 YAML 样例、网页面板截图占位）。

---

## 四、风险与依赖

| 风险 | 缓解 |
|---|---|
| zcode/cline headless 事件流不可实证 | Phase 0 即验证；失败则降级为文本捕获并在矩阵标注（已有 CopilotAdapter 先例） |
| 网页扩展破坏现有对话图 | 面板按需 module 加载 + 现状文件零改动起步；SSE 事件类型向后兼容 |
| 策略 enforcement 误伤正常任务 | 默认 ALLOW + 审计日志 + `policy_state` 可查 |
| 编排 worktree 冲突 | 合并前 diff 冲突检测 + 丢弃回滚（Polly 模式已验证） |
| 时间线超 10 周 | Phase 0/1 是硬依赖必须先行；Phase 3 面板可逐个交付 |

## 五、执行顺序建议
**Phase 0 → 1 → 2 → 3 → 4 → 5**（Phase 0 不可跳过：一切上层依赖归一化事件流）。

---

*本计划由子代理开源研究（Omnigent/deer-flow/ruflo/BossConsole/ECC/Symphony/Untrivial-ai 等）+ 本地代码实读（agent_mcp/dispatch.py、cli_adapters.py、mcp_server.py、web/index.html、docs/capability-matrix.md、tests/）双重依据生成。*

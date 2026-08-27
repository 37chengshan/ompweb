# 模型×底座选型基准快照（2026-08-24 拉取）

> **B1 数据种子**（路线图：docs/plans/2026-08-24-v3-roadmap.md）。用途：给用户的
> 客观参考数据，帮助你自己决定"哪个模型跑在哪个底座"。agent-mcp 不做自动路由——
> spawn/orchestrate 始终由你显式指定 target_cli × model。

## 数据来源与归属（必读）

- **来源一**：OpenRouter Benchmarks API，`source=artificial-analysis`
  （Artificial Analysis 指数，经 OpenRouter rankings 聚合）。
  Citation: "Source: Artificial Analysis (artificialanalysis.ai) via OpenRouter
  (openrouter.ai/rankings)" · Source URL: https://artificialanalysis.ai
  **as_of：2026-08-19T12:00:03Z**。
- **来源二**：同 API 的 `source=design-arena`（Design Arena 盲测 ELO），
  Citation/URL 见下文该节。**as_of：2026-08-24T00:02:03Z**。
  指数会漂移，引用时请标注时间点并定期重拉。
- **诚实声明**：
  1. 两源刻度不同（指数 vs ELO），本文档**分列展示、永不混排成单一榜单**。
  2. 指数为第三方聚合评测，不代表在本项目各 CLI 底座内的实际表现；本地实测
     画像用 `scripts/harness_profile.py` 从 usage 表一键生成，与榜单交叉修正。
  3. Design Arena 首批返回仅覆盖生成/可视化类目（5 行），样本有限，仅作参考信号。

## 可用性门控（availability gate）

按技能规范逐 slug 校验：全部 18 个候选的 benchmark `model_permaslug` 与
`GET /models` 的精确 id 不一致，但均通过 `canonical_slug` 归属验证到可路由模型
（例如 `anthropic/claude-opus-5-20260723 → anthropic/claude-opus-5`、
`x-ai/grok-4.6-20260810 → x-ai/grok-4.6`）。无 NOT_ROUTABLE 条目，即榜单结果
当前全部"可行动"，无需要排除的不可路由候选。

## Coding 指数 Top 10（越高越好；价格为 USD/M tokens）

| # | 模型 | coding | agentic | intel | 输入价 | 输出价 |
|---|---|---|---|---|---|---|
| 1 | openai/gpt-5.6-sol | 78.3 | 53.6 | 59.0 | $5.50 | $33.00 |
| 2 | anthropic/claude-opus-5 | 78.0 | 59.2 | 63.1 | $5.50 | $27.50 |
| 3 | x-ai/grok-4.6 | 76.8 | 58.7 | 60.9 | $2.00 | $6.00 |
| 4 | openai/gpt-5.6-terra | 76.7 | 50.2 | 56.6 | $2.20 | $13.20 |
| 5 | anthropic/claude-5-fable | 76.5 | 56.6 | 62.1 | $11.00 | $55.00 |
| 6 | moonshotai/kimi-k3 | 76.2 | 54.3 | 59.7 | $2.80 | $14.00 |
| 7 | google/gemini-3.7-flash | 76.1 | 45.1 | 56.0 | $0.19 | $0.94 |
| 8 | openai/gpt-5.5 | 74.9 | 47.4 | 56.3 | $5.50 | $33.00 |
| 9 | z-ai/glm-5.3 | 74.8 | 59.1 | 59.5 | $1.40 | $4.40 |
| 10 | anthropic/claude-4.8-opus | 74.3 | 49.4 | 57.3 | $5.50 | $27.50 |

## Agentic 指数 Top 10（多步规划/工具协作场景，与本项目最相关）

| # | 模型 | agentic | coding | intel | 输入价 | 输出价 |
|---|---|---|---|---|---|---|
| 1 | anthropic/claude-opus-5 | 59.2 | 78.0 | 63.1 | $5.50 | $27.50 |
| 2 | z-ai/glm-5.3 | 59.1 | 74.8 | 59.5 | $1.40 | $4.40 |
| 3 | x-ai/grok-4.6 | 58.7 | 76.8 | 60.9 | $2.00 | $6.00 |
| 4 | qwen/qwen3.8-max | 58.4 | 71.8 | 58.1 | $2.00 | $6.00 |
| 5 | openai/gpt-5.6-sol | 57.8 | 77.4 | 60.9 | $5.50 | $33.00 |
| 6 | qwen/qwen3.8-2.4t-a95b | 57.1 | 71.9 | 57.7 | $2.00 | $6.00 |
| 7 | anthropic/claude-5-fable | 56.6 | 76.5 | 62.1 | $11.00 | $55.00 |
| 8 | moonshotai/kimi-k3 | 54.3 | 76.2 | 59.7 | $2.80 | $14.00 |
| 9 | qwen/qwen3.8-27b | 50.9 | 68.1 | 52.0 | $0.40 | $3.00 |
| 10 | openai/gpt-5.6-terra | 50.2 | 76.7 | 56.6 | $2.20 | $13.20 |

## Design Arena 榜单（第二来源，独立刻度，勿与上表混排）

> Citation: "Source: Design Arena (www.designarena.ai) via OpenRouter
> (openrouter.ai/rankings)" · Source URL: https://www.designarena.ai ·
> **as_of: 2026-08-24T00:02:03Z**。ELO 口径（越高越好），来自盲测对战，
> 与 Artificial Analysis 指数不可直接比较。

与本项目相关的 codecategories / 前端可视化类目摘录：

| 模型 | 类目 | ELO | 胜率 |
|---|---|---|---|
| moonshotai/kimi-k3 | codecategories | 1407 | 66.1% |
| moonshotai/kimi-k3 | dataviz | 1374 | 64.7% |
| moonshotai/kimi-k3 | uicomponent | 1377 | 63.3% |

其他类目观察：gamedev/3d 类目 kimi-k3（1431/1445）领先 claude-5-fable（1383）、
claude-opus-5（1380-1382）、qwen3.8-max（1376）。两源交叉印证的结论：kimi-k3
在生成类编码任务上的第三方口碑与其 Artificial Analysis coding 分位一致。

## 面向本项目的观察（供决策参考，非自动规则）

把分数映射回 agent-mcp 的底座矩阵（底座 → 该底座可用的代表性模型）：

- **claude 底座**（Anthropic 系）：claude-opus-5 是 agentic+intelligence 双料第一，
  深推理规划场景的强底座首选；代价是输出价 $27.5/M。
- **codex 底座**（OpenAI 系）：gpt-5.6-sol 为 coding 第一；terra 用约 1/2.5 的
  输出价保住 76.7 的 coding 分，是同厂性价比位。
- **grok 底座**（x-ai）：grok-4.6 三维均衡（coding 76.8 / agentic 58.7），价格仅
  $2/$6 —— 读密集探索与中等复杂度执行的高性价比选择。
- **kimi 底座**（Moonshot）：kimi-k3 coding 76.2 接近第一梯队，$2.8/$14 中间价位。
- **gemini 底座**（Google）：gemini-3.7-flash 是全表最低价（$0.19/$0.94）却保有
  coding 76.1 —— 海量并行子任务/读密集扫描的成本底线选项（注意其 agentic 45.1
  偏低，不适合多步自主规划）。
- **多 provider 底座**（opencode / omp / pi 等）：可路由 z-ai/glm-5.3
  （agentic 第二、全场最低组合价之一）、qwen3.8 系列（agentic 第四）、
  deepseek-v4-pro（$1.32/$3.96）——跨厂商审查（Polly 模式）与预算敏感任务的
  主要池子。

**成本档位速查**（输出价口径）：极低 <$1/M：gemini-3.7-flash；低 $1–7/M：
glm-5.3、grok-4.6、qwen3.8、deepseek-v4-pro、muse-spark-1.2；中 $10–15/M：
kimi-k3、sonnet-5、gpt-5.6-terra；高 >$25/M：opus-5、gpt-5.6-sol、fable-5。

> 提示：官方 CLI 底座（claude/codex/grok/kimi…）通常绑定自家模型；要跑上表中的
> 第三方模型，用多 provider 底座（opencode/omp/pi）。这正是"模型×底座自由匹配"
> 的意义：同一个任务，你可以指定 强底座×旗舰模型 做规划、快底座×低价模型 做执行。

## 刷新方法

```bash
export OPENROUTER_API_KEY=...   # 只从环境变量读取，勿写入文件
# 对三个 task_type 各拉一次 benchmarks?source=artificial-analysis&max_results=15
# 并以 GET /api/v1/models 做 canonical_slug 门控校验（见技能 openrouter-benchmarks）
```

下次刷新建议补 Design Arena 维度并双源分列展示。

# Agent MCP + Skill 全面迭代计划（2026-08-12）

> 触发：全面迭代优化 mcp+skill。基于全量测试（3 轮：1/3/1 failed）与代码走查。
> 状态：已确认 → 执行中。

## 现状诊断

| # | 问题 | 证据 |
|---|---|---|
| 1 | 稳定测试失败：`test_mcp_stdio_end_to_end` 断言 tools/list 全量 9 工具，但 `_pruned_tools`（D5）对未声明 capability 的 client 只返 `_TOOL_PRUNE_KEEP` 4 件 | `mcp_server.py:413-442` vs `tests/test_integration.py:39-41,329` |
| 2 | flaky：同套件三次运行失败数 1→3→1，除稳定失败外有偶发用例 | 三次全量 pytest |
| 3 | 文档滞后：acceptance.md 遗留 #8/#9/#10/#11 已实现仍标未实现 | `daemon_main.py:146-157,307-339,926-929,1123`、`daemon_http.py:218-254`、`dispatch.py:147-210` |
| 4 | skill 与实际行为不一致：SKILL.md 教 9 工具，未声明 capability 的客户端只见 4 个 | `_pruned_tools` vs `skill/SKILL.md` §2 |

## 任务清单（P0→P3）

### T1 修复 test_mcp_stdio_end_to_end 断言过时
- `tests/test_integration.py`：tools/list 请求带 `_meta` capability 声明（`io.modelcontextprotocol/tools.used` 全量）→ 断言全量 9 工具；新增未声明 client 用例断言裁剪后 4 工具（守住 D5 契约）
- 验收：`pytest tests/test_integration.py -q` 全绿

### T2 消灭 flaky
- 3 轮全量收集偶发失败名；定位端口冲突/时序竞态；隔离或加等待条件
- 验收：连续 2 轮全量 0 失败

### T3 更新 acceptance.md
- 遗留 #8/#9/#10/#11 → ✅ 附证据；D5 工具裁剪记入已知设计
- 验收：无"已实现却说未实现"项

### T4 更新 SKILL.md §2 + 错误恢复表 + README
- 写明默认暴露 4 工具、声明方式（tools/list 的 _meta 扩展）、裁剪时降级路径
- 验收：skill 文档与实际 tools/list 行为一致

### T5 更新 capability-matrix.md
- 按实测刷新 omp resume、opencode 模型名等

### T6 grok 真实 CLI 冒烟
- 预热后 spawn→wait→interrupt→usage 全链路；修适配器问题
- 验收：acceptance.md grok 行 ✅ 附 usage 对账

### T7 opencode 真实 CLI 冒烟
- 指定 opencodex 模型绕开 401；同上

### T8 omp resume 实测
- `--resume` flag 实测 → 更新 OmpAdapter 与能力矩阵

### T9 Windows 分支静态核对
- 走查 `os.name == "nt"` 三处，结论写入 acceptance.md

### T10 estimate_complexity 启发式增强
- 文件数+关键词之外补改动类型信号

### T11 skill 跨宿主自动编排实测
- codex/claude/omp 新会话各跑一次六步工作流

### T12 _pruned_tools 兜底注释修正
- 注释"三件"与 `_TOOL_PRUNE_KEEP` 四件不符，顺手修

## 执行顺序

```
T1 → T2（P0 清零）
T3 → T4 → T5 → T12（文档对齐，可与 P0 并行）
T6 → T7 → T8（真实冒烟，可并行，受登录态制约，阻塞则如实标 ⏳）
T9 → T10 → T11（收尾）
```

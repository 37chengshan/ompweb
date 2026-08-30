# 4.x 性能基线（W0 记录，未冻结）

- 生成：`node scripts/perf-session-bench.mjs`（可重复运行；JSON 见 `perf-baseline.json`）
- 参考环境：macOS darwin 25.6.0 / Apple M1 Pro / 16GB / node v24.14.0（ADR-007 已登记为主基线记录机）
- Fixture：Sessions-L（1,000 sessions，实际索引 1,003 含 Chat-S/L/XL）+ Chat-S（100 turns/120 entries）+ Chat-L（1,000 turns/1,200 entries, 406KB）+ Chat-XL（5,000 turns/6,000 entries, 2.0MB），确定性 seed，hash 已入库
- 数值口径：p50/p95/mean，单位 ms；`--runs 12`
- 冷口径：每轮先 `invalidateSessionListCache()`（清 list 缓存 + walk 缓存 + entries 缓存）再测；暖口径：entries 缓存（size+mtime 键）命中
- 正确性护栏：bench 内置断言，`buildSessionContext` 返回 0 条消息即失败（杜绝把"解析不出内容"误记为性能数据）

| 指标 | p50 | p95 | 说明 |
|---|---|---|---|
| listAllSessions 冷 | 14.8ms | ~161ms | p95 含首次 JIT/冷页缓存；稳定后接近 p50×2 |
| listAllSessions 暖（30s TTL） | ~0ms | ~0ms | 缓存命中 |
| contextLoad Chat-S 冷 | 0.35ms | 1.44ms | 120 entries，建树 + 上下文映射 |
| contextLoad Chat-L 冷 | 2.8ms | 3.3ms | 1,200 entries |
| contextLoad Chat-XL 冷 | 14.8ms | ~49ms | 6,000 entries |
| contextLoad 暖 | 0.08–2.9ms | — | 随规模线性 |
| 原始 JSONL 解析 | — | — | 259 MB/s（1,203 行 / 406KB） |

## 用法约定

1. **同机对比才有效**（ADR-007 规则）。Rust Host（06）等价迁移后用同一 harness、同一 fixture hash 对比。
2. 冻结规则：本表数字是 4.x 记录值，不是预算。预算冻结按 ADR-007（输入 p95 ≤ 50ms、点击 p95 ≤ 100ms 等硬上限已生效；冷启动/绝对值待补浏览器侧基线）。
3. 浏览器侧（INP、长任务、DOM/heap on Chat-XL、启动分段、Stream、PTY 交互延迟）依赖截图/e2e runner 的工具决策（见 `ui-fixture-matrix.md` 末节）；工具落地后扩展本 harness，不改变已记录的服务端数字口径。
4. 回归判定：同一 fixture、同一机器上 p95 退化 > 5% 需要解释或批准。

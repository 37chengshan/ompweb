# ADR-007 — 性能参考环境、Fixture 与预算冻结规则

状态：草案（参考环境与硬上限已登记，绝对数值待 W0 实测冻结）· 日期：2026-08-30 · 关联：`12-performance-quality-migration-release.md`、`baseline/`

## 参考环境（W0 已登记）

| 环境 | 用途 | 状态 |
|---|---|---|
| macOS Apple Silicon（16GB，本机，darwin 25.6.0 arm64） | 主基线记录机：session 解析、长对话、PTY、冷启动 | **W0 采用** |
| Windows 11 中档 x64 | Desktop/ConPTY/WebView2 矩阵 | 待登记硬件 |
| Linux（WebKitGTK 发行版） | Tauri Linux 矩阵 | 待登记硬件 |
| 中端 iPhone / Android | Mobile spike 阶段 | ADR-006 后 |
| Chrome/Safari/Firefox 当前版 | Web 客户端矩阵 | 待登记版本号 |

所有报告记 p50/p95；冷启动每次清理规定缓存，暖启动单独统计；记录 OS/CPU/RAM/Node/OMP 版本。

## 已决定的硬上限（冻结前即生效，防止"基线本来就慢"）

1. 文本输入到下一帧 p95 ≤ 50ms，p99 ≤ 100ms。
2. 常用 click/expand/menu p95 ≤ 100ms；持续 >200ms 的操作必须有即时反馈。
3. streaming 期间主线程无持续长任务；completed transcript 不随 token 重渲染。
4. Chat-XL DOM message shell 有硬上限：加载全部历史后不随总消息数线性增长。
5. PTY flood 时 cancel/approval 的 P0 控制延迟不劣化。
6. 相同功能 p95 退化不得超过 5%（超过需明确用户收益 + 批准记录）。

## Fixture 集合（12 定义的子集，W0 先落）

| Fixture | 规模 | W0 落地物 |
|---|---|---|
| Chat-S | 100 messages | `scripts/gen-session-fixtures.mjs`（确定性生成 + 固定 hash） |
| Chat-L | 1k messages（Markdown/code/tool/image metadata） | 同上 |
| Chat-XL | 5k messages | 同上（按需生成，入库 hash 不入库文件） |
| Sessions-L | 1k sessions + worktree/branch/archive | perf harness 现场生成于临时目录 |
| Stream / PTY / Event / Network | 10–120 updates/s；echo + 100MiB；10k/100k events；delay/loss | W1/W2 各自 PoC 时落地 |

Fixtures 不含真实用户秘密，可重复生成并以 sha256 固定。

## 待冻结（W0 基线运行后）

1. 冷启动分段计时（process → first frame → static interactive → host connected → recent session）的绝对预算。
2. idle RSS、安装包体积、session list p50/p95、Chat-L/XL 打开/滚动/输入的基线数值。
3. 各平台 screenshot/动画阈值（不允许全局大阈值掩盖偏移）。

## 已决定的方法

- React Profiler 记录 commit；交互用 Event Timing/INP 或等价 input-to-paint；不看平均 FPS。
- 基线结果存 `docs/refactor/ompweb-5.0/baseline/perf-baseline.json` + md 摘要，含硬件与版本信息；同机对比才有效。
- 浏览器侧 INP/长任务基线依赖 Playwright（仓库当前无 e2e 设施）——列为待工具决策，见 baseline/README。

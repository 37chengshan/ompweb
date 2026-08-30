# 12 — 性能、质量、迁移与发布总门

## 目标

为全部工作包提供统一的性能预算、视觉/动画回归、可靠性、安全、兼容和回滚门。任何“更快”“更轻”“不卡”都必须在固定 fixture、固定硬件和重复测量中成立。

## 基线方法

### 参考环境

至少登记：

- macOS Apple Silicon 主力机；
- Windows 11 中档 x64；
- Linux WebKitGTK 目标发行版；
- 中端 iPhone 与 Android；
- Chrome/Safari/Firefox Web；
- 本地、LAN、受控高延迟/丢包、Relay simulator。

每项记录 OS、CPU、RAM、磁盘、WebView/browser、Node/Rust/OMP 版本。报告 p50/p95，冷启动每次清理规定缓存，暖启动单独统计。

### Fixture

| Fixture | 规模/内容 | 用途 |
|---|---|---|
| Chat-S | 100 messages | 日常交互 |
| Chat-L | 1k messages，Markdown/code/tool/image metadata | 长对话 |
| Chat-XL | 5k messages / 大 session JSONL | 极限窗口、内存、搜索 |
| Sessions-L | 1k sessions + worktrees/branches/archive | sidebar/index |
| Stream | 10/30/60/120 updates/s | coalesce、commit、输入竞争 |
| PTY | small echo + 100MiB output | 控制延迟与吞吐隔离 |
| Event | 10k/100k reliable events | replay/snapshot/checkpoint |
| Network | delay/loss/drop/reorder/switch | reconnect/resume |

Fixtures 不包含真实用户秘密，必须可重复生成并固定 hash。

## 性能预算冻结规则

W0 先测 4.x；随后冻结实际数字。冻结前先使用以下硬上限，避免“基线本来就慢”成为借口：

- 文本输入到下一帧 p95 ≤ 50ms，p99 ≤ 100ms；
- 常用 click/expand/menu p95 ≤ 100ms，任何持续 >200ms 必须有即时反馈；
- streaming 期间主线程不出现持续长任务，completed transcript 不随 token 重渲染；
- Chat-XL DOM message shell 有硬上限，加载全部历史后仍不随总消息数线性增长；
- Chat-L/XL 滚动在参考设备上无可感知连续掉帧和锚点跳动；
- PTY flood 时 cancel/approval P0 控制延迟仍在 Remote budget；
- idle CPU 接近平台空闲，后台/隐藏页面停止非必要动画和高频采样。

冷启动、RSS、包体、replay、sidebar、LAN/Relay RTT 的绝对数在基线采集后冻结。默认规则：相同功能的 p95 不得退化超过 5%；超过必须有明确用户收益和批准记录。

React 使用 Profiler 记录 commit，交互使用 Event Timing/INP 或等价 input-to-paint，不能只看平均 FPS。[React Profiler](https://react.dev/reference/react/Profiler) · [web.dev INP](https://web.dev/articles/inp)

## 启动性能分解

分别计时：

```text
process launch
→ first window/frame
→ static UI interactive
→ Host connected
→ recent session visible
→ OMP ready（只有需要 live action 时）
```

优化原则：

- UI 不等待全 session scan、models refresh、update check；
- Host daemon 可复用但必须同时报告“Host 已运行”和“真正冷 Host”；
- heavy renderer/settings 按需加载；
- skeleton 和原有启动动画保留，不能用空白窗口作弊；
- 失败状态可交互并可诊断。

## 长对话与交互质量门

- DOM/heap snapshot 对 Chat-S/L/XL；
- prepend/append、图片/diagram 异步高度、branch 切换无 scroll jump；
- text selection/copy/browser find/minimap/fork/lightbox 全保留；
- 流式期间键盘、slash/@ menu、model dropdown 不被大 Markdown parse 阻塞；
- lazy Mermaid/KaTeX/PDF/DOCX 不阻塞首屏；
- memory 在反复打开/关闭 20 个长 session 后可回落，无 detached nodes 持续增长。

## UI 与动画发布门

1. 黄金截图：主题 × 语言 × viewport × 核心状态。
2. Motion manifest：keyframes、transition、Web Animations、SMIL、splash。
3. 动画测试：首帧/中间帧/终帧、duration/easing、重复次数、hidden/reduced-motion。
4. Tauri/Web/Mobile 分平台阈值，不允许全局大阈值掩盖偏移。
5. 任何 token/组件/动画删除或替换必须是独立视觉变更，不得混在 runtime PR。

## 测试矩阵

### 每 PR

- typecheck、lint、相关 unit/contract；
- API/adapter contract fixtures；
- targeted screenshot/motion；
- changed-path microbenchmark；
- `git diff` 检查 generated/用户文件未误改。

### 每夜

- 全 unit/integration/e2e；
- SSE/WS/Host adapters parity；
- Node/Rust shadow equivalence；
- Chat-L/XL、Sessions-L、Stream、PTY、Event benchmark；
- OMP current + supported minimum version；
- dependency/license/security scan。

### Beta/RC

- 三桌面平台 + 两移动平台实机；
- LAN/VPN/Named Tunnel/Relay；
- sleep/wake、kill -9、disk full、SQLITE_BUSY、network switch；
- threat model/security review；
- migration/rollback/update/signing 演练；
- 24h/72h soak 与内存/DB/日志增长。

## 迁移波次

### M0 — Baseline 与止血

- 冻结 fixtures、视觉、动画、性能；
- Quick Tunnel 降级文案和非 loopback 安全诊断；
- 完成 ADR-001/002/003/004/005/007。

### M1 — Facade 与语义

- UI → OmpwebClient；
- Event/Resume oracle；
- HTTP/SSE 默认、WS shadow。

### M2 — Protocol 与 Security Canary

- WS event/resume、device enrollment/security PoC；
- 只在 loopback/测试设备启用 mutation。

### M3 — Rust Host Shadow/Canary

- Projection shadow；
- 按 service/session 切 Supervisor、PTY、FS、Git；
- 单写、可回 Node。

### M4 — Web Static + Parity

- static client；
- Settings/Commands registry；
- 长对话窗口和 bundle 优化；
- UI/动画完全保真。

### M5 — Relay/Tauri/Mobile Beta

- 单 region blind relay；
- Tauri 与 Electron 并行；
- Mobile 核心 vertical slice + push attention。

### M6 — Default 与 Legacy 收敛

- 以真实 canary 指标逐平台默认；
- legacy 使用率、错误率、rollback readiness 连续达标；
- 至少一个稳定周期后才删除旧实现。

## Release Channel

| Channel | 允许 | 必须 |
|---|---|---|
| Nightly | 实验协议/adapter | 可回退、数据不破坏、自动 diagnostics |
| Alpha | internal/opt-in | contract、recovery、UI/perf baseline |
| Beta | public opt-in | security review、migration、平台 matrix、telemetry |
| RC | 默认候选 | rollback/update/signing/soak 全通过 |
| Stable | 广泛默认 | 全门通过、已知风险和兼容窗口文档化 |

## 观测

本地 diagnostics 至少包含：

- app/Host/OMP version 与 uptime；
- startup stage timings；
- active sessions/processes；
- event rate/journal size/replay/snapshot/checkpoint；
- current path/RTT/reconnect/resume/failure code；
- bounded queue depth/dropped coalesced/ephemeral counts；
- React commit/long task/INP（opt-in、脱敏）；
- PTY queue、session index duration、memory watermark。

日志默认不含 prompt/code/terminal/secret。可导出诊断包前展示包含字段并再次脱敏。

## 回滚门

- 任何 default 切换都有同版本 feature flag 回旧 adapter；
- migration 不批量改 OMP-owned file；Projection DB 可删重建；
- protocol 至少兼容前一稳定 minor；
- device identity migration 需要重新 enrollment，不把旧 Cookie 静默提升为高权限身份；
- Tauri 默认后 Electron 保留一个稳定周期；
- Relay outage 不影响 LAN/VPN，也不撤销 device identity。

## 总 Definition of Done

- 冷启动、长对话、输入、滚动、流式、PTY、sidebar 和 replay 满足冻结预算；
- UI 风格、主题、组件、动画、reduced-motion 无未经批准变化；
- OMP 权威状态可自动收敛，Runtime DB 可重建；
- Remote 恢复、设备撤销、capability、relay confidentiality 通过安全门；
- Tauri/Web/Mobile 使用同一 Client/Contract；
- Settings/Commands 能跟随 installed OMP 能力并安全降级；
- 更新、迁移、回滚、诊断和运维文档均完成；
- Stable 不依赖“以后再补”的 P0 安全或性能工作。

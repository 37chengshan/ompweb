# W0/M0 基线产物索引

首批实施（13 号交接文档 W0/M0 + 01 Slice 1）的可验证产物。全部基线可重复生成；
再生成属于"刻意变更"，必须在 PR 说明并同步刷新对应 golden。

## 产物

| 产物 | 位置 | 再生成 / 校验 |
|---|---|---|
| 直接 API 调用清单（138 calls / 29 files，按领域/读写/stream 分类） | `api-call-inventory.json` + `.md` | `node scripts/audit-client-api.mjs`（`--check` 校验） |
| ESLint 防回退 allowlist | `scripts/client-api-allowlist.json` | `node scripts/audit-client-api.mjs --update-allowlist` |
| Motion manifest（31 keyframes、30 组件面、tokens、SMIL、theme/splash） | `motion-manifest.json` | `node scripts/motion-manifest.mjs`（`--check` 校验） |
| UI/动画 fixture 矩阵（状态×主题×语言×视口×reduced-motion） | `ui-fixture-matrix.md` | 文档；截图 runner 待工具决策 |
| 会话 fixture 生成器（Chat-S/L/XL 确定性生成 + sha256） | `scripts/lib/session-fixture-gen.mjs` + `scripts/gen-session-fixtures.mjs` | hash 冻结于 `lib/session-fixture.test.mjs` |
| 4.x 服务端性能基线 | `perf-baseline.json` + `.md` | `npm run bench:session` |
| 桌面启动基线（doc 14 T1.9：窗口出现/就绪/首帧/会话恢复 p50/p95） | `startup-baseline.json` + `.md` | 桌面实测（`npx electron .` + `desktop/startup.js` 日志阶段时间戳） |
| 错误码 contract golden（107 codes） | `lib/contracts/fixtures/error-codes.json` | `node scripts/audit-error-codes.mjs`（`--check` 校验） |
| Agent/Session contract fixtures（SSE 帧、SessionInfo、envelope、toolCall 归一） | `lib/contracts/fixtures/*` + `lib/contracts/agent-envelope.ts` | `lib/contracts/agent-contract.test.mjs` |
| ADR 草案 001–007 | `../adr/` | 状态见 `../adr/README.md` |

## 防回退门（每条都接入了测试或 lint）

1. 新的直接 `/api` fetch / `EventSource`（含 `window.fetch`、动态前缀模板、`*ApiUrl` helper）→ ESLint error（allowlist 外）。
2. allowlist / inventory 漂移 → `lib/api-inventory.test.mjs` 失败。
3. 动画删除/改节奏/改 easing/reduced-motion 块内容变更、globals.css transition 数量变化、组件 `<style>` 与 `desktop/main.js` 内 keyframes 变更 → `lib/motion-manifest.test.mjs` 失败。
4. 错误码增删 → `node scripts/audit-error-codes.mjs --check` 失败（contract test 引用同一纯函数并另行比对 golden；脚本 import 无副作用）。
5. fixture 非确定性 / v3 布局破坏 → `lib/session-fixture.test.mjs` 失败。

已知边界（不构成门，避免言过其实）：XHR/sendBeacon/自建 WebSocket 不在 ESLint 规则范围；非常量（如 `"code_" + x` 拼接）形式的错误码不被 golden 扫描捕获；内联 transition 只记数量不记值。

## W0 首批验收对照（13 号文档）

- [x] 基线报告可重复（固定 fixture + hash；p50/p95，硬件已登记；冷/暖口径与 0 消息护栏见 `perf-baseline.md`）
- [x] motion manifest 能检测删除/节奏/终态/reduced-motion 回归（覆盖 globals.css、组件 `<style>`、desktop/main.js、SMIL、theme/splash；截图 runner 待决策，矩阵已冻结）
- [x] 直接 API 调用清单完整 + 新调用防回退生效
- [x] ADR 草案区分已决定/待 spike/外部依赖
- [x] Quick Tunnel / 非 loopback 安全语义准确（三语言 + 设置页两处警告；注：tunnelUrl 展示行为容纳警告行加了一层 column 容器，内层样式未动）
- [x] typecheck / lint / 测试通过（496 tests, 0 fail）
- [x] `git diff` 不含 `.mimosa/`（已 ignore）或用户无关改动

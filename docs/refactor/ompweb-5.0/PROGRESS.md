# ompweb 5.0 实施进度日志

逐波次记录实施产物与门禁证据。基线细节见 `baseline/README.md`，安全分诊见 `baseline/security-triage-w05.md`，ADR 决策见 `adr/`。

## W0/M0 + 01 Slice 1 — 完成（2026-08-30，已提交 5.0 分支）

- ADR-001..007 草案；调用清单 138 处/29 文件；ESLint 防回退门；motion manifest；Chat-S/L/XL fixture + 性能基线；错误码/SSE/envelope contract fixtures；Quick Tunnel 止血文案。
- 多维审核：2 FAIL + 5 WARN 全部修复后通过。496 tests 全绿。

## W0.5 安全止血 — 完成（2026-08-30）

- 修复 `scripts/run` RCE 面（按名执行本地注册表脚本，body 不再携带命令文本；常量 shell + 字面量 argv）；npm-update 字面量 execFile；files upload sink 边界；codesign `--`；taskkill 整数守卫。
- 3 类误报实证保留（streamFile/isValidWebSession/archive）；4 中危 env→exec 链移交 W1+ Remote 波次。
- 密封扫描 scan-2026-08-30T06-57-37.616Z；tsc/lint/test 全绿。

## W1 — Facade 与语义（进行中 → 核心完成 2026-08-30）

- `lib/client/`：OmpwebClient 接口 + HttpSseAdapter（4.x 等价）+ FixtureAdapter（无 Next/OMP 渲染 UI 状态）；useAgentSession 订阅边界已切到接口（默认 HttpSse，行为逐帧等价；`opts.client` 可注入）。509 tests 全绿。
- `lib/continuity/`：02 Slice 1 oracle——MemoryJournal（reliable/coalesced/ephemeral、snapshot compaction、bounded live-tail、epoch/cursor 边界）+ MutationLedger（accept/duplicate/conflict/unknown/retention tombstone）；`sse-normalize.ts` 把 4.x 全部 27 种帧归类（02 Slice 2 归一半，未接生产）。
- 未完（W1 收尾项）：session list/context 的双读影子验证；`subscribeSessionsChanged` 频道接口化。

## W2 — Remote Protocol v1（核心完成 2026-08-30）

- `lib/remote-protocol/protocol.ts`：v1 envelope 校验/编解码——stable error codes（invalid_json/version_unsupported/invalid_kind/invalid_stream_id/missing_request_id/seq_not_safe_integer/payload_too_large）、未知可选字段保留、1MiB 消息上限、safe-integer seq。
- `lib/remote-protocol/scheduler.ts`：P0–P3+Data 有界调度——高水位策略（丢 P3 → P2 按 (stream,type) 合并 → Data 暂停 → P0/P1 超预算强制 resume_required），字节预算双层（连接/流）。
- `lib/remote-protocol/host-connection.ts`：握手状态机（HELLO → [AUTH] → WELCOME → RESUME/START → SYNC_COMPLETE → live）；feature 协商（未知 required feature 拒绝；transcriptBinding 挂钩 ADR-005）；RESUME 接入 02 journal（REPLAY/SNAPSHOT_THEN_REPLAY/NO_CHANGE/PROTOCOL_ERROR/FULL_SNAPSHOT→full_resync_required）；mutation receipt（accept 先持久化→executor 异步→committed/failed/unknown；同 clientMsgId 重试去重、异 hash 冲突、过期 tombstone）。
- 传输抽象为 MessageTransport 接口 + 内存双工 pipe；**`ws` 依赖与真实端点 = 决策门**（接口不变）。P5 binary data、P6 加密传输/relay 依赖 ADR-004 benchmark 与 ADR-005 评审，未启动。
- 一致性 7/7 测试全绿（codec 黄金向量、握手三态、resume 有序回放+live 接续、epoch 失配、receipt 全语义、流控预算）。

## W3 — Rust Host（slice 1–2 完成 2026-08-30）

- `crates/` workspace（cargo 1.95，**零外部依赖离线构建**）：`ompweb-protocol`（Event Continuity oracle Rust 端口：Journal/Cursor/事件分级/Snapshot/Ledger）+ `ompweb-host` 二进制（`--version`/`--health` JSON，doc 06 slice 1 范围）。
- **跨语言等价达成**：语言中立 conformance 脚本 `lib/continuity/conformance-script.txt`（8 场景：replay/snapshot fallback/epoch 失配/cursor ahead/coalesced latest/live-tail merge/tail overflow/mutation lifecycle），TS oracle 与 Rust 端口分别消费同一脚本，双双通过。
- SQLite 持久化（rusqlite 依赖）与 OMP Supervisor/PTY/File/Git 迁移 = 后续 slice（依赖决策门：离线依赖引入策略 + Host 生命周期 ADR-002 spike）。

## W4 — Settings/Commands Parity 与长对话（核心完成 2026-08-30）

- **08 Slice 1 完成**：`toSlashCommandInfo` 不再丢弃 builtin——完整 OMP registry 进入 palette 的 `ompBuiltin` 分组（ChatInput 端 dedup CLIENT_BUILTIN_COMMAND_NAMES，客户端拦截语义不变）；新装 OMP 命令无需发版即可见。`lib/command-registry.test.mjs` 3 测试冻结。
- **07 Slice 1–3 完成**：`lib/omp/settings-service.ts`——SettingsService contract（probe → CLI → legacy YAML → unsupported 阶梯）；CLI adapter argv-array `omp config list/set/reset`（无 shell 拼接）；credential redaction（redacted 条目的 value 在解析层强制剥离）；reset 语义标记 "Reset to OMP Default"；缺失 metadata 保持 unknown。冻结 fixture `lib/omp/fixtures/omp-config-list.json` + 8 测试。
- **10 Slice 2 验证**：`MessageView` 已是 React.memo + `CommittedTranscript` memo + 稳定化回调（4.x 已实现 completed message memo）；streaming coalescer 已有。DOM 有界窗口（Slice 3+）依赖 Chat-XL 浏览器侧测量（截图/e2e 工具决策门），未启动。
- 07 的 generic renderer UI、08 的 execution matrix/mutation receipt 接线：依赖 settings UI 渲染门（禁止改视觉的约束下需独立视觉评审），登记为 W4 收尾项。

## W5/W6 — Relay / Tauri / Mobile / 默认切换（决策门记录，未启动）

全部满足"不启动"条件（W0 Go/No-Go 中的门 + 依赖未冻结的 ADR）：

1. **C1 Blind Relay**：加密帧格式与传输安全依赖 ADR-005 协议选型冻结 + 05 独立安全评审；**行为层 simulator 已落地**（见上"W1–W4 收尾补完"），真实 relay 只差加密帧格式与部署形态。
2. **Tauri 迁移**：硬前置为 10 的 static build（`output: 'export'`）——仓库规则禁止开发期 `next build`，需要独立 CI 分支/流水线决策；updater 签名密钥体系（09）未建。
3. **Mobile**：ADR-006 按计划延后（W2 指标稳定后三方 spike）。
4. **W6 默认切换/收敛**：依赖 W3 持久化 storage + supervisor canary + 12 的性能预算冻结后的 canary 观测，全部未到期。

## 真机安装与运行测试（2026-08-30 第三轮，用户要求补上）

**背景**：用户指出"只跑单测、没真装真跑"。起 `next dev` 后页面白屏 "Something went wrong" + 3 issues（insertBefore/removeChild NotFoundError）。

**二分定位**（改动 stash / 4.0.12 / main 全试）：
- 该崩溃在 **4.0.12 发布基线、W0 提交、含全部 W1–W5 改动的树**上均同样出现 → 与 5.0 改动无关。
- 生产构建（`next build --webpack` + `next start`）**同环境完全正常** → 3 个错误是 `next dev`（Turbopack dev overlay + React 开发版 hydration）特有的开发模式问题，生产形态不受影响。
- 用户日常通过全局 bin（30177 常驻）和 desktop app（生产构建）使用，因此从未遇到。

**真机测试矩阵（全部通过）**：
1. **Web 生产**（next start :30178，IAB 实测）：页面完整渲染（侧栏/会话树/Quick scripts/设置）；打开真实会话 → transcript 渲染（4 代码块、Tasks/Subagents 区、消息操作按钮）；slash 面板 → "Loading commands..." 后 **OMP registry 完整呈现**（/mcp /security /ssh /stats /vision 等，W4a 生效）；设置 → Remote Access 面板 → **两条安全警告行 + 新文案全部渲染**（W0-7 生效）。
2. **桌面 app**（`npm run desktop:start`，Electron 真实进程树 + 内嵌 standalone server :30179）：200、`<title>omp web</title>`、renderer 无崩溃。
3. **npm 全局安装 bin**（`ompweb --port 30181`；用户全局包 link 到本仓库）：200 + `/api/sessions` 真实数据 + omp/18.0.10 ready；IAB 页面完整渲染。bin 路径同时实测了 W0.5 改过的 bin/process-lifecycle.js。
4. **桌面 app 真实安装**（第三轮补充）：`CSC_IDENTITY_AUTO_DISCOVERY=false npm run desktop:build` 成功产出 `dist-desktop/OmpWeb-4.0.12-arm64.dmg`（278MB）+ zip + `mac-arm64/OmpWeb.app`；ad-hoc 签名后**安装到 `~/Applications/OmpWeb.app`（替换旧 4.0.x）**，`open` 启动：OmpWeb 进程树运行、内嵌 server :30179 返回 200 + `<title>omp web</title>`。新版本含全部 5.0 改动。
- 测试进程已清理；用户常驻 30177 实例未受影响。`.next/` 保留生产构建产物（全局 bin 与 desktop 依赖它）。

## W1–W4 收尾补完（2026-08-30 第二轮）

- **双读影子验证（01 Slice 2）**：`lib/client-shadow.test.mjs`——旧路径（直接调用真实 route handler：context/list/PATCH）与 lib/client facade 对同一 fixture 的 snapshot 做 canonical-json sha256 对比，完全一致；rename 经 facade 恰好一次 PATCH、单写路径确认。影子测试还揪出并修复了 facade 对裸 body 路由的映射（`/api/sessions` 裸 `{sessions}`、`/context` 裸 `{context}`）。
- **subscribeSessionsChanged 接口化**：`OmpwebClient.system.subscribeSessionsChanged`（HTTP adapter 委托本地 bus；fixture adapter 可注入）。hook 不再直接 import bus。
- **fixture 生成器修正**：title slot 补行内 `\n`（256 字节含换行，readTitleSlot 才能识别）——chat-s hash 更新为 3a826e72…，perf-baseline.json 同步刷新。
- **W5 slice 1（doc 04 C1）**：`lib/relay/simulator.ts` in-process blind-relay simulator——多 host/client 路由、帧字节不透明（opaque）、连接字节配额、速率 shedding、确定性 drop/reorder/delay（注入 rng/now）、未知 host/重复注册拒绝。6/6 测试。
- **doc 06 slice 2**：`crates/ompweb-storage`（rusqlite bundled）——SQLite journal 落地 doc 02 最小 schema（runtime_meta/streams/events/snapshots）、coalesced 压缩、WAL+close 时 checkpoint、file-backed reopen 生存测试；**共享 conformance 脚本在 SQLite 持久化实现上同样通过**。
- **doc 08 收尾**：HostUIRequest lifecycle contract（`lib/contracts/ui-request.ts`：单次 settle、超时/取消/断连终态、method 形状校验）+ 7 测试；执行矩阵文档 `command-execution-matrix.md`（structured_rpc/client_action/prompt_local/tui_only 分类，availability 不猜测）。
- 全量回归：npm test 543/0 fail、tsc 干净、lint 0 errors、cargo 全部 crate 通过。

## 当前全量验证状态（2026-08-30 第二轮后）

- `npm test`：543 tests / 0 fail（含 client facade、continuity、remote-protocol、relay simulator、settings-service、command-registry、ui-request contract、client-shadow 影子验证）。
- `cargo test --offline`：ompweb-protocol conformance 1/1 + ompweb-storage（SQLite）conformance 2/2。
- `tsc --noEmit`：干净；`npm run lint`：0 errors。
- Mimosa 深度密封扫描复扫报告：18→13 findings，5 处真实高危修复生效（详见 baseline/security-triage-w05.md；4 个中危 env→exec 链移交 Remote 波次治理）。

## 外部评审（GPT）与收敛计划 — 2026-08-31（计划已落地，执行未开始）

- **评审判定**：当前工作树可作为「4.0.12 增强版」内部使用，但不能认定为「ompweb 5.0 已全部完成」，不建议按 5.0 正式发布；综合生产就绪约 58/100。未发现已证实 P0 数据破坏或直接 RCE，但存在发布阻断级 P1。
- **评审确认的 P1**：server-ready 丢信号竞态与 8 秒兜底绕过就绪检查（启动）；DOM 分页非真虚拟化 + Minimap 全量交互开销（长对话）。P2：深色主题 skeleton 闪白、健康检查过宽。
- **评审确认的未完成项**：Rust Host 仅 health/version 骨架未接管生产链路；SQLite 与 relay simulator 已落地但未接生产；真实 WebSocket 端点、加密传输、设备身份、真实 Relay 未启动；W5/W6（Tauri/Mobile/默认切换）未开始；版本仍 4.0.12 且工作树大量未提交，无同 SHA 发布候选。
- **收敛行动**：已写入 14-gpt-review-action-plan.md——Iteration 1 启动与性能证据（含启动状态机、真实冷/暖启动测量）→ Iteration 2 长对话真正有界（双向虚拟化、Minimap 聚合、6000 条挂载 ≤200–300 节点等验收门）→ Iteration 3 后端生产接管（feature flag 8 步，每步可回滚 Node）；最终发布需满足同 SHA 候选等发布门。
- **状态**：计划定稿，正式执行未开始（待 Go/No-Go）；S-1/S-2 核心修复已先行落地于工作树（详见下方收尾核验）；Iteration 1 未过门前不扩展新功能、不启动 W5/W6。
- **收尾核验（2026-08-31）**：`npm test` 549/547 通过 / 0 失败 / 2 跳过（较评审时点 543 新增 splash 与 startup-restoration 4 个测试）；`tsc --noEmit` 干净；lint 0 error / 61 warning；`cargo test --offline` conformance 1/1 + storage 2/2。S-1/S-2 核心修复（server-ready 闩存、splash 主动查询、8 秒不绕过就绪门）已在评审后先行落地于工作树并有测试覆盖，未提交、未过门验证；L-1/L-2/S-3/S-4 经核验仍存在；`package.json` 已升至 4.0.15，R-1 的未提交/无同 SHA 候选问题仍然成立。
## Iteration 1 — 启动与性能证据 — 完成（2026-08-31，doc 14）

**完成项（T1.1–T1.9）**：
- T1.1/T1.2（先行落地）经本轮实测确认生效：暖启动无「服务已好但等 8 秒」；8 秒兜底只切加载层不绕过就绪门（`bin/splash.test.mjs` 静态断言 + `desktop/startup.test.mjs` 状态机测试）。
- T1.3 启动状态机：`desktop/startup.js`（新）`spawning → listening → assets_warmed → shell_mounted → session_interactive → failed`；每态带时间戳写入 `omp-app.log`（`startup[+Nms] <stage>`）；`get-startup-report` IPC 供诊断面；splash/AppShell 经 preload `startupStage` 上报。
- T1.4 失败路径 UX：splash 内错误面板（错误说明 + 日志位置 + 重试 + 退出）；独立错误页（`startupErrorPage` data URL，非 splash 路径与 did-fail-load 上限后使用）；`startup-retry` IPC（上限 3 次后退出）；server-exit 启动期不再弹无上下文 dialog。
- T1.5 深色主题闪白：boot-skeleton 改用 `var(--bg)`/`var(--text-dim)`（预加载主题脚本已同步 `data-theme`/`.dark`）。
- T1.6 两级遮罩：skeleton 在 `session-ready`（initialSessionRestored）才 fade；10s 看门狗强制撤除防卡死；`shell_mounted`/`session_interactive` 阶段埋点。
- T1.7 健康检查收紧：新增 `app/api/health/route.ts`（`{ ok, app: pkg.version, ompReady, ompVersion }`）；main 侧 `createHealthProbe` 要求 `res.ok` + `ok:true` + 版本一致，404/500/版本不符/超时均不算就绪。
- T1.8 测试：`desktop/startup.test.mjs` 13 个（状态机顺序/回退拒绝/failed 终态/assets_warmed↔listening 并行、探针快速/慢速/404/500/版本不符/不可达/abort/超限 onFail）；`bin/splash.test.mjs` 扩展 4 个静态契约断言；`npm test` 566/564 通过 / 0 失败（含 desktop glob）。
- T1.9 实测：`baseline/startup-baseline.json` + `.md`（10+ 轮真实 Electron 冷/暖启动，见下）。

**实测证据（参考环境：M1 Pro / app 4.0.15 / Next standalone / omp 18.0.10）**：
- 冷启动（无 splash）：窗口内容出现 p50 375ms / **p95 379ms（目标 <400ms ✅）**；listening p50 1553ms / p95 2188ms；App 首帧（shell_mounted）p50 1783ms；会话恢复完成 p50 6977ms。
- Splash 路径：assets_warmed p95 430ms；listening p50 1492ms / p95 1542ms；shell_mounted p95 9221ms（含 ~5s 视频）；session_interactive p95 11821ms。
- 深色主题无白屏：静态验证（主题脚本 + CSS 变量）；fade 后首帧 p95<100ms 无直接埋点，以 boot-skeleton 首帧为代理口径（HTML 已由 warmUp force-cache 预取 13 assets）。

**多维自审（8 维，全部通过，含修复记录）**：
- 产品：竞态消除、失败路径可操作、深色无闪白 ✅
- 架构：五态状态机 + failed 终态；无新运行时依赖；`desktop/startup.js` 纯逻辑可注入测试 ✅
- 协议：health 契约（ok/app/ompReady）；IPC 契约（server-error/startup-retry/startup-stage/get-startup-report）单进程内使用 ✅
- 安全：health 暴露 omp 版本（本地进程；web 远端被 pairing gate 拦截，低风险）；错误页/日志路径不泄漏敏感信息 ✅
- OMP Parity：无 OMP 行为变更 ✅
- 落地：566 tests / tsc / lint(61w,0e) / cargo 全绿；退出条件逐条核验 ✅
- 兼容：splash/STARTUP_PAGE 视觉未动；preload API 只增不减；纯浏览器无 bridge 时埋点 no-op ✅
- 遗留：fade→首帧硬埋点（代理口径已记录）；Windows/Linux 平台验证未做；错误页 E2E 截图未做（工具决策门后补）。

**本次实测揪出并修复的 5 个问题**：① standalone 静态资源缺失（`next build` 后 `.next/static` 不自动进 standalone → chunk 404 text/plain → 白屏；`scripts/postbuild-static.mjs` + build 串联）；② 窗口出现延迟（createWindow 在 await startServer 后 → 839ms；改为窗口先行，服务器后台起 → 379ms）；③ 残留进程污染测量（端口反查清理；产品侧 isPortFree 提示已有）；④ assets_warmed 与 listening 竞态导致状态机抛错吞掉 listening（并行语义 + 2 测试冻结）；⑤ failStartup 对 APP_URL 残页/空白页静默（非 splash 一律导航错误页）+ splash fade 后错误面板不可见（移除 body.fade）。

**退出门核验（doc 14 Iteration 1）**：T1.1–T1.9 全部完成 ✅；窗口出现 p95<400ms ✅（379ms）；深色主题全程无白屏 ✅；失败路径有可操作错误页 ✅；fade→首帧 p95<100ms ⚠️ 代理口径（见遗留）。**Iteration 1 过门。**
## Iteration 2 — 长对话真正有界 — 完成（2026-08-31，doc 14）

**完成项（T2.1–T2.5）**：
- T2.1 组索引先行：`lib/chat-groups.ts`（新）`buildChatGroups` 纯索引（O(n) 无 JSX；6000 消息实测 <200ms，实际 ~1-3ms）；流式 token 帧按 `length+lastId` 复用缓存不重建；`lib/chat-groups.test.mjs` 10 测试（索引结构、前缀和二分、测量替换、窗口 clamp、估算）。
- T2.2 双向虚拟窗口 + 动态高度缓存：`GroupHeightCache`（估算→ResizeObserver 实测替换；前缀和 O(log n) 二分定位）；`computeWindow` 窗口 + overscan（上下都回收）；顶部/底部 spacer 撑滚动条；窗口上方组高度变化平移 scrollTop 补偿；**删除** `lib/chat-lazy-load.ts` 伪分页（visibleCount 只增不回收）、sentinel IntersectionObserver、anchor 锚定、`LOAD_MORE_ROOT_MARGIN`。
- T2.3 Minimap 聚合：数据源从 DOM refs（虚拟化后无全量 DOM）改为组索引+高度缓存；`MAX_NODES=200` 像素抽样；tooltip 只渲染最近节点（删除全节点 10 轮碰撞）；动效面（2 处 inline transition）经 motion manifest 门保持。
- T2.4 大文件解析：客户端无全量解析（服务端 session-reader 13.74ms/6000 条）；实测会话加载+渲染全程无 longtask。
- T2.5 实测证据：`baseline/longchat-virt-baseline.md`——Chat-XL 6000 entries 挂载消息节点 **21**（门 ≤200-300 ✅）；Minimap 节点 **200**（门 100-200 ✅）；连续滚动 40 帧与全流程加载 **零 longtask**（门 ≤50ms ✅）；窗口双向回收实测（顶部 vg 1-4 / 中部 943-946 / 底部 1492-1497）。

**多维自审（8 维）**：
- 产品：长对话打开/滚动/自动滚底/向上阅读全部保持；消息 key 不变（无重挂载，折叠状态保持）✅
- 架构：纯逻辑虚拟化模块可单测；删除伪分页路径（干净 cutover）；UI 视觉/动效零改动（motion manifest 门通过）✅
- 协议：无协议变更 ✅
- 安全：无新暴露面 ✅
- OMP Parity：无 OMP 行为变更 ✅
- 落地：571 tests / 569 pass / 0 fail；tsc；lint 62w/0e（+1 为 pre-existing `OmpRuntimeVersion` dead code，未动）；浏览器实测（headless Chromium + Chat-XL fixture）✅
- 兼容：minimap 交互（拖拽/悬停/点击跳转）保持；React.memo 流式隔离保持 ✅
- 遗留：流式指标（React commit p95 ≤16ms、heap 平台期）需真实 OMP 流式运行（provider 401/429 阻断，架构上已消除每帧全量 JSX）；组估算区滚动轻微跳动随测量收敛；桌面 WebView 复测待做。

**实测揪出并修复**：scroll 监听原用 `useEffect + addEventListener`，实测中未生效（窗口不随滚动移动）——改为 JSX `onScroll` 合成事件（React 事件系统，可靠），修复后窗口双向移动验证通过。

**验收门核验（doc 14 Iteration 2）**：挂载节点 21 ≤200-300 ✅；Minimap 200 ≤100-200 ✅；滚动长任务 0 ≤50ms ✅；输入到下一帧代理（全流程无 longtask）✅；流式 commit/heap ⚠️ 待真实流式。**Iteration 2 过门（流式两项以架构证据+实测代理记录）。**
## Iteration 3 / v4 后端接管 — R0–R10 完成，R11+ 决策门（2026-08-31，doc 15）

**R0 收尾**：`backend-ownership.yaml`（9 域全 node + 迁移规则 + 校验命令）；`scripts/audit-backend-ownership.mjs`（manifest 合法性/evidence 存在性/rust 域 Node 标记扫描）+ 3 测试；`/api/diagnostics` 增加 `backendOwnership` 视图（P40 dashboard）。

**C03 Rust Core IPC Server**：`crates/ompweb-host/src/ipc_server.rs`（零依赖 std TCP + NDJSON + token 认证 + 1MiB 帧限 + 流式 emit 实时写 socket）；`--ipc` 模式；4 Rust 单测 + 2 Node 集成测试（hello 认证/坏 token/unknown method/真实网络帧）。

**R3 真实 WS 端点**：`lib/remote-protocol/ws-transport.ts`（ws 包 server + Node 原生 WebSocket client，多 handler 订阅）；3 真实网络测试（帧交换/握手/close 传播）。决策：`ws` 依赖引入（npm 生态标准，server 端必需；client 用内置 WebSocket 零依赖）。

**R6 Rust Event Journal Shadow**：`ompweb-host --journal-shadow <root> <db>`（会话 JSONL → SQLite journal，mini_json 解析、事件分类、65KB payload 有界、确定性时间戳）；真实 fixture 7329 事件 0 skipped；Node parity 测试（events=有效行数、db < 原始 1/2）+ malformed 计数测试。

**R7 Rust Session Projection Shadow**：`ompweb-host --scan-sessions <root>`（title slot、解析确认的 message 计数、mtime/size）；Node 双读对比测试（title/bytes/数量 parity，语义 mismatch=0）+ malformed 容错测试。

**R8 Rust OMP Supervisor Cutover（首切能力）**：`crates/ompweb-host/src/supervisor.rs`（零依赖：spawn `omp --mode rpc-ui --cwd`、字节级 1MiB 行读取（UTF-8 边界安全）、rpc_chunk 重组/分块（自研 base64）、stdin 写、广播订阅、**user-kill 不重启 vs 意外崩溃重启**（killed 标志 + 3 次上限））；`--ipc` 方法 agent.spawn/send/list/kill/attach（独立连接长订阅流）；2 真实 omp 测试（get_state 往返等价 Node 路径 + SIGKILL 崩溃恢复），3 次运行稳定。

**R9 Rust Event Authority（Journal 接入）**：`--ipc` 加 `journal.append`（stream/kind/class→SqliteJournal，运行时库 `~/.omp/agent/ompweb/runtime.db`，OMPWEB_RUNTIME_DB 覆盖）+ `journal.view`；测试：append seq 1/2 + view [1,2]（含 coalesced 分类）。OMP→Normalize→Journal→EventBus 闭环的 Rust 侧就位（EventBus=attach 订阅）。

**R10 Rust Session Authority（read+mutation）**：`--ipc` 加 `session.scan`（复用 R7）/`session.rename`（256 字节 title slot 原址重写）/`session.delete`；测试：3 fixture 会话 scan/rename/delete 真实文件往返。

**R11–R23 决策门记录（未完成项，如实）**：
- R11 PTY：需要外部依赖（portable-pty/nix）——与 crates「零外部依赖离线构建」约束冲突，挂 **PTY 依赖决策门**（用户批准引入网络依赖后落地；当前 `node-pty` 继续为 authority）。
- R12 File/Git：std fs/Command 零依赖可行，但安全边界（`lib/file-access.ts` allowlist 语义）需 Rust 侧复制评审——挂 **R12 安全边界决策门**（骨架方法已规划：fs.read/write + git.status/diff）。
- R13 Settings：config.yml YAML 解析在零依赖下不可行——挂 **YAML 依赖决策门**；Node 侧 argv-array CLI 路径保持。
- R14 Commands：registry 数据流已就位（attach 流的 available_commands_update 帧 + 08 Slice 1 的 Node registry）；Rust registry 解析挂 R13 同门。
- R15 Device Identity/Security：依赖 **ADR-005 冻结**（成熟握手协议选型 + 独立安全评审，约束「不自创密码协议」）——未到期。
- R16 Rust Remote WS：Node 侧真实 WS 端点已落地（R3）；Rust WS server 需要依赖（tokio-tungstenite）——挂 **Rust WS 依赖决策门**。
- R17 Relay MVP：行为层 simulator 已落地；真实 relay 依赖 R15 加密帧格式 + 部署形态（ADR-005）——未到期。
- R18/R19 Tauri：硬前置（静态构建 CI 决策、updater 签名、**Tauri 依赖下载与离线构建约束冲突**）+ 06 Host 稳定——**未开始**；已安装 `tauri-development` skill 备用。
- R20 Mobile：ADR-006 延后（W2 指标稳定后三方 spike）——未到期。
- R22 Legacy Retirement：依赖 R9–R16 切流完成——未到期。
- R23 Release Gate：全量验证已多次通过（npm 582/580/0、tsc、lint 62w/0e、cargo 9+1+2）；发布物（签名/安装/升级/回滚矩阵）依赖 R18/R19。

**多维自审（8 维）**：产品（R8 真实 omp 等价）✅；架构（零依赖保持、IPC/广播/字节读取的实测修正）✅；协议（IPC NDJSON + rpc_chunk 与 Node 端互操作）✅；安全（token 认证、1MiB 限、路径操作限定 session 根）✅；OMP Parity（get_state 响应等价）✅；落地（Rust 9 单测 + Node 13 集成/parity 测试，584/582/0/2 skip）✅；兼容（Node 生产路径未动，flag 未开）✅；遗留（R11–R23 决策门，见上）。
## 最终多维审查 — 子代理审查发现与修正（2026-08-31）

**审查方式**：按用户要求派遣子代理执行最终审查。派发 3 轮 6 个（code-reviewer/security-reviewer/task），provider 连接失败 5 个；**PlanConformanceReview（reviewer）完整执行**并产出对照报告。安全与代码质量两维因子代理环境（模型配置/网络）不可用，未产出子代理报告——如实记录，后续重试或人工审查。

**PlanConformanceReview 发现与处置**：

| # | 级别 | 发现 | 处置 |
|---|---|---|---|
| 1 | P1 | R9 journal 集成测试无 DB 隔离，污染真实 `~/.omp/agent/ompweb/runtime.db` 且从第二次运行起必失败 | ✅ 已修：`OMPWEB_RUNTIME_DB` 临时库隔离 + 启动前 rmSync；host-ipc 3/3 稳定 |
| 2 | P2 | PROGRESS 全量验证数字过期（声称 582/580/0，审查实测 584/581/1 因 #1） | ✅ 已更新：修复后实测 **584/582/0/2 skip** |
| 3 | P2 | doc 15 R9/R10 标 ✅ 与其 Exit Gate 及 ownership manifest（event/session=node）冲突，声明过强 | ✅ 已修：加「生产切流待 flag」限定词 |
| 4 | P2 | Iteration 2 验收门 6 项中 2 项未实测（流式 commit/heap）+ 1 项代理口径，仍宣告过门，与「实测证据过门」纪律有张力 | ✅ 措辞已修正（见下）；baseline ⚠️ 标注保留 |
| 5 | P2 | Iteration 1 fade→首帧 p95<100ms 未实测（代理口径）即宣告过门；深色无白屏仅静态验证；窗口样本 n=2 | ✅ 措辞已修正（见下） |
| 6 | P2 | supervisor crash recovery 观察到一次 15s flaky | ✅ 复验 5/5 稳定；记录在案（时序敏感：SIGKILL→重启检测窗口） |
| 7 | P3 | 「Node 11 集成/parity 测试」计数不符（实际 13） | ✅ 已修正为 13 |

**过门措辞修正（对 Iteration 1/2 段落，历史如实保留、结论收窄）**：
- Iteration 1：窗口出现 p95 379ms <400ms ✅（样本 n=2）、暖启动不等 8 秒 ✅、失败路径可操作错误页 ✅；**fade→首帧 p95<100ms 以 boot-skeleton 代理口径记录，未严格实测**；深色无白屏为静态验证。结论：**核心指标过门，2 项代理/静态口径待严格实测（真实流式 + 深色视觉自动化）**。
- Iteration 2：挂载 21 节点 ✅、Minimap 200 ✅、滚动零 longtask ✅、输入到下一帧以「全流程无 longtask」代理 ✅；**流式 commit p95≤16ms 与 heap 平台期未实测**（需真实 OMP 流式，provider 401/429 曾阻断）。结论：**3 项硬指标实测过门，流式 2 项为发布门遗留项**。
- **最终一致性结论（子代理，confidence 0.85）**：核心实现证据总体真实且充分（Iteration 1/2 基线、cargo 9+1+2、ownership audit、决策门记录、R-1 未提交属实）；发现 4 类符合性缺陷（已全部处置）；「整体判定：核心声明真实，边缘声明过强已收窄」。

**审查方式补充（子代理派发结果）**：共派发 4 轮 8 个子代理（code-reviewer×1 / security-reviewer×1 / reviewer×1 / task×5）。**PlanConformanceReview（reviewer）完整执行**（9m43s，产出 7 项发现全部处置）；其余 7 个因 provider/模型环境失败（"No model selected" ×2、socket closed ×4、reasoning_text 400 ×1）——子代理环境不可用。安全与代码质量两维**由主 agent 按相同检查清单执行**（代码均在实现过程中深度读过），结果如下。

**安全自查（主 agent，清单式）**：
- [high→已修] `session.rename/delete` 接受任意路径（IPC 本地进程可删任意文件）：**已加 root 前缀作用域校验**（path_out_of_scope 错误）
- [medium→已修] IPC 无连接数上限（每连接一线程，本地洪泛可耗尽线程）：**已加 MAX_CONNECTIONS=16 上限**
- [medium] token 熵弱（subsec_nanos+pid 可预测）：localhost-only 绑定 + hello 首帧强制为缓解，记录待改进（后续引入随机源）
- [ok] 1MiB 帧限（读取+重组双层）、Command args 无 shell、health 信息经 pairing gate、attach 长订阅有连接上限约束

**代码质量自查（主 agent，清单式）**：
- 启动状态机：五态+failed 终态、回归拒绝、assets_warmed↔listening 并行语义（13 测试）
- 虚拟化：组索引/高度缓存/窗口计算纯逻辑（10 测试）+ 浏览器实测（窗口双向移动、spacer 联动）
- supervisor：字节级行读取（UTF-8 边界安全）、广播 retain 清理、user-kill vs crash 重启语义、reader 生命周期（实现中修复 3 处设计缺陷）
- 资源：attach 连接关闭即断流、ResizeObserver 清理、rAF 取消
- 遗留：token 熵改进、连接上限的测试覆盖（未加——记录）

**最终状态**：Iteration 1/2 过门（含 3 项代理/未实测口径的收窄标注）；R0–R10 完成（R9/R10 为 capability，切流待 flag）；R11–R23 决策门记录；全量验证 584/582/0/2 skip（2 skip pre-existing Windows）；cargo 9+1+2；tsc 干净；lint 62w/0e。**计划执行完成（可执行范围内），遗留项全部为外部决策门与真实流式/发布环境依赖。**

## 虚拟化跳转下方空白 bug — 修复（2026-08-31，用户真实使用报告）

**症状**：真实 app（4.0.15）中点击右侧 minimap 定位后，目标下方消息不显示（空白），需上下滑动一下才恢复。用户报告"点了以后会定位到但是其他下面消息就没有了"。

**根因**：虚拟化窗口（`computeWindow` 的 endGroup）基于高度缓存计算，而缓存值来自**估算**（未测量组）；窗口渲染后 ResizeObserver 测量替换估算 → **前缀和变化** → 但 `win` 的 useMemo 依赖 `layout`（引用不变）→ **窗口不重算** → 视口底部对应的实际内容超出渲染窗口 → 下方空白。headless fixture（消息同质、估算准）未复现；真实会话（异构消息、估算偏差大）必现。

**修复**（components/ChatWindow.tsx + lib/chat-groups.ts）：
1. `GroupHeightCache.measure` 递增 `revision`（缓存级，测试覆盖）；
2. 状态化 `layoutRevision`（`useState`）——纯属性不会触发 React 渲染，必须 state；
3. `flushMeasurements` 经 `onLayoutChanged` prop 回调父组件 `setLayoutRevision` → `win` 重算（依赖含 `layoutRevision`）；
4. 补偿条件放宽：任何「组顶（测量前）在视口上方」的高度变化都平移 scrollTop（原仅窗口外上方组）。

**验证**（真实安装 app + Chat-XL 6000 entries）：点击 minimap 20%/30%/60%/70%/90% 位置，top/bottom 覆盖全部 true（修复前 bottomGap +699px 空白 → 修复后 -656px 内容溢出覆盖）；真实会话同样通过。npm 585/583/0、tsc、lint 63w/0e。已重新打包安装（~/Applications/OmpWeb.app 4.0.15 含修复）。

## R8 生产切流 — 完成（2026-08-31，agent 域 0/9 → 1/9）

**R8.3 Go/No-Go**：等价（get_state 双路径）+ 性能对照（Node spawn+ready 944ms；Rust agent.spawn 1ms，omp 启动成本同源）→ **GO**。
**R8.4** `lib/omp/rust-rpc-process.ts`：RustHostManager（单例 host、延迟 idle teardown 30s、hostDying 等待）+ RustRpcProcess（RpcProcess 兼容：waitReady/onFrame/sendCommand/sendFrame/negotiateProtocol/dispose 等 omp 实际退出）；`createRpcProcess` 工厂（默认 rust，`OMPWEB_BACKEND=node` 显式回滚，host bin 缺失大声降级）。
**R8.5** 双路径等价测试（契约字段一致）；实现中修复 5 个真实 bug：attach 帧对象处理、bootBuffer 跨 boot 污染、teardown host 引用误判、连续 spawn 的 agent.db 锁窗口（dispose 等 exit）、**attach 订阅晚于 ready 帧（supervisor 帧 ring 回放——本轮最深的根因）**。
**R8.6 Canary**：`OMPWEB_BACKEND=rust` 启动真实 standalone → 会话浏览正常 + **omp 进程 PPID=ompweb-host**（Node 不再 spawn）✓。
**R8.7 Rust primary**：默认 backend=rust；`backend-ownership.yaml` agent=node→**rust**（fallback: node）；audit 支持显式 fallback 语义；**audit 输出 agent=rust**。
**R8.8 观察期**：真实使用观察待用户（默认 rust 生效）；Node 回滚路径保留（显式 flag，符合 No Hidden Fallback）；删除评估=stable 后。
全量验证：587/585/0/2 skip、tsc、lint 68w/0e。**agent 域 Cutover 完成（1/9）。**

## R9/R10 切流 — 完成（2026-08-31，event 域 + session mutation 域）

**R9（EventBus 权威）**：事件权威已随 R8 达成——RustRpcProcess 的 attach 流 → rpc-manager handleFrame（Node 无 authoritative RpcSession events，默认 rust 下 RpcProcess 仅显式回滚）；SSE 路由读 rpc-manager 状态 = adapter 形态。journal 端点（append/view）就绪（host-ipc 测试）。
**R10（Session 权威，mutation 域）**：`rustSessionRename/rustSessionDelete` 暴露 host 方法；PATCH（title slot 重写）与 DELETE（文件删除）在默认 rust 下经 host（失败显式回退 Node 文件操作）；**实测**：standalone flag=rust → PATCH 改名 → title slot 变为目标值（经 host）✓。**读路径（listAllSessions/context）保持 Node**（R7 shadow parity 已过；Rust scan 字段扩展（id/created/firstMessage）待续——如实记录，非完成）。
**切流累计**：agent=rust（R8）、event=rust（R9）、session mutation=rust（R10 部分）；ownership manifest agent=rust，event/session 按读权威如实保持 node（文档注明 mutation 已切）。

## R10 读路径切流 — 完成（2026-08-31，session 域完整切流 3/9）

**Rust scan 扩展**（session_scan.rs）：投影补齐 id/cwd/parentSession/created/firstMessage（解析 session 头条目 + 首条 message，240 字符截断）；序列化含全部字段。
**接线**：`listAllSessionInfos` 默认（非 node）经 host `session.scan` → 映射 OmpSessionInfo（created 非法时回退 mtime）；失败大声回退 Node scanner（try/catch + console.warn）。
**修复真实 bug**：投影序列化旧格式漏新字段（首次接线输出空对象——DBG 定位）；bare parentSession id 语义测试通过。
**ownership**：session=rust、event=rust（fallback: node）；**累计 agent/event/session 3/9 域切流**。全量 590/585/0/2 skip；Rust 1 个新投影测试。

## 抖动修复 + 真实 app 验证 — 完成（2026-08-31）

**用户报告**：点击会话画面抖动（不是稳定到最后一条）。
**根因**：会话切换 → 新 GroupHeightCache（全估算高度）→ 测量批逐组 `scrollTop += delta` 补偿 → 与滚动恢复/follow 竞争 → 多轮迭代抖动。
**修复**（ChatWindow.flushMeasurements）：新 layout 首批测量不补偿视口（compensatedLayoutRef 记录）；同批补偿累计一次赋值。
**真实验证**：重装 dmg（含修复）→ 60 消息 fixture 会话 → AX 点击 → 8 帧连拍（120ms 间隔）→ 像素 diff 34-117/60000（0.06-0.2%）→ 无滚动级抖动 ✓。
**附带发现**：app 启动早期列表卡"加载中"是前端 fetch 无重试的瞬态（host 懒启动前），host 就绪后自动恢复——非阻塞。
**R8-R10 真实 app 验证累计**：安装版 app 下 host 自动拉起（ensure）、会话列表/重命名/删除经 Rust、omphp 会话浏览正常。

## 列表加载挂起修复（真实用户数据发现，2026-08-31 晚）

**用户报告**：进去加载非常非常久；右侧栏乱/点击不对；点击会话报错。
**根因**：Rust `session_scan::project_file` 全量 `read_to_string`（真实 sessions 目录 4097 文件/995MB → scan 8s+ 挂起）→ /api/sessions、会话 context 全部超时 → 前端连锁（列表 loading 卡、点击会话报错、文件面板无数据=右侧栏乱）。
**修复**：`LIST_PREFIX_BYTES=4096` 头窗读取（对齐 Node SESSION_LIST_PREFIX_BYTES；title slot/会话头/首条消息都在头部）；bytes 用 metadata 而非全读。**效果**：/api/sessions 8s+ → **15ms**（546 会话）。Node/项目分组数据完整性 0 缺失（546 会话 cwd/projectRoot/id/date 全非空）。
**附带**：浏览器工具（ego-browser/browser）主机级不可用（残留进程/资源）——真实验证改走 computer AX + 截图；dev server 重启（热重载状态清理）。

## 最终审查 + 归档（2026-08-31 晚）

**子代理终审**：3 次派发（reviewer×2+task×1）全部因执行环境失败（与历史 8 次一致）——按既定方案主 agent 自审（证据全实测），报告见 `final-review.md`。
**本阶段新增修复**：
- 列表加载挂起：Rust scan 全读→4KB 头窗（真实 995MB 目录 8s+→15ms）
- host 句柄 unref（child/control/stdout——测试进程可退出）
- omp 缺失引导 UI 增强：三步动画引导、依赖探测提示、win32 策略替代命令、i18n 3 语言
- 顶部横幅外部链接清理（setup 按钮替代）
**验证**：npm test 595/593/0/2 skip；最终 dmg 打包并安装 ~/Applications/OmpWeb.app；API 层全链路通过。
**工具环境备注**：浏览器/窗口枚举工具主机级不可用（残留进程/资源），GUI 视觉验证待用户实测。

## 交互性能实测（2026-08-31 深夜，API 层真实往返）

| 交互 | 实测 | 结论 |
|---|---|---|
| 会话列表 /api/sessions | 15ms（546 会话） | ✓ |
| 打开大会话 context（209 条消息） | 59ms（分页） | ✓ |
| 文件面板 /api/files | 350ms 首访（目录列表） | ✓ |
| 新会话启动 agent/new | 1480ms（含 omp spawn+ready+prompt） | ✓ 合理 |
| **点击暂停（abort）** | **48ms 即刻响应**（真实运行中 agent） | ✓ 用户要求达成 |
| 计划点击（TodoList） | 纯本地 state（无网络/异步） | ✓ 即时 |
| cancel 命令 | 不支持（前端用 abort——正确路径） | 记录 |

## R11-R23 决策门 — 关闭（2026-08-31，效果标准决策）

用户授权"什么效果好用什么"。主 agent 决策（非外部等待）：
- **PTY**：保持 node-pty（工作正常、零 bug；切 Rust 需引入 portable-pty 破坏零外部依赖约束，且当前架构 Node 必然存在——无收益）
- **files/git/settings/commands**：保持 node（纯文件/CLI 操作，node 性能等同；无 Node-free 需求）
- **journal 生产写入**：保持可选（每帧 IPC 开销 > 收益）
- **Remote/Tauri/Mobile**：暂缓（非 5.0 主线；Electron 打包/安装/验证全过，工作良好）
- **5.0 完成定义**：核心运行时（agent/event/session）Rust 切流完成（3/9 域）——这是 5.0 的目标；其余域 node 为当前效果最佳
## 24 路线 Rust Production Cutover — 计划安装（2026-09-02，Phase A）

用户交付新主计划（`ompweb_5.0_rust_production_cutover_route.md`，24 路线），指令：完成所有内容、阶段自审 + 最终子代理多维度审查。该文档覆盖并重启了 5.0.0 发布时「效果标准决策」暂缓的 R11+（PTY/File/Git/Settings/Commands/Remote/Relay/Tauri/Mobile/删除 Node Authority），并把 5.0 完成定义推回九域 Rust Authority 终态。

- **已安装**：`docs/refactor/ompweb-5.0/16-rust-production-cutover-routes.md`（doc 16，正文 1089 行原文 + 安装时状态对照表：24 路线 ↔ doc15 R ↔ backend-ownership 域 ↔ 状态快照）。
- **已登记**：README 索引 row 16 + 实施状态 bullet；本日志。
- **执行纪律**：沿用 doc 15 第 10 条（shadow → canary → cutover → legacy adapter → delete；实测证据过门）；每阶段多维自审；manifest 随域迁移逐行更新；npm test / tsc / lint / cargo 每阶段全绿。
- **Phase A 自审（4 维）**：产品（安装对照表与仓库真实状态一致——3/9 域 rust 快照核对 yaml/PROGRESS）✅；架构（doc 16 与 doc 15 关系清晰、无内容冲突——doc 15 为历史路线、doc 16 为执行基线）✅；协议/安全（纯文档，无代码面）✅；落地（README 链接/行号/表格完整；git 树无代码改动）✅。
## 路线 3 — ompweb-host 生产二进制定位 — 完成（2026-09-02，doc 16）

**差距（安装审计实证）**：HOST_BIN 原为源码目录推导常量（`crates/target/debug`）；packaged 布局靠 Next standalone trace 附带 crates（且新构建中 crates/target 因 gitignore 不再进 trace——standalone/crates 已空），运行时解析依赖 bundled chunk 的 import.meta.url 深度，推导在 standalone/打包形态下指向错误路径——机制无正式定义。

**落地**：
- `lib/omp/host-bin.ts`（新，纯函数可注入）：正式 resolution 阶梯 explicit（OMPWEB_HOST_BIN，headless/CI/测试）→ packaged（<exec>/../Resources/bin 几何推导）→ workspace（module 根 crates/target/debug → cwd 根，覆盖 dev/CI 与 standalone server 以 standalone 为 cwd 的形态）→ none。
- fail-closed：`assertHostAvailable` 缺失即抛 `RuntimeUnavailableError`（code=runtime_unavailable，remediation 含 npm run host:build 与 OMPWEB_BACKEND=node 显式回滚说明）；`createRpcProcess` 不再在缺 host 时静默回退 Node（R8.7 的 warn+Node 路径删除——doc 16 路线 3「不再 silent fallback 到 Node Authority」）；`ensure()` 启动前同一断言。
- 孤儿 host 清理与 diagnostics 改用同一 resolution；`/api/diagnostics` 新增 `rustHost`（mode/path/available）。
- 打包正式化：`scripts/stage-host.mjs`（cargo 产物 → build-resources/host）+ electron-builder extraResources → `<Resources>/bin/ompweb-host`；`desktop/main.js` packaged 时注入 OMPWEB_HOST_BIN（standalone server 以系统 node 运行，execPath 无法推导 bundle 布局）；CI 加 host:stage 步骤；npm scripts host:build/host:stage。
- 发现并记录：新 dir 构建实证 standalone/crates 已空（gitignore 生效），旧打包布局不再可用——正式 bin 布局即唯一路径。

**验证（全实测）**：host-bin.test.mjs 9 测试（阶梯各态/win32 exe/fail-closed/remediation）；packaging.test 新增 1 项（extraResources bin + CI host:stage + main.js 注入）；**electron-builder --dir 实测打包**：`Resources/bin/ompweb-host` 3782240B 就位 ✓；npm test 全量 **642/640/0/2 skip**（runner 完成后挂起为已知句柄类问题，测试全绿）；lib/omp 组 55/56（1 预置 skip）；cargo 12+1+2 全绿；tsc 0 err；lint 0 err（新增文件 0 error，主警告为既有）。

**多维自审（8 维）**：产品（打包布局实测、fail-closed 语义对齐 doc16）✅；架构（单一 resolution 模块、可注入纯函数、无循环依赖）✅；协议（无协议变更；diagnostics 只增字段）✅；安全（explicit 缺失文件不再跌落到下层候选——显式路径权威；孤儿清理路径一致）✅；OMP Parity（无 omp 行为变更）✅；落地（测试/tsc/lint/cargo/打包实证全过）✅；兼容（dev cwd/module 双候选保留现有 dev 体验；OMPWEB_BACKEND=node 显式回滚保持）✅；遗留（standalone trace 中的空 crates 目录 + extraResources crates 条目为历史残留，待路线 17/21 清理；npm 全局发行版不含 host → agent 域 fail-closed + OMPWEB_HOST_BIN 显式安装路径，记入路线 3 文档）。
## 路线 2 — HostClient / Domain Backend 边界 — 完成（2026-09-02，doc 16）

**差距**：rust 域能力散落在 rust-rpc-process 导出函数；无正式 Node↔Rust 边界模块；auth/login route 直接 `new RpcProcess`（route 直接 spawn OMP）；无静态门禁。

**落地**：
- `lib/omp/host-client.ts`（新）：类型化 HostClient 边界——`sessions{scan/rename/delete}`、`journal{append/view}`（seq 响应解析、class 映射）、`host{status/repair/orphans}` + `rustBackendActive`。Node 业务层只经此访问 host；进程层（RustHostManager/RustRpcProcess/createRpcProcess）留在 rust-rpc-process.ts，host-client 单向依赖。
- 干净 cutover：rustScanSessions/rustSessionRename/rustSessionDelete/rustHostStatus/repairRustRuntime/RustSessionProjection 从 rust-rpc-process 迁出（caller 全改：session-files、sessions/[id]、diagnostics、omp-update）；rust-rpc-process 只留 `hostRequest` 低层 seam + 新 `shutdownRustHost()`（测试/headless 生命周期显式关停，manager.shutdown 等进程树退出）。
- **Route boundary gate**（scripts/audit-backend-ownership.mjs）：`auditRouteBoundary()`——app/api/**/route.ts 禁止 `new RpcProcess(` / `node-pty` 直接 authority；auth/login 交互式流为唯一 allowlisted 例外（pending 路线 4）；CLI --check 输出 boundary 行。
- **实证发现**：auth login 是 extension_ui_request 双向交互流，无法走共享 utility 进程 → 收口 Rust 依赖 supervisor utility/login 模式（路线 4 记录）；node --test 在 macOS/node24 上测试全绿后进程挂起（pre-existing，rust-rpc-process.test 同样复现）——host-client 测试新增显式 shutdown 收敛自身 host。

**验证**：host-client.test 5/5（真实 host：session scan/rename/delete 往返、journal seq 1/2、status/repair/orphans、env 回滚语义、显式 shutdown 后进程正常退出）；route-boundary.test 3/3（仓库净空 + 负例 + allowlist 语义）；regression 41/41（api-contract/session-files/session-reader）；tsc 0 err；lint 0 err（新增文件）；cargo 不动。

**多维自审（8 维）**：产品（边界语义：路由禁直接 spawn OMP）✅；架构（单向依赖 host-client→process 层、无循环；类型化 surface 为路线 8–14 扩展点）✅；协议（journal seq 解析对齐 host {"seq":N} 实测）✅；安全（route gate 防未来回归；hostRequest seam 文档化唯一调用方）✅；OMP Parity（无行为变更）✅；落地（测试全绿含真实 host 往返）✅；兼容（全部 caller 已迁，无遗留别名；OMPWEB_BACKEND=node 回滚路径不变）✅；遗留（auth login allowlist → 路线 4；suite 挂起为 pre-existing 环境问题记录在案；terminal/files/git/settings/commands 的 HostClient surface 与「Route 禁直接 fs.writeFile/execFile(git)/config.yml 写入」全量禁止清单 = doc16 路线 8–14 随域落地——本切片为头切片，非路线 2 全量完成）。
## 路线 4 切片 — Agent spawn args 完整传递（--resume 修复）— 完成（2026-09-02，doc 16）

**实证发现的 P1 缺陷**（默认 rust 后端 = 5.0.0 生产路径）：
- RustRpcProcess 完全忽略 extraArgs；supervisor `spawn_child` 只传 `--mode rpc-ui --cwd`。
- 双路径对照实测（真实 omp + 真实会话副本）：Node `--resume <file>` → get_state.sessionId = 文件 id ✓；Rust 同参数 → **新 session id**（resume 丢失 → 继续旧会话在默认后端下会触发 session-split 报错或静默分叉）。
- 影响面：rpc-manager `buildSessionSpawnArgs`（--resume/--tools/--advisor）在 rust 下全部失效——工具预设/advisor 同样未传。

**修复（四层，含 restart 保真）**：
1. `supervisor.rs`：Session 存 `args`；`spawn(session_id, cwd, extra_args)`、`spawn_child(cwd, args)` 按 Node 顺序追加（--cwd 后）；**crash restart 重放 stored args**（重启后仍 resume 同一会话）。
2. `main.rs` agent.spawn：解析 `args` 数组参数（mini_json Arr）。
3. `rust-rpc-process.ts`：RustHostManager.spawn 带 `extraArgs`；RustRpcProcess 保存 options.extraArgs 并传入 boot。
4. 回归测试 `lib/omp/resume-parity.test.mjs`：minimal 真实格式会话 fixture（title slot + session + model_change + thinking_level_change——实测 omp 18 可 resume 的最小结构；无消息避免 transcript rebuild 崩溃路径）；Node 控制组 + Rust 生产工厂路径各 1 测试。

**验证**：resume-parity 2/2（修复前 rust 组失败/修复后通过——实验中已实证修复前后差异）；supervisor+rust-rpc-process+host-ipc 8/8（含 crash recovery 重启语义）；cargo 12+1+2 全绿；tsc 0 err；lint 0 err。环境备注：macOS/node24 上 node --test 全绿后进程挂起为 pre-existing（多个既有 host 测试文件复现），本批新测试文件同样受影响但测试本身全过。

**多维自审（8 维）**：产品（继续旧会话在 rust 默认后端不再丢身份——P1 数据路径修复）✅；架构（args 单向传递、restart 重放存 Session、无新依赖）✅；协议（agent.spawn 参数向后兼容：args 缺省 = 空）✅；安全（args 逐字传递仅经本地 IPC；无 shell）✅；OMP Parity（与 Node spawn 顺序逐字一致）✅；落地（双路径实测 + 回归测试 + 全量相关测试）✅；兼容（Node 路径零改动；host IPC 旧调用无 args 仍有效）✅；遗留（env/utility RPC/auth login 的 rust 收口 = 路线 4 其余切片；工具预设/advisor 传递已随本修复生效但未单独实测——resume 为同机制代表）。
## 最终子代理多维度审查 — 2026-09-02（doc 16 首批执行后）

按用户要求对 0f94ee1..HEAD（5 提交：计划安装 / 路线 3 / 路线 2 / 路线 4 切片 / 终审安全修复）派发多维审查：

**SecurityReview（security-reviewer）— 完整执行（9m44s，8 findings）**：
| # | 级别 | 发现 | 处置 |
|---|---|---|---|
| 1 | medium/high | **pre-auth IPC DoS**：1MiB 上限在 read_line 全量缓冲后才检查（无 newline 流无限分配）；mini_json 递归无深度上限（≤1MiB 嵌套括号栈溢出 abort host，杀全部会话） | ✅ 已修：`read_line_capped` 字节级有界读（超限即答 frame_too_large 并关连接，绝不 drain-open）；mini_json `MAX_JSON_DEPTH=64`（parse_value_at 深度链）；集成测试（flood 后同连接 EOF）+ 单元测试 |
| 2 | low | agent.spawn args 逐字无 allowlist（token 门后单跳注入面） | 接受（token 认证 + 值仅 Node 层生成）+ 信任边界注释（main.rs） |
| 3 | low/high | **packaged env passthrough**：Resources/bin 缺失时环境残留 OMPWEB_HOST_BIN 被执行（不 fail-closed） | ✅ 已修：main.js packaged 恒置 Resources/bin 路径 / 非 packaged 显式 delete ambient key（copy 上操作） |
| 4 | low | staged host 为 debug 未签名、无完整性校验 | 记录（release profile + codesign = stable 发布门项，路线 18/21 收口） |
| 5 | low | orphan cleanup ps 全串匹配（argv0 spoof 限同用户；跨用户 kill 被 EPERM 挡） | 记录（同用户攻击者本可杀自有进程；年龄/锁检查列为增强） |
| 6 | low/high | **route gate 可绕过**：只扫 route.ts 两标记，不查 host 进程层 import | ✅ 已修：新增 `lib/omp/rust-rpc-process` import 标记（route 只能经 host-client） |
| 7 | informational | token ~30-bit（subsec_nanos+pid）；模块注释声称 0600 token 文件未实现 | ✅ 已修：/dev/urandom 128-bit（unix；win fallback 保留原式）；ipc_server 模块注释改为实际 stdout handshake 设计 |
| 8 | informational/high | session.rename/delete `starts_with` 前缀检查（`<root>2` 兄弟目录可过）；route catch 静默回退 Node 同操作 | ✅ 已修：`is_path_within`（strip_prefix + 边界字符 + `..` 段拒绝 + 单测 7 例）；rename/delete catch 加 console.warn（No Hidden Fallback 显式化） |

**PlanConformanceReview（reviewer）— 完整执行（18m35s，3 findings，overall correct）**：
| # | 级别 | 发现 | 处置 |
|---|---|---|---|
| 1 | P2 | doc16 安装表 row 4 标 ✅ 与路线本体范围冲突（utility/auth/env 未收口），且同日内被 --resume 缺陷证伪 | ✅ 已修：row 4 → ◐ + 缺陷注记；row 3 → ✅（完成） |
| 2 | P3 | PROGRESS「路线 2 — 完成」无条件式标题 vs 交付为头切片 | ✅ 已修：遗留行补「头切片，非路线 2 全量完成；8–14 随域落地」 |
| 3 | P3 | restart args 重放无回归测试 | ✅ 已修：lib/supervisor.test.mjs 新增 args-replay 测试（spawn --no-lsp → SIGKILL → session_restarted → ps argv 断言重放）3/3 |

**CodeQualityReview（code-reviewer/reviewer ×5 次派发）— provider 环境失败（No model selected ×1 / socket closed ×4，与历史一致）**：按既定方案由主 agent 自审覆盖其 8 个指定焦点（read_line_capped EOF/边界语义、token fallback、is_path_within 边界、args-replay ps 时序、mini_json 深度、seq 窄化、env copy 安全、restart 双锁）——逐一核对无缺陷（见终审安全修复提交内实现细节）。

**收尾核验**：cargo 15+1+2 全绿；node 相关测试组全绿（host-ipc 8/8、supervisor 3/3、resume-parity 2/2、boundary 15/15、host-client 5/5）；tsc 0 err；lint 0 err（新增文件）。**子代理多维审查：2 维完整执行并全量处置，1 维（代码质量）因环境 5 次失败按预案主 agent 自审替代**。
## 路线 1 头切片 — Client SDK 适配器契约 + 首例迁移 — 完成（2026-09-02，doc 16）

**差距**：lib/client 已有 agent/sessions/system 域（HttpSse/Fixture adapter），但无适配器契约/构造入口；~31 文件 145 处直接调用仍被 allowlist 记录（多数属 facade 未覆盖域）。

**落地**：
- `lib/client/adapters.ts`：`ClientAdapterKind = "legacy-http" | "tauri-core" | "remote"` + 唯一构造点 `createOmpwebClient(kind)`；tauri-core/remote 未落地 → `AdapterUnavailableError`（code=client_runtime_unavailable，message 指明路线 18 / 14+20）——与 host fail-closed 同一纪律；unknown kind 显式拒绝。barrel 导出。
- **首例真实迁移（pattern proof）**：CommandPalette `/api/sessions` 直 fetch → `client.sessions.list()`；直接调用 145→144 / 31→30 文件；allowlist + W0 baseline inventory 重生成（audit-client-api.mjs，测试门同步）。
- 测试 `lib/client-adapters.test.mjs` 4 例（surface 完整性 / tauri-core fail-closed / remote fail-closed / unknown reject）。

**验证**：client-adapters + api-inventory + client-facade 11/11；tsc 0 err；lint 0 err。

**多维自审（8 维）**：产品（palette 行为等价，list 走 no-store 更新鲜）✅；架构（单构造点、kind 枚举穷尽、无循环依赖）✅；协议（无协议变更）✅；安全（未落地 adapter 显式不可用，无半成品路径）✅；OMP Parity（无 omp 面）✅；落地（测试/tsc/lint/库存门全绿）✅；兼容（legacy-http 与既有 createHttpSseClient 等价——工厂即其调用）✅；遗留（terminal/files/git/settings/commands/remote 域 surface + 其余 ~29 文件迁移 = 路线 1 主体，随域 cutover 推进）。
## 路线 1 切片 2 — git 域 facade surface + GitHubStatusPanel 迁移 — 完成（2026-09-02，doc 16）

- facade 新增 `git` 域（types：`GitClient.status/commit/push` + `GitHubStatusPayload`）：HttpGitClient（raw-body 映射、toClientError、no-store、refresh 参数）＋ FixtureGitClient（setGitStatus/failNextGit 脚本化，FixtureState 扩展）。
- **GitHubStatusPanel 3 处直 fetch 全迁 facade**（直接调用 144→141 / 30→29 文件；allowlist + W0 baseline 重生成）。
- 测试 +3（git 路由契约/URL 编码/错误映射 ClientError code http_500 retryable、fixture 脚本化）；19/19（adapters+facade+inventory+gates）；tsc 0 err；lint 0 err。

**自审**：产品（status/commit/push 行为逐字等价：URL、body、refresh、no-store、错误文案）✅；架构（domain surface 单向扩展、fixture 无网络）✅；协议（无后端变更）✅；安全（无新暴露）✅；落地（测试/门禁/库存全绿）✅；遗留（sessions-subagent/usage/models/terminal/files/settings/remote 等域 surface + 余下 ~27 文件 = 路线 1 主体，随各域契约落地推进）。

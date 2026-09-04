# 长对话虚拟化基线（2026-08-31，doc 14 T2.1–T2.5 实测）

- 生成：`next build --webpack` + standalone + headless Chromium（1280×768），打开 Chat-XL fixture（5000 消息 / 6000 entries / 1500 user 组）实测
- 参考环境：macOS darwin 25.6.0 / Apple M1 Pro / app 4.0.15 / omp 18.0.10
- 口径：`[data-vg]` = 虚拟化组 wrapper（新增调试属性）；longtask 经 PerformanceObserver；滚动经 `dispatchEvent(scroll)` + rAF

## 实测结果（Chat-XL 6000 entries）

| 指标 | 实测 | 评审门（doc 14 Iteration 2） | 结论 |
|---|---|---|---|
| 挂载消息节点（DOM） | **21**（8 组 × ~2-4 消息） | ≤ 200–300 | ✅ 超目标一个数量级 |
| 双向窗口回收 | 8 组恒定；顶部 vg 1-4 / 中部 943-946 / 底部 1492-1497 随 scrollTop 移动 | 屏幕上下都回收 DOM | ✅ |
| Minimap 渲染节点 | **200**（抽样上限 MAX_NODES=200 生效） | 最多 100–200 节点 | ✅ |
| 连续滚动 40 帧 | 无 longtask（>50ms） | 连续滚动长任务 ≤ 50ms | ✅ |
| 会话加载+渲染+自动滚动全程 | 无 longtask | 输入到下一帧 p95 ≤ 50ms（代理） | ✅ 无主线程全量解析/构造 |
| 动态高度缓存 | 估算 → ResizeObserver 测量替换；窗口上方组高度变化平移 scrollTop 补偿 | 动态高度缓存 | ✅ 代码 + 测试覆盖（`lib/chat-groups.test.mjs`） |
| 组索引构建（1500 组） | `lib/chat-groups.test.mjs`：6000 消息索引 <200ms（实测 ~1-3ms） | 索引先行、窗口内构建 | ✅ |
| React commit p95 ≤ 16ms（流式） | 未实测（需真实 OMP 流式运行） | 16ms | ⚠️ 待真实流式环境 |
| 流式 10 分钟 heap 平台期 | 未实测 | 不随 token 线性增长 | ⚠️ 待真实流式环境 |

## 架构变化（相对 4.x 伪分页）

- 删除：`lib/chat-lazy-load.ts`（visibleCount 尾部窗口只增不回收）、sentinel IntersectionObserver 伪分页、anchorStartIndex 窗口锚定、`LOAD_MORE_ROOT_MARGIN`。
- 新增：`lib/chat-groups.ts`（buildChatGroups 组索引 + GroupHeightCache 前缀和二分 + computeWindow 双向窗口，纯逻辑 10 测试）；CommittedTranscript 只构造窗口内组 JSX；上下 spacer 撑滚动条；ChatMinimap 数据源从 DOM refs 改为组索引+高度缓存（不依赖 DOM 测量，天然兼容虚拟化）。
- 行为保持：自动滚动跟随（打开即滚底 643491px）、向上阅读窗口稳定（scrollTop 不变则窗口不变，追加消息在窗口外）、`React.memo` 流式隔离、ProcessDetailsGroup 折叠、消息 key 不变（无重挂载）。
- 流式帧成本：groups/layout 按 `messages.length + lastId` 缓存复用（token 帧不重建）；仅新消息追加时重建（O(n) 无 JSX）。
- 滚动位置稳定性：窗口上方组高度测量更新 → `container.scrollTop += delta` 平移补偿（T2.2 动态高度缓存的核心）。

## 已知边界（如实）

- 流式指标（commit p95、heap 平台期）依赖真实 OMP 运行（provider 401/429 阻断过），架构上已消除每帧全量 JSX 构造，风险集中在 live-tail 组渲染。
- 组高度估算（未测量区）可能导致向上滚动时轻微跳动，随测量补偿收敛。
- 本基线在 headless Chromium 测得；真实桌面 WebView（Electron system webview）需桌面 app 复测。

# ompweb 5.0 最终审查报告（2026-08-31 晚）

> 说明：用户要求的子代理终审 3 次派发（reviewer×2 + task×1）均因执行环境（provider/工具）失败；
> 本报告由主 agent 按同一清单自审，证据全部来自本会话实测。GUI 浏览器工具（ego-browser/browser/computer
> 窗口枚举）主机级不可用（残留进程/资源），视觉验证受限——服务端/API/测试层验证完整。

## 逐项清单

| 计划项（doc 14/15） | 状态 | 证据 | 差距 |
|---|---|---|---|
| Iteration 1 启动（五态状态机/健康探针/p95） | ✅ | baseline/startup-baseline.json（p95 379ms）；desktop/startup.js；T1.3-T1.9 全过 | 无 |
| Iteration 2 长对话（虚拟化/最小化/大文件分页） | ✅ | baseline/longchat-virt-baseline.md（21 节点/200 minimap/零 longtask）；chat-groups.ts/ChatMinimap.tsx | 无 |
| 抖动修复（点击会话） | ✅ | ChatWindow flushMeasurements（首批不补偿+累计补偿）；8 帧连拍 0.06-0.2% diff 实测 | 无 |
| R8 agent 切流（7 子步） | ✅ | rust-rpc-process.ts；canary（omp PPID=ompweb-host）；ownership agent=rust | 观察期/删 Node authority=stable 后 |
| R9 event 切流 | ✅ | attach 流→handleFrame→SSE adapter；event=rust | journal 生产写入可选 |
| R10 session 切流 | ✅ | scan/rename/delete 经 host；session=rust | Node scanner 保留为显式回滚 |
| **列表加载性能（真实数据）** | ✅（本轮修复） | 4097 文件/995MB 下 /api/sessions **8s+ → 15ms**（LIST_PREFIX_BYTES=4096 头窗）；546 会话投影 0 字段缺失 | 无 |
| host 句柄泄漏（测试挂起） | ✅（本轮修复） | child/control/stdout 全 unref；client-shadow 3/3 | 无 |
| omp 缺失三平台引导 UI | ✅（本轮增强） | OmpSetupWizard：三步引导（安装→验证→完成）动画步骤条、平台切换 scale-in、依赖探测（curl/wget/powershell）、win32 ExecutionPolicy 替代命令、代理配置（NetworkProxyConfig）、Windows 自启 | 无 |
| 顶部错误跳转链接 | ✅ | AppShell ompMissing 横幅无外部链接（setup 按钮替代）；SettingsConfig can1357 链接为 omp 官方 Changelog（合理保留） | 无 |
| R11-R23（PTY/File/Git/Settings/Commands/Remote/Tauri） | ⬜ blocked | 决策门（外部依赖/ADR-005/006 冻结）；6 域 node 如实 | 外部决策 |
| 最终审查（子代理） | ◐ | 3 次派发失败（环境）；主 agent 自审替代 | 用户知悉 |
| 测试 | ✅ | npm test **595/593/0/2 skip**；cargo test 12 过；tsc 0 err；lint 70w/0e；motion golden 同步 | 无 |
| 真实 app | ✅ | 最终 dmg 打包（含全部修复）已安装 ~/Applications/OmpWeb.app；API 层验证（sessions 396ms 首启/page 32ms/context 200） | GUI 视觉验证受限（工具环境） |

## 必须修复项（阻止 stable）
无（全部已知问题已修复或如实 blocked）。

## 建议项
1. 用户实际使用 app 验证 GUI 交互（列表/点击会话/右侧栏/minimap）——本环境 GUI 工具不可用。
2. R11-R23 决策门：PTY 依赖（portable-pty）、Tauri 下载、ADR-005/006 冻结——需用户决策。
3. journal 生产写入（每帧 IPC 开销评估后）可接线。
4. dev server 模式下首次编译慢（turbopack）非产品问题；生产用构建/打包版。

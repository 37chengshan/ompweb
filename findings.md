# 全线路审查发现

## 基线

- 24 路线权威执行文档为 `docs/refactor/ompweb-5.0/16-rust-production-cutover-routes.md`。
- 当前工作树已经完成 agent/event 的部分 Rust 切流、PTY、files list/read/meta、git 核心操作、commands wait/detach、device/remote 首片和 5.1 UI；路线表仍明确记录大量 ◐/⬜。
- `npm test`、TypeScript、lint、cargo 和各类 audit 在上一轮均通过，但这只是当前切片门禁，不代表 R0-R23 完成。
- packaged macOS App 已更新至 5.1.0；开发端 OMP 为 18.0.11，App OMP 为 18.1.8，必须分开验收。

## 依赖判断

1. 先完成 domain facade/HostClient 与错误、事件契约，才能安全替换各 route authority。
2. Journal/Session/Agent 的恢复和幂等是 Remote、Mobile、Tauri 的共同状态底座。
3. Device Identity 和 Remote 安全决策必须在真实远程执行前冻结，不能用 simulator 代替 E2EE/relay 生产证明。
4. Tauri/Mobile/Push 属于独立产品交付面，不能由 Next/Electron 测试推断完成。

## 当前主要缺口

- Session tree/context/blob/archive/search 的完整 Rust authority、生产 journal 写入/resume/idempotency 未全量切流。
- Native Settings、Commands registry/ui-request/slash、Files upload/download/watch/docx、Git diff/worktree/archive 仍有 Node authority。
- Remote 执行面、E2EE、真实 relay、多路径网络、Tauri、Mobile、Push、Node authority retirement 和最终 release gate 尚未完成。
- packaged App 缺 Developer ID 签名与 notarization；真实 provider/config 写入及跨平台安装验证未完成。

## 本轮新增证据

- `settings.list` 曾把 OMP 的格式化 JSON 原样嵌入 Host NDJSON 响应；响应中的裸换行会让 Node 控制连接无法解析完整帧。Rust 侧现在压缩 JSON（字符串内空白保持不变），并有单测与 Host IPC 回归覆盖。
- 诊断“每次打开部分异常”的可复现原因是开发端与 packaged App 同时存在时，`instances.others` 被 `healthOf()` 当成 warning；健康 sibling 实例现在只展示信息，不改变总体健康状态。
- 当前开发端与 packaged App 仍使用不同 OMP 版本（开发端 18.0.11、App 18.1.8），这是验证环境差异，不应再被 UI 误报成后端故障；发布前仍需锁定并记录目标 OMP 版本。
- 第二轮真实证据：Native Settings 的 485 项响应通过共享请求缓存后不再重复拉取，初始加载显示明确 loading；全局搜索可以跨分类按 key/description 命中。TerminalTabs 关闭最后标签后显示空态，关闭抽屉并重新打开可创建新 shell；Web 控制台 error/warn 为空。
- Rust/JS 收尾门禁再次通过：711 JS tests（709 pass/2 skipped）、tsc、lint、diff check、cargo 51+1+3 全绿。cargo 仍有 unused/dead-code 警告，属于维护项，不是本轮阻断项。

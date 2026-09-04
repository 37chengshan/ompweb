# OmpWeb 全线路收口计划

## 目标

把 5.0 Rust Production Cutover 的 R0-R23、5.1 UI/终端/设置修复、macOS App、远程与发布链路按真实代码和可重复门禁推进到可验收状态；任何依赖外部凭据、Apple/Windows 签名或尚不存在的产品决策均明确标记为 blocked，而不是伪造完成。

## 阶段

| 阶段 | 范围 | 状态 |
|---|---|---|
| 0 | 基线、工作树、路线依赖和现有门禁盘点 | complete (evidence recorded) |
| 1 | Client facade / HostClient / ownership / 错误与事件契约统一 | in_progress |
| 2 | Agent、Event、Journal、Session、PTY 全生产路径与无 Node 静默回退 | pending |
| 3 | Files、Git、Settings、Commands、Device Identity 全 Rust authority | pending |
| 4 | Remote WS、resume、E2EE 决策、Relay、设备安全 | pending |
| 5 | Tauri/Desktop、Web compatibility、Mobile/Push | pending |
| 6 | 性能、可访问性、启动动画、App 打包签名与跨平台发布 | pending |
| 7 | 全量门禁、浏览器/App/真实外部系统验收、报告与发布判定 | pending |

## 当前约束

- 保留用户已有 dirty worktree，不 reset/checkout，不 push `main`。
- 先集中完成一个依赖闭环，再集中运行验证；不把局部测试当作全项目 release proof。
- 当前已完成的 5.1 UI 波次、虚拟会话空白修复、Rust PTY writer 修复和 macOS 5.1.0 本地包作为基线，不重复破坏。
- 外部 provider、OAuth、Apple/Windows 签名、公证、真实远端部署没有凭据时只能报告 blocked。

## 已落地的第一轮闭环

- HostClient 新增 settings domain；Rust host 负责 `omp config list/path/set/reset` 的边界、argv 校验、输出上限和 NDJSON 单帧化。
- 诊断跨实例探测改为 `/api/health`，且健康并行实例不再把总体状态染成 warning。
- 验证：Host IPC 9/9、JS 707（705 pass/2 skipped）、tsc 通过、cargo test 通过、lint 0 error。

## 尚未宣称完成

全路线仍未完成。Session context/tree/blob/archive/search、生产 journal 写入与 resume 幂等、Files 二进制/upload/watch/docx、Git worktree/archive、Commands registry/ui-request/slash、Remote E2EE/relay、多路径网络、Tauri、Mobile/Push、Node authority retirement 与签名公证仍是后续阶段；其中 E2EE/relay、Apple/Windows 签名、公证和真实移动设备验收需要外部决策、凭据或设备条件。

## 错误记录

| 错误 | 处理 |
|---|---|
| `docs/CODEX-NAVIGATION-GUIDE.md` 在当前 checkout 不存在 | 记录为仓库文档缺失，改读现有 `AGENTS.md` 与 `docs/refactor/ompweb-5.0` 路线文档 |

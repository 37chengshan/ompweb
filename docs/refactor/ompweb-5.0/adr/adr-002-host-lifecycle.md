# ADR-002 — Host 生命周期：独立 user-scoped Host，Tauri/Web 为薄客户端

状态：草案（方向已决定，运行机制待 spike）· 日期：2026-08-30 · 关联：`06-rust-runtime-and-projections.md`、`09-desktop-tauri-migration.md`

## 背景

原始计划把 Rust Core 放进 Tauri 壳内，关窗即杀 Agent。长任务和远程连续性要求更清晰的模型。现状：Electron 主进程拉起 Next standalone（`desktop/main.js`），Host 生命周期与桌面窗口耦合。

## 已决定

1. 目标架构为 **独立 user-scoped `ompweb-host` 进程**：OMP Supervisor、Event/Projection DB、Remote listener、PTY/File/Git 服务都在其中；Tauri/Web/Mobile 只是客户端。
2. 关闭 UI 窗口不终止活跃 Agent；"Quit UI"与"Stop Host"是两个显式动作，最终交互由 tray/menu 呈现。
3. Electron/Next 打包在 Tauri Stable 前持续可发布（回滚面）。

## 待 spike（06 Host PoC 时冻结）

1. npm 全局用户的 Host 启动方式：CLI 前台子进程 vs launchd/systemd user service vs 首次交互式询问。候选判定输入：安装/卸载复杂度、崩溃恢复、防火墙提示次数。
2. Host 独占锁与多实例策略（同用户双 Host 禁止还是 second-instance 接管）。
3. "Host 已运行"复用与"真正冷启动"的区分计时口径（对接 12 启动分解）。
4. Tauri 关窗默认行为（hide-to-tray vs confirm）与 macOS/Windows 平台差异。

## 外部依赖

- Tauri 2 tray/menu/autostart 插件能力；OS keychain（ADR-005）。

## 后果

- 需要为无 Tauri 场景（纯 Web + CLI）提供 Host 前台模式，否则 npm 用户无法使用 5.0 Host。
- Electron 时代的"关窗即停"语义会变化，必须有显式迁移说明与 tray 状态提示，不允许静默改变。

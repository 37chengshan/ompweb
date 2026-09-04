# 全线路收口进度

## 2026-09-04

- 初始化全线路计划、发现和进度文件。
- 复核 16 号 24 路线文档：当前状态不是全路线完成，后续按阶段推进并保持真实边界。
- 当前 5.1 UI/PTY 波次门禁和 macOS App 5.1.0 状态沿用既有报告，不重新标记为全路线完成。
- 修复 Rust Host 的 NDJSON 分帧缺陷：`settings.list` 会先校验 OMP JSON，再压缩字符串外空白，避免 481-key 配置中的换行把一条响应拆成多帧并触发 30s 超时；新增回归测试。
- 新增 route 11 Settings Rust 首片：`settings.list/path/set/reset` 通过 `HostClient → ompweb-host`，Node 仅作为显式 `OMPWEB_BACKEND=node` 回滚；`npm` Host IPC 9/9 通过，开发端 `/api/native-settings` 已实测返回 200（当前 485 项）。
- 修复诊断页把健康的 30178/30179 并行实例误判为“部分异常”：并行实例改为信息项，仍保留端口和显式停止操作；异常只由 host/RPC/backend/proxy 等真实故障触发。
- 全量 JS 门禁当前为 708 tests（706 pass、2 skipped、0 fail）；TypeScript 0 error；cargo test 通过；lint 0 error（仅既有 warning）。
- `npm run desktop:build` 重试成功（首次为 Electron 下载 TLS 短暂中断）；已重新替换并启动 `~/Applications/OmpWeb.app`。App health 5.1.0 / OMP 18.1.8 / native-settings HTTP 200；开发端 30178 已重新启动。
- 第二轮大迭代：NativeSettingsPanel 增加 schema 请求缓存/in-flight 去重、明确加载态、跨分类全局搜索；TerminalTabs 修正“关闭最后 tab 保持空态、关抽屉后重新打开创建 shell”的生命周期语义，并补齐 SSR/行为测试。
- 收尾门禁：`npm test` 711（709 pass/0 fail/2 skipped）、`npm run typecheck` 通过、`npm run lint -- --quiet` 通过、`git diff --check` 通过；完整 `npm run lint` 为 0 error / 80 warnings；`cargo test --locked --manifest-path crates/Cargo.toml` 51+1+3 Rust/conformance tests 全通过（仅既有 warning）。
- 真实 Web 复测：设置加载/保存/reset、独立弹窗、终端连续命令/多 tab/最后 tab 空态/关抽屉重建、会话切换和 Agents 均通过；浏览器 error/warn 日志为空。App UI 仍受 macOS 锁屏阻断，未扩写为完整 App E2E。
- 第二轮源码已重新执行 `npm run desktop:build`（Next 25 页 + host build/stage + electron-builder arm64 DMG/zip）并替换/启动 `~/Applications/OmpWeb.app`；App `/api/health` 与 `/api/native-settings` 均为 200，诊断显示 packaged `Resources/bin/ompweb-host` 可用、无 orphan/RPC/backend 错误。未签名/未公证仍是发布限制。

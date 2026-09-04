# ompweb 5.1 全项目收口报告

日期：2026-09-04  
范围：5.0→5.1 UI/终端/设置/诊断波次、Rust Host 首批生产切片、开发浏览器与 macOS App 验证

## 结论先行

本轮已经把 5.1 波次收口，并完成 Rust Settings 的首个生产切片、诊断误报修复和最新 macOS App 重打包。开发浏览器可以继续做真实交互测试，当前 App 也已经更新到 5.1.0 并通过启动健康探针。

但仓库还不能被描述为“全项目所有路线均已完成”。R0–R23 中仍有明确的未实现或未验收路线，尤其是完整 Session/Journal 语义、Files/Git/Commands/Remote 的剩余能力、Tauri/Mobile 形态、Node authority retirement，以及签名公证和真实外部系统验收。以下报告把已闭环、部分切片、未验证和外部阻断严格分开。

## 本轮已闭环

### 第二轮大迭代（本次收尾）

- 原生设置请求增加浏览器内缓存与 in-flight 去重：内嵌设置和独立弹窗共享一次 schema 请求，保存/重置后同步缓存；首次请求显示明确加载态，不再短暂显示“没有匹配的设置”。
- 设置搜索改为跨全部 schema 的全局检索（键名+说明），不要求用户先猜分类；分类布局、子分类、中文解释和可编辑控件保持不变。
- 终端生命周期补齐：关闭最后一个标签时保持真实空态；关闭抽屉再打开会创建新的 shell；快捷命令仍按 cwd 复用并只消费一次。终端继续固定在底部 drawer，支持上下拖拽和多标签，右栏不再承载终端。
- 新增/补强 SSR 与行为回归：原生设置加载态/独立入口、终端初始化与最后标签语义均纳入标准测试脚本。

### Web/UI 波次

- 侧边栏 Agents 面板：live/history 分组、排序、计数、状态和 telemetry，点击可打开转录。
- 会话切换：抑制过期 cwd 事件，避免选中态抽搐；虚拟聊天组高度缓存和首帧测量修复中段/尾部整段空白。
- GitHub 状态浮钮移到主区右上角；设置左栏默认收起，悬停显示分类名称，选中指示条上下滑动。
- 原生设置改为 OMP 风格分类布局：顶部分类、左侧子分类、右侧可编辑设置项；中文描述覆盖当前 360 条 schema 描述；提供独立窗口入口。
- 终端从右栏移到底部 drawer；顶部 row-resize 支持上下拖拽，tab 条位于输出下方，右栏只保留 Files/Agents。
- 开屏动画、图标、Provider blur 重命名、模型默认 thinking/image 等 5.1 交互细节已纳入统一门禁。

### Rust Host 与后端

- PTY writer 在 Host 会话内持有，不再因 `write()` 临时丢弃 writer 让 shell 收到 EOF；连续写入回归和真实三连写探针均通过。
- `settings.list/path/set/reset` 已接入 `ompweb-host --ipc`、HostClient 和 `/api/native-settings`。默认 Rust 模式调用 Rust Host，`OMPWEB_BACKEND=node` 仍是显式回滚路径。
- 修复 OMP pretty JSON 进入 NDJSON 响应导致 481-key 设置列表被拆帧并超时的问题：Rust 先校验再压缩 JSON，字符串内部空白保持不变。
- 诊断跨实例探针改用 `/api/health`，健康的 30179 sibling 不再被报告为异常；真正的孤儿 Host/RPC/错误环仍按分类展示并提供处理入口。
- 打包脚本在静态构建阶段创建兼容目录，避免 electron-builder 对不存在的 `.next/standalone/crates` 产生误导性警告；正式 packaged Host 仍以 `Contents/Resources/bin/ompweb-host` 为唯一来源。

## 验证证据

| 检查 | 结果 |
|---|---|
| `npm test` | 711 项：709 pass / 0 fail / 2 skipped |
| `npm run typecheck` | 通过，0 error |
| `npm run lint` | 通过，0 error；当前输出 80 个既有 warning（非阻断） |
| `cargo test --locked --manifest-path crates/Cargo.toml` | 通过（仅 warning） |
| Host IPC settings 回归 | 9/9 通过 |
| native settings 描述覆盖 | 360/360 |
| API inventory / ownership / motion manifest | 全部通过 |
| `git diff --check` | 通过 |
| Next 生产构建 | 通过，25 个静态页 |

## Web 与 App 的边界

### 开发浏览器

- 30178 已重新启动，首页、工作区、会话树、设置分类/收起/悬停、原生设置加载、右上角浮钮和底部终端完成真实交互冒烟。
- `/api/native-settings` 实测 HTTP 200，当前返回 485 个 key（约 77 KB）；481-key 是修复前分帧问题的历史样本。
- 真实复测：原生设置加载 485 项并显示中文分类/说明；设置项可切换并 reset；独立弹窗打开后共享已加载数据；终端连续命令输出、多标签、关闭最后标签空态、关闭抽屉后重建 shell 均通过；会话切换和 Agents 面板均可用。
- 浏览器控制台错误/警告复测为空；终端重开后的 AX 树显示 `ONLINE`、cwd 和新的 tab。
- 未把浏览器证据扩大解释为真实 provider、OAuth、破坏性 config/models 写入或长时 PTY 压测通过。

### packaged macOS App

- `~/Applications/OmpWeb.app` 已由第二轮最新源码重新打包替换并重新启动，`CFBundleShortVersionString=5.1.0`。
- `GET http://127.0.0.1:30179/api/health` 返回 `ok=true`、`ompReady=true`、`ompVersion=omp/18.1.8`。
- App 的 native settings 返回 HTTP 200（485 项）；当前诊断快照为 `others=[30178]`（健康的开发 sibling，仅信息项）、`orphanRustHosts=0`、RPC active/recent/orphans 均为 0、backendErrors 为空；Rust Host 使用 packaged `Resources/bin` 显式路径。
- 产物：`dist-desktop/OmpWeb-5.1.0-arm64.dmg`（约 274 MB）和 arm64 zip（约 280 MB）。
- 本机没有 Developer ID，因此 electron-builder 跳过 macOS code signing；当前包是本机验收包，不是可直接分发的 notarized 发布包。App 窗口尚未逐项完成真实模型调用、设置写入、终端连续输入和全部会话切换 E2E。
- 本次重打包命令完整通过：Next 25 静态页、Rust host build/stage、electron-builder arm64 DMG/zip；旧运行包已保留为 `~/Applications/OmpWeb.app.previous-<timestamp>` 备份。由于 macOS 当前锁屏，CUA 无法读取/操作 App AX 窗口，因此窗口级回归仍标记为未验证。

## Rust Production Cutover 状态

| 域/形态 | 当前状态 | 说明 |
|---|---|---|
| agent/event/session scan-rename-delete | 部分 Rust authority | 默认 Rust 切流；完整 utility/auth/env 与 Session 语义仍有 Node/未实现边界 |
| journal/snapshot/resume | 部分 | append/view 端点存在；生产写入接线、resume、client_msg_id 幂等未完成 |
| PTY | 已切 Rust | writer 生命周期已修复；仍需 packaged 长时、多 tab、TTL 的实测基线 |
| files | 部分 | list/read/meta 切片已切；二进制流、upload/download/watch/docx 仍未切完 |
| git | 部分 | status/branches/checkout/commit/push 切片已切；diff/worktree/archive 未切完 |
| settings | 首片 | list/path/set/reset 已切；完整 schema 范围、版本化冲突和所有写入场景未完成 |
| commands | 部分 | scripts.run 已切；ui-request、slash 注册仍未切 |
| devices/remote | 部分 | device registry 和 Remote WS/protocol 框架存在；pair cookie、E2EE、relay、多路径和远程执行未完成 |
| Tauri Desktop | 未开始/未验收 | 当前生产桌面形态仍是 Electron |
| Mobile/Push | 未开始/未验收 | ADR 延后决策 |
| Node authority retirement | 未完成 | 依赖上述域逐一达到 cutover 条件后才能删除 |

## 仍存在的项目级问题与风险

1. **完整路线未收口**：Session context/tree/blob/archive/search、Journal resume/idempotency、Files 二进制/upload/watch/docx、Git diff/worktree/archive、Commands ui-request/slash、Remote E2EE/relay/multi-path、Tauri、Mobile/Push 均仍有路线工作。
2. **真实外部系统未验收**：provider 请求、OAuth 登录、凭据写入、GitHub 发布、远程配对/多设备、Windows 安装包、Apple 签名与公证都没有通过证据。
3. **App 全量 E2E 未完成**：浏览器与 App 必须分别验证；不能用 30178 的结果替代 30179 packaged 窗口行为。
4. **发布工程未完成**：dist 目录可能保留历史产物；正式发布前需只保留目标版本、配置签名、公证、更新渠道和回滚方案。
5. **维护 warning**：Rust unused/dead-code、Node `MODULE_TYPELESS_PACKAGE_JSON` 和 lint 非 quiet 的既有 warning 不阻断门禁，但应在维护波次清理。
6. **性能缺少实测基线**：尚无低端 Mac、超长 transcript、多终端并发、30 分钟 PTY TTL、SSE 高频更新的量化基线；目前只能确认功能回归，不应宣称性能已证明。

## Git 与发布判定

- 当前分支：`main`。
- 本地领先 `origin/main` 31 个提交；本轮没有推送、合并或替用户发布。
- 工作树保留本轮源码、测试、生成基线和文档变更；提交前应由维护者确认生成文件和历史测试残留是否一并纳入。

**最终判定：** 5.1 UI、设置、诊断、启动衔接、会话空白/抽搐修复和 Rust PTY writer 已完成代码级收口，开发浏览器已定向冒烟通过，macOS App 已更新并通过健康/Host/设置探针。项目整体仍处于“5.1 可测试候选 + Rust Production Cutover 进行中”，不是 R0–R23 全部完成、签名公证和外部系统均已验收的正式 release。

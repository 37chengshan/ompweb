# 5.1.9 发布执行记录

2026-09-05，用户明确授权“继续，然后推送发布”。远端 5.1.7 已有公开桌面包，首次使用 5.1.8 候选；因 DLL 检查发现阻断项，取消其流水线并保留草稿/标签，随后使用 5.1.9。5.1.8 未发布到 npm。

## 候选已通过

- Node 22.19.0、Node 24.14.0：各 739 项，730 通过、9 跳过、0 失败、0 取消；远端 Linux CI 同样通过。
- Rust workspace：64 项通过；TypeScript 0 错误；ESLint 0 错误、82 个既有警告。
- npm audit：0 漏洞；补丁更新 @humanfs/node 0.16.8、@xmldom/xmldom 0.8.15。
- 本机 staged host：实际健康检查、IPC 鉴权、ping、中文空格路径读取、空授权根拒绝全部通过。
- 更早的真实 npm 候选安装已通过 OMP 握手、Rust 文件读取和实际 PTY shell 执行，详见验证记录。

## 发布步骤

1. 提交并推送本轮集成修复与版本 5.1.9；main CI 通过后创建新标签。
2. 四平台分别构建并运行 host；聚合进唯一 npm tarball。
3. 四平台使用最终 tarball 执行 npm install，并实际调用安装目录内的 host，再允许 npm 发布。
4. 三平台构建桌面安装包，检查 GitHub Release 和 npm registry 的实际结果。

旧 v5.1.7 的 npm 任务卡在测试阶段超过一小时，已取消，防止过时产物后续意外发布。本轮为测试与发布任务加入明确超时。

## 尚待专项验收

- Windows UAC/UNC/长路径、完整 App 人工流程与移动端键盘/弱网仍待专项验收。

## 发布前补充发现

- 系统 Node 无法读取 app.asar 内的 peer preload；构建时将它复制到外部 standalone/bin，桌面入口改用此路径，并通过真实 Node 加载回归。
- 首次 main CI 发现既有 Git 测试依赖全局 user.name/email，干净 runner 提交失败；IPC 测试未提前注册清理，失败后 host 遗留导致测试挂起。现改为 fixture-local Git 身份和提前注册 cleanup；不修改用户全局 Git 配置。

## Windows 原生依赖阻断与修复

5.1.8 的 Windows host 已能在 GitHub Windows runner 启动，但 PE import table 包含 `VCRUNTIME140.dll`。这只能说明预装 Visual Studio 的 runner 可运行，不能保证普通 npm 用户无 VC 运行库时可用，因此停止了 npm 与桌面流水线，保留 5.1.8 草稿而不发布。

5.1.9 使用显式 MSVC target 与 `+crt-static` 构建；staging 和完整 npm payload verifier 都读取真实 PE import table，发现外部 VCRUNTIME/MSVCP/CONCRT DLL 即阻断。该机制同时覆盖 npm 和 App。已用 5.1.8 的真实 exe 验证拒绝分支；新 exe 已通过四平台构建/运行门禁；下载后再次检查，导入表只剩 Windows 系统库，见 [5.1.9 导入表](evidence/windows-5.1.9-imports.json)。

依据：[Rust 官方 CRT 链接说明](https://doc.rust-lang.org/reference/linkage.html#static-and-dynamic-c-runtimes)。

## 最终候选

- 标签：`v5.1.9`；源码 SHA：`12e119deaf503b52c166ae47cd30dbebde9d8db9`。
- [main CI](https://github.com/37chengshan/ompweb/actions/runs/33967602705)：通过。
- [npm 发布工作流](https://github.com/37chengshan/ompweb/actions/runs/33967736833)。
- [桌面打包工作流](https://github.com/37chengshan/ompweb/actions/runs/33967736883)。

## 实际发布与产物验证

- GitHub Release 已于 2026-09-05 13:09:06 UTC 公开：[OmpWeb 5.1.9](https://github.com/37chengshan/ompweb/releases/tag/v5.1.9)。三平台桌面构建全部成功，10 个附件（安装包、zip、更新清单、blockmap）摘要见 [发布附件](evidence/github-release-5.1.9.json)。
- npm 最终包：28,813,146 字节、781 个文件、四目标 Rust host，均保留可执行权限；没有 .omp、dist-desktop、嵌套 standalone 残留。完整 integrity 见 [包清单](evidence/release-package-5.1.9.json)。
- 四平台均通过最终 tarball 的 npm install、安装目录 host 的 IPC/文件读/授权拒绝及 CLI --version。
- 同一 CI tarball 在本机独立安装，HTTP 报告 app=5.1.9；Rust 文件读取、真实 OMP 18.1.8 握手、PTY shell 写文件均通过；进程路径确认 host 来自 npm 安装目录。[原始结果](evidence/release-installed-smoke-5.1.9.json)。
- npm CI 的发布阶段返回 E404/权限拒绝；构建、包聚合和四平台安装阶段都成功。改用本机现有 37chengshan 登录发布同一 tarball，用户完成 npm 两步验证后，5.1.9 发布成功，latest=5.1.9；registry integrity 与验收 tarball 完全相同。[Registry 证据](evidence/npm-registry-5.1.9.json)。未改动或上传发布凭证。

## 下一轮发布链路事项

- 检查 npm 包的 trusted publisher 绑定与 GitHub publish.yml / npm environment 是否匹配；修复身份配置需要账户持有人参与，不将 CI 的 E404 误写成已成功发布。
- [x] Registry integrity 与已验收 CI tarball 完全一致。
- 重跑发布任务已成功识别 5.1.9 为已发布版本；该标签运行剩余失败是未配置 Discord webhook 的通知 job，发布和四平台验收均已成功。main 已改为未配置时跳过可选通知；保留旧运行的真实失败记录，不重写发布标签。

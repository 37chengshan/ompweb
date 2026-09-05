# 工作包 D：验证记录与下一轮发布门禁

日期：2026-09-05。本机：macOS arm64、Node v24.14.0、Rust 1.95.0。

## 本轮最终结果

| 检查 | 结果 | 解释 |
|---|---|---|
| 完整 `npm test` | **738 项：729 通过、9 跳过、0 失败** | 主测试禁用真实 OMP；真实 OMP 另做隔离安装验证 |
| Node 22.19 最低版本 | **729 通过、9 跳过、0 失败、0 取消** | 修复活动 IPC 请求提前退出后重跑 |
| npm audit | **0 漏洞** | 官方 registry；更新 humanfs / xmldom 的兼容补丁 |
| TypeScript | **通过，0 错误** | `tsc --noEmit` |
| ESLint | **0 错误、82 警告** | 保留未纳入本轮的 warning，不将它们写成 0 warning |
| Rust workspace tests | **64 项通过** | host 58 + conformance 1 + storage 3 + smoke 2 |
| Rust host build | **通过** | `cargo build --locked` |
| git diff --check | **通过** | 发布执行另见 [记录](06-release.md) |
| 隔离 Next 生产构建 | **通过，25 个静态页** | 在临时源码副本和独立依赖副本中构建，没有污染工作区 `.next` |
| 当前平台 host 校验 | **通过** | darwin-arm64 二进制存在、格式正确、0755 |
| 真实 npm 安装 | **通过** | 从本轮构建的 tarball 执行 `npm install --omit=dev`；111 个依赖实际安装 |
| HTTP / Rust 文件读取 | **200，内容匹配** | 未设置外部 `OMPWEB_HOST_BIN` |
| 真实 OMP 握手 | **200 / success=true** | OMP 18.1.8，`ensure_session`，没有发送模型提示 |
| Rust PTY | **创建 200、输入 200、实际执行成功** | shell 生成测试文件，内容为 `terminal-ok` |
| Windows / macOS x64 / Linux 实装 | **未执行** | CI 矩阵已实现，不能把配置存在写成 CI 已通过 |
| 新版 packaged App 窗口 / 移动端 UI | **未执行** | 不能引用旧包或旧文档证据替代 |

九项跳过包括七项直接使用真实 OMP 的既有测试，以及两项文件系统/平台条件测试。安装冒烟只补充了真实 OMP 基本握手，不等同于补齐七项真实 OMP 测试的所有断言。

## 实际产物说明

本地用于 macOS 安装验证的候选包只含 darwin-arm64 host；跨平台四目标包由 CI 聚合。**这个本地单平台 tarball 不可充当四平台发布包。** 体积/文件数见 [候选包清单](evidence/candidate-package.json)，包内不再发现 `.omp` 或嵌套 `dist-desktop` 残留。

为了避免机器上已有的开发/桌面实例被 CLI 自动复用，安装冒烟使用与 launcher 相同的 Next 启动参数直接启动已安装包，带本轮 peer preload；没有借用工作区 node_modules 或桌面 Rust host。OMP CLI 使用本机已有安装，但配置、cwd、runtime.db 全部隔离到临时目录。最终复测还移走了构建目录中的 host，并通过进程路径确认实际执行的是已安装 npm 包内的二进制。

“真实 shell 执行成功”通过命令生成文件验证；不把它扩展为终端 UI 键盘、长时输出或 Windows 控制台已通过。

## 原始证据

- [基线 Rust 故障探针](evidence/baseline-rust-probes.json)
- [基线 host 并发启动失败](evidence/baseline-host-startup.json)
- [真实 npm 安装 API 与终端结果](evidence/installed-npm-smoke.json)
- [本地候选包与 host 权限](evidence/candidate-package.json)
- [最终检查数字](evidence/verification-summary.json)

基线探针与当前回归测试是两类证据：前者证明原问题；后者验证修复后的行为。保留原问题记录，不将其误标为当前仍失败。

## 下一轮验收清单（不增加新功能）

### 阶段 1：固定候选

- [ ] 合并同工作区并行修改，记录唯一候选 SHA。
- [ ] 按最终 SHA 重跑标准 Node/Rust/typecheck/lint。
- [ ] 确认没有新增错误被“更新 golden”掩盖。
- [ ] 清点 preloader、host 文件、声明文件和依赖是否进入真实 tarball。

### 阶段 2：跨平台安装

- [ ] Linux x64、Windows x64、macOS x64/arm64 各跑 host 构建与包内执行。
- [ ] 完整 npm tarball 四平台聚合，保留 tar 中执行权限。
- [ ] 无桌面 App/无 Cargo/无外部 host 覆盖的账户通过基础操作。
- [ ] Windows 非管理员、中文空格目录、UNC/junction/长路径和代理环境。

### 阶段 3：产品表面与退出

- [ ] Web 冷启动与 signed-peer 正常通过，远程未配对/伪造 Host 拒绝。
- [ ] 新 packaged App 的启动、终端、设置、会话切换和退出。
- [ ] 手机软键盘、SafeArea、弱网重连和目录刷新顺序。
- [ ] 同时打开多个终端和会话，验证 IPC 上限、超时、恢复及句柄稳定性。
- [ ] 无关进程占用端口时仍存活；更新/关闭后自有进程与文件占用释放。

### 阶段 4：发布

- [ ] 四目标最终 npm 安装包必须实际安装并执行包内 host；UI/特殊权限场景保留后续验收状态，不宣称已通过。
- [ ] 将候选 SHA、npm integrity、App hash、平台与测试记录绑定到同一发布记录。
- [x] 用户已明确授权推送与发布；动作和结果见 [发布记录](06-release.md)。

## 尚未承诺的项目

没有承诺全部高可用压力测试、所有 Windows 变体、所有浏览器、真实 provider/OAuth、全局无内存泄漏或所有 API exactly-once。下一轮应以失败场景和产物为验收单位，避免扩充范围后再次失去收尾边界。

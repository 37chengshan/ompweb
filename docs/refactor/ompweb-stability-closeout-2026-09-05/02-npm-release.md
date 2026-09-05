# 工作包 A：npm 与发布链路收尾

## 目标

用户通过正常 npm 安装得到与应用同版本的 Rust host，无需安装桌面 App 或 Rust 工具链。已有 OMP CLI 仍是运行 agent 的独立前提；两种程序的安装职责不可混淆。

## 本轮已完成的代码

| 范围 | 最终行为 |
|---|---|
| `package.json.files` | 包含 vendor host，排除整个 `.next/standalone` 的重复/本机残留 |
| `lib/omp/host-bin.ts` | 按真实 platform/arch 选择，不把 32 位架构映射到 64 位；支持包根查找 |
| `bin/omp-web.js` | 包内 host 优先于借用桌面 host；仍保留显式环境覆盖 |
| `scripts/stage-host.mjs --vendor` | 建立平台架构目录 |
| `scripts/verify-host-package.mjs` | 校验目标、可执行权限及二进制格式；默认要求四目标齐全 |
| `.github/workflows/publish.yml` | 平台矩阵构建、tar 归档、跨 job 聚合和校验 |
| 启动入口 | CLI、桌面启动器、Electron、npm dev/start 都预加载可信 socket 边界 |

GitHub artifact 传输不保留原可执行权限，因此传输 tar 文件再解压，不能下载裸文件后假设仍有 0755。[GitHub 官方说明](https://github.com/actions/upload-artifact#permission-loss)

macOS runner 使用当前仍支持的 macos-15 / macos-15-intel，避开已退役 macos-13。[GitHub runner 文档](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)

## 下一轮验收步骤

1. 固定候选提交；运行四目标 build-hosts，检查目录名和实际二进制架构相符。Linux 使用 Ubuntu 22.04 构建，至少对相同或更新 glibc 环境做实机测试；musl/Alpine 与 Linux arm64 不在当前四目标包的验收声明内。
2. 聚合完成后执行 verifier，故意删除其中一个 host，验证发布步骤会失败。恢复原件后继续。
3. 对最终 `.tgz` 核对四个 host、权限、没有 `.omp`/嵌套旧 App。检查应针对打包结果，不能只检查源码目录。
4. 在没有桌面 App、没有 Cargo、没有 `OMPWEB_HOST_BIN` 的系统账户安装 `.tgz`。使用包内 launcher，测试 --version、启动、本机访问、文件读取、OMP ensure_session 和 PTY。
5. 用带空格/中文的安装目录复测，Windows 再覆盖标准用户、代理环境、卸载/覆盖安装时文件占用。
6. 故意缺少或损坏 host，确认提示 runtime unavailable，不在后台默默切 Node。

## 发布门禁

- 四目标二进制缺任一项：阻断。
- 安装成功但应用依赖 Rust 的操作失败：阻断。
- 只有开发目录可用、包内相同版本不可用：阻断。
- 本机 macOS arm64 通过不代表其余三目标通过。
- 不能发布本轮仅包含当前平台的本地测试 tarball；它用于 macOS 安装验证，CI 完整聚合包才是跨平台发布候选。

## 回滚

保留上一个版本及其完整平台 host 产物；发布失败先停止发布。运行时允许用户显式设置 `OMPWEB_BACKEND=node`，但这只能作为明确的应急路径，不能用来满足 Rust 发行包验收。

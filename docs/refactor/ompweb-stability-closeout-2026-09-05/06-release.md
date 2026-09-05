# 5.1.8 发布执行记录

2026-09-05，用户明确授权“继续，然后推送发布”。远端 5.1.7 已有公开桌面包，因此本轮使用新补丁版本 5.1.8，保留原标签与产物。

## 候选已通过

- Node 22.19.0、Node 24.14.0：Node 22 最终 739 项（730 通过），Node 24 初次 738 项（729 通过）；另过新增打包回归；9 跳过、0 失败、0 取消。
- Rust workspace：64 项通过；TypeScript 0 错误；ESLint 0 错误、82 个既有警告。
- npm audit：0 漏洞；补丁更新 @humanfs/node 0.16.8、@xmldom/xmldom 0.8.15。
- 本机 staged host：实际健康检查、IPC 鉴权、ping、中文空格路径读取、空授权根拒绝全部通过。
- 更早的真实 npm 候选安装已通过 OMP 握手、Rust 文件读取和实际 PTY shell 执行，详见验证记录。

## 发布步骤

1. 提交并推送本轮集成修复与版本 5.1.8；main CI 通过后创建新标签。
2. 四平台分别构建并运行 host；聚合进唯一 npm tarball。
3. 四平台使用最终 tarball 执行 npm install，并实际调用安装目录内的 host，再允许 npm 发布。
4. 三平台构建桌面安装包，检查 GitHub Release 和 npm registry 的实际结果。

旧 v5.1.7 的 npm 任务卡在测试阶段超过一小时，已取消，防止过时产物后续意外发布。本轮为测试与发布任务加入明确超时。

## 待回填

- 候选 SHA、工作流链接、npm integrity 与桌面文件摘要在发布完成后补充。
- Windows UAC/UNC/长路径、完整 App 人工流程与移动端键盘/弱网仍待专项验收。

## 发布前补充发现

- 系统 Node 无法读取 app.asar 内的 peer preload；构建时将它复制到外部 standalone/bin，桌面入口改用此路径，并通过真实 Node 加载回归。
- 首次 main CI 发现既有 Git 测试依赖全局 user.name/email，干净 runner 提交失败；IPC 测试未提前注册清理，失败后 host 遗留导致测试挂起。现改为 fixture-local Git 身份和提前注册 cleanup；不修改用户全局 Git 配置。

# W0.5 安全修复与分诊记录（2026-08-30）

触发：Mimosa L3 git 门在 W0 提交前报 14 高危 / 4 中危。深度密封扫描
（scanId `scan-2026-08-30T06-57-37.616Z-db4ac26d38b1`，seal `sha256:169df107…ba4a`）
逐条实证后分类处置。扫描发生在修复落地前，部分行号为陈旧位置。

## 已修复（代码变更）

| Finding | 修复 |
|---|---|
| `app/api/scripts/run/route.ts:40,46` 不可信命令参数向量（**真实 RCE 面**） | 端点改为按脚本**名称**执行本地注册表（`.omp/scripts.json` + 全局）中的脚本；请求体不再携带可执行文本。执行用常量字面量 shell 二进制 + 固定字面量 argv（`/bin/sh -c <snippet>` / `cmd.exe /d /s /c <snippet>`），`shell:false`。调用方 `SessionSidebar.runScript` 同步改为发 `name`。 |
| `lib/npm-update.ts:113` 不可信命令参数向量 | 拆分支为字面量程序 + 字面量 argv（`bun add -g` / `npm install -g --force`），method 枚举校验，外部字符串不再触达 execFile。 |
| `app/api/files/[...path]/route.ts:210` 路径穿越 | 上游 `validateUploadFileNames` 已禁分隔符；sink 处补 `path.resolve` + `startsWith(directory + sep)` 显式边界（纵深防御）。 |
| `bin/omp-web-desktop.js:151` 命令选项注入 | codesign argv 增加 `--` 选项终止符（已实测 codesign 支持），并加 HOME 边界断言。 |
| `bin/process-lifecycle.js:18`（scan 报 bin/*.js:99,101 污点链） | taskkill argv 加 `Number.isInteger(pid) && pid > 0` 守卫；pid 为 OS 分配数值，本无外部输入。 |

## 实证为误报（保留代码，证据如下）

| Finding | 反证 |
|---|---|
| `streamFile` ×5 command-injection（route.ts:475-503） | `streamFile` → `createFileBodyStream` → `fs.createReadStream`，全程无任何子进程/eval；每次调用前均过 `isExistingFilePathAllowed` allow-list（route.ts:462）。扫描器把"函数消费请求输入"误标为 exec sink。 |
| `proxy.ts:110` → `isValidWebSession` command-injection | `lib/web-auth.ts:29-39`：正则约束 + `createHmac("sha256")` + timing-safe equal，纯密码学比较，无 exec。 |
| `lib/omp/archive.ts:164` 路径穿越 | `normalizeArchiveKey`（archive.ts:30-37）拒绝绝对路径/`\`/`..`，且强制 `.jsonl.gz` 后缀；resolve 后 :168 有 `startsWith(archiveBase + sep)` 双重边界。 |

## 中危（4）——跨文件污点，待 W1+ 处置

1. `desktop/main.js:202` 环境变量 → TerminalPanel SSRF 面（terminal/代理配置链路）。
2-3. `lib/terminal-session-manager.ts:161,184` 环境变量 → tunnel route 命令执行（cloudflared 启动，配置来源）。
4. （scan totals 含 4 medium，余为同类 env→exec 链）

处置：这些是 4.x 既有配置面（代理 URL、cloudflared 路径），登记为 **W1 security slice 输入**（05 文档 4.x 止血切片 3 的"反向代理 allowlist"工作项），随 Remote 波次一起治理，不在本轮盲改。

## 结论

- 真实高危：**1 类**（scripts/run RCE 面），已结构性修复并通过写入扫描。
- 其余高危：实证误报（3 类）或已加纵深防御（2 类）。
- 遗留：中危 4 项移交 W1；密封扫描 `verdictEffect: none`，属咨询性质。

## 复扫验证（修复后，scan-2026-08-30T08-04-58.363Z-d4cd04fff2fe，seal sha256:c8502c17…06e1）

- findings：18 → **13**（high 14→9、medium 4→4）。
- **已消除（5 高危，均为真实修复）**：scripts/run 不可信命令参数 ×2（RCE 面结构性修复）、npm-update execFile ×1、files 上传路径穿越 ×1、desktop codesign 选项注入 ×1。
- **剩余 9 高危全部为已实证误报**：streamFile ×5（纯 fs 读流 + allow-list，无 exec）、isValidWebSession ×1（纯 HMAC）、archive 路径穿越 ×1（normalizeArchiveKey + resolve/startsWith 双重边界）、wireChildProcessLifecycle ×2（taskkill 的 PID 为 OS 数值 + Number.isInteger 守卫）。
- 剩余 4 中危（env→tunnel/SSRF 链）维持移交 Remote 波次治理。
- 扫描器 sink 模型把"消费请求输入的纯 fs/密码学函数"标记为 command-injection 入口，属工具已知局限；书面反证见上表，如需清零须等 Mimosa 的 business-logic verdict 政策接入。

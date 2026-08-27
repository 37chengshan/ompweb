# ompweb

[English](./README.md) | [日本語](./README.ja.md)

社区：[加入 OMPWEB Discord](https://discord.gg/evqgGzRfM5)

[oh-my-pi (omp) 编程智能体](https://github.com/can1357/oh-my-pi)的本地 Web UI。ompweb 读取本机的 omp 会话文件，在浏览器中提供一个工作区，支持会话浏览、实时对话、模型配置、技能管理和项目文件预览。

![ompweb — 演示](docs/demo.gif)

<details>
<summary>截图（浅色 / 深色主题）</summary>

![ompweb — 浅色主题](docs/screenshot-light.png)

![ompweb — 深色主题](docs/screenshot-dark.png)

</details>

## 🌟 相比上游仓库的优化与增强 (Enhancements over Upstream)

本仓库（[37chengshan/ompweb](https://github.com/37chengshan/ompweb)）在原版（[kahme247/ompweb](https://github.com/kahme247/ompweb)）基础上进行了原生能力集成、架构升级与全方位的多维度性能调优：

- **🤖 原生集成内置 Agent MCP 编排引擎**：
  - 完整内嵌 `agent-mcp`（v3.0.0 by 37chengshan），纯标准库零外部运行时依赖分发；
  - 提供多智能体统一编排基础设施：支持 11+ 款 Agent CLI 统一调度、子任务派发、DAG 依赖图编排、复杂度分级门、实时插话与持久记忆银行；
  - 自带预设 [.omp/mcp.json](file:///Users/cc/code/ompweb/.omp/mcp.json) 与 [.omp/skills/agent-mcp/](file:///Users/cc/code/ompweb/.omp/skills/agent-mcp/)，用户安装开箱即用。
- **⚙️ 全新重构的 MCP 管理器与可视化表单**：
  - **可视化表单 + 快捷模板 + JSON 双模式**：支持直接填写传输协议、命令/URL、参数、启用开关，并提供 `Python stdio`、`NPX stdio`、`Remote HTTP` 一键模板；
  - **支持全局与项目级配置自由切换**：无缝写入 `~/.omp/agent/mcp.json` 或项目工作区；
  - **多源自动发现手风琴与实时搜索**：将跨客户端（Claude Code、Codex、Cursor、Cline 等）发现的 50+ 个服务端按来源折叠归拢，彻底解决卡片溢出和遮挡管理界面的问题。
- **⚡ 多维度前端 UI 与渲染性能极致优化**：
  - **流式 Markdown 增量绕过**：Token 流式吐词阶段跳过全文 Math 正则扫描与 AST 频繁重构，仅在最终消息提交时执行一次，实现丝滑的 60fps 流式体验；
  - **LRU 内存缓存加速**：为 Unified Diff 解析（`parseUnifiedPatch`，20条）与公式标准化（`normalizeDisplayMath`，200条）添加 LRU 缓存，回看与滚动重渲染零计算；
  - **视口与大文本安全截断**：补丁分栏对比设置 800 行上限保护，超长思考与 ToolResult 设置 100KB 防雪崩，防止极端大日志拖死浏览器；
  - **组件细粒度 Memo 包装**：`PlanPanel`、`MessageView` 等核心看板组件全面 memo 化，消除不必要的级联重渲染。
- **🛡️ 后端 Node.js / RPC 进程与内存安全防御**：
  - **Git 根目录内存持久缓存 + 并发去重**：5 分钟 TTL + In-flight Promise 合并，避免多会话并行解析时的重复 `git rev-parse` 进程风暴；
  - **SSE 僵尸连接彻底清理**：会话终结或空闲销毁时主动广播 `session_destroyed` 事件并安全关闭 `ReadableStream`，杜绝文件描述符与内存泄漏；
  - **子进程 Dispose 熔断保护**：`RpcProcess.dispose()` 加入 Promise.race 熔断锁，杜绝僵死进程导致的 Promise 永久挂起；
  - **`deferThinking` 载荷瘦身**：彻底解构移除延迟加载的 thinking 字段，大幅减少历史会话加载时的网络与内存开销。
- **🚀 Agent MCP 存储高并发与无锁流式优化**：
  - SQLite 启用 `PRAGMA temp_store=MEMORY;` 与真正 autocommit 模式 (`isolation_level=None`)，消除隐式事务锁冲突，确保批量写入零延迟；
  - SSE 广播队列采用无锁原子引用置换，并在客户端断开时立即清空内存 buffer。

## 环境要求

- 已安装 [omp](https://github.com/can1357/oh-my-pi) 且在 `PATH` 中（或通过 `OMP_WEB_OMP_BIN` 指向其二进制文件）
- Node.js 22.19.0 或更高版本（`node --version`）

## 快速开始

**免安装直接运行：**

```bash
npx @kahme247/ompweb@latest
```

**或全局安装：**

```bash
npm install -g @kahme247/ompweb
ompweb
```

然后打开 [http://127.0.0.1:30177](http://127.0.0.1:30177)。服务器就绪后，CLI 会尝试自动打开浏览器。ompweb 默认监听 `127.0.0.1`。

**选项：**

```bash
ompweb --port 8080              # 自定义端口
ompweb --hostname 0.0.0.0       # 在可信网络中暴露服务
ompweb -p 8080 -H 0.0.0.0       # 组合使用
ompweb --no-open                # 不自动打开浏览器

ompweb --password "a-long-random-password" # 启用仅密码登录（Windows 同样适用）

PORT=8080 ompweb                # 也支持环境变量
OMP_WEB_HOSTNAME=0.0.0.0 ompweb # 显式暴露到网络
OMP_WEB_PASSWORD='a-long-random-password' ompweb # 环境变量形式（POSIX）
# Windows: $env:OMP_WEB_PASSWORD="secret"; ompweb
OMP_WEB_NO_OPEN=1 ompweb        # 作为后台服务运行时很有用
```

设置 `OMP_WEB_PASSWORD` 可通过与主题集成的仅密码登录页面保护界面和所有 API 端点。登录成功后，会创建有效期为 30 天的 HTTP-only 签名会话 Cookie；留空则关闭认证。远程访问仍需通过受信任反向代理或 VPN 提供 HTTPS，以保护密码和会话 Cookie。默认仅监听 `127.0.0.1`；不要将 ompweb 直接暴露到互联网。

## 功能特性

- **随时接续之前的工作**：按项目浏览以往的 omp 对话，不必翻找终端历史或会话文件路径。
- **放心尝试不同方向**：从更早的消息继续，或将会话分叉为一条独立路线。
- **整理侧边栏**：归档不活跃会话而不删除原生记录，或在不再需要时明确删除。
- **跨分支工作**：在侧边栏切换 Git 工作树，新会话和资源管理器都会跟随你选择的检出。
- **边看项目边聊天**：左侧浏览文件，右侧预览源码、文档、图片、音频和 PDF，同时智能体继续工作。
- **清晰掌握会话状态**：上下文用量、费用、压缩上下文状态和系统提示词详情都显示在顶栏。
- **减少对终端配置的依赖**：在 Web UI 中管理模型、登录/API 密钥、模型测试、原生 OMP 控制（顾问、审批、Bash 策略、思考、压缩、记忆、自动学习、重试/回退）、技能、插件和项目 MCP 服务器。
- **在设置中管理 MCP**：专用 MCP 标签页显示项目服务器状态（已启用 / 已禁用 / 无效），支持添加、编辑、重命名、校验和删除，并通过角落提示显示配置失败。
- **保持 OMP 为最新版本**：可在设置中检查已安装运行时、更新它，并按需重启活动会话。
- **及时获知完成状态**：可选择在智能体完成时接收浏览器通知，并检查已安装技能的更新。
- **⌘K 随处跳转**：命令面板（⌘K / Ctrl+K）支持切换会话、新建会话和切换主题。
- **温暖的纸感设计**：浅色/深色双主题，衬线展示字体，对比度经 WCAG AA 验证，基于令牌驱动的 UI 套件（Base UI 基元、cmdk、lucide 图标）构建。

## 配置

| 变量 | 含义 |
| --- | --- |
| `PORT` | 服务器端口（默认 `30177`；`-p/--port` 优先） |
| `OMP_WEB_HOSTNAME` | 绑定主机名（默认 `127.0.0.1`；`-H/--hostname` 优先） |
| `OMP_WEB_PASSWORD` | 登录页面使用的可选密码 |
| `OMP_WEB_NO_OPEN` | 设为 `1`/`true` 可跳过自动打开浏览器 |
| `OMP_WEB_OMP_BIN` | `omp` 不在 `PATH` 中时，指向其二进制文件的绝对路径 |
| `PI_CODING_AGENT_DIR` | 指向其他 omp agent 目录（默认 `~/.omp/agent`） |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | 服务器端请求使用的标准代理变量 |

## 架构

ompweb 是一个由 Node 托管的 Next.js 应用，驱动你已安装的 `omp` 二进制文件——它并不内嵌智能体：

- **实时会话**：启动 `omp --mode rpc-ui`（基于 stdio 的 NDJSON），每个活动会话对应一个子进程，因此智能体版本始终与你安装的完全一致。
- **会话浏览**：直接读取 omp 的会话文件（`~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`）；标题、归档和删除是受保护的原生文件维护操作，不会与 OMP 的实时写入竞争。
- **模型与认证**：通过 RPC 命令与 omp 子进程交互；模型面板编辑 omp agent 目录中的 `models.yml`。
- **技能与插件**：扫描 omp 的技能目录（`~/.omp/agent/skills`、项目内 `.omp/skills` 及兼容目录），并调用 `omp plugin` 进行插件管理。
- **文件访问**：文件浏览与预览仅限于所选项目目录以及会话中出现过的工作目录。
- **分叉与会话内分支**：分叉会创建新的 `.jsonl` 文件；“从此处编辑”则在同一会话文件内创建另一个分支。

## 开发

```bash
npm install
npm run dev
```

本地开发服务器运行在 [http://127.0.0.1:30177](http://127.0.0.1:30177)。

常用检查：

```bash
npx tsc --noEmit       # 类型检查
npm run lint           # ESLint（零警告）
node --test lib/*.test.mjs components/*.test.mjs   # 运行测试
```

本地开发时请避免运行 `next build` / `npm run build`。它会写入 `.next/`，可能干扰开发服务器；构建请留到发布阶段。

## 多语言支持

ompweb 支持英语、简体中文和日本語，三种语言均覆盖整个界面的翻译字符串。语言从 `navigator.language` 自动检测，可通过顶栏的语言菜单在运行时切换。选择会跨会话持久化。

- 字典文件：`lib/i18n/locales/{en,zh-CN,ja}.json`
- 框架：`lib/i18n/index.tsx` — 基于 `useSyncExternalStore` 的轻量 store，支持 `{var}` 插值和复数形式（`.one`/`.other`）
- API 错误消息通过稳定的错误码（`errors.<code>`）在客户端翻译

## 质量

- **可访问性**：符合 WCAG AA 标准 — Lighthouse 可访问性评分 100/100，全键盘导航，焦点可见环，ARIA 角色
- **性能**：列表组件 memo 化、RAF 节流滚动/鼠标处理、防抖搜索、流式 JSONL 读取器、ETag 缓存会话列表
- **健壮性**：优雅关闭 omp 子进程（进程组杀死）、错误边界、原子化会话文件重写
- **测试**：聚焦的测试套件覆盖会话解析、终端输入、Markdown 渲染、消息展示、原生设置和 MCP 配置

## 致谢

ompweb 分叉自 [agegr/pi-web](https://github.com/agegr/pi-web)（MIT）——[badlogic/pi-mono](https://github.com/badlogic/pi-mono) pi 编程智能体的 Web UI，并针对 [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) 进行了适配。

## 许可证

MIT

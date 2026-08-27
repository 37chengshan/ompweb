# ompweb

[English](./README.md) | [日本語](./README.ja.md)

社区：[加入 OMPWEB Discord](https://discord.gg/evqgGzRfM5)

[oh-my-pi (omp) 编程智能体](https://github.com/can1357/oh-my-pi)的本地 Web UI。ompweb 读取本机的 omp 会话文件，在浏览器中提供一个工作区，支持会话浏览、实时对话、模型配置、技能管理和项目文件预览。

![ompweb — 演示](docs/demo.gif)

<d## 🌟 相比上游仓库的优化与增强 (Optimizations & Enhancements)

本仓库（[37chengshan/ompweb](https://github.com/37chengshan/ompweb)）是基于 [kahme247/ompweb](https://github.com/kahme247/ompweb) 的功能增强与深度调优版本。基于实际代码实现，包含了以下关键特性新增、架构升级与性能优化：

### 1. 🖥️ 内置交互式 Web 终端 (Interactive Web Terminal)
- **真 PTY 伪终端支持 (`app/api/terminal/route.ts`, `components/EmbeddedTerminal.tsx`)**：利用 `python3 -c "import pty; pty.spawn(...)"` 生成原生 PTY，支持 ANSI 全彩高亮解析、双向 SSE 流式传输、有序输入序列化与终端窗口动态缩放（`cols`/`rows`）。
- **底部可停靠面板**：直接在 Web 界面执行 Git 命令、调试脚本和运行测试，自带超时会话自动回收与环形缓冲区溢出保护。

### 2. 📂 系统原生文件管理器联动与工作区排序 (File Explorer & Workspace Alias)
- **常驻「在文件管理器中显示」快捷键 (`components/FileExplorer.tsx`, `app/api/files/open/route.ts`)**：工作区卡片与文件树节点提供常驻快捷按钮（无需 hover 悬停），跨平台调用系统原生文件管理器（macOS `open`、Windows `explorer.exe`、Linux `xdg-open`）。
- **工作区别名与自定义排序 (`lib/project-registry.ts`, `lib/project-ordering.ts`)**：支持为工作区设置显示别名（Alias）并在侧边栏持久化自定义排序，不破坏磁盘目录结构。

### 3. 🎨 视觉主题工作室与无障碍动效控制 (Theme Studio & Motion Controls)
- **主题调色工作室 (`components/ThemeStudio.tsx`, `hooks/useTheme.ts`)**：支持自定义纸感/余烬设计系统 Token，所有色彩均通过 WCAG AA 对比度验证，提供浅色/深色/跟随系统一键轮转与个性化强调色调节。
- **动效无障碍支持 (`hooks/useMotionPrefs.ts`)**：自动适配系统 `prefers-reduced-motion` 偏好，立即禁用耗性能的 SVG SMIL 动效并将平滑滚动转换为瞬时跳跃，保障低配设备流畅度。

### 4. 🧭 计划模式看板与压缩前历史追溯 (Plan Mode & History Traceability)
- **交互式计划看板 (`components/PlanPanel.tsx`, `lib/plan-reader.ts`)**：实时同步并渲染 `<session>/local/*-plan.md` 计划草稿，支持一键执行计划与弹窗提交结构化修改意见（`onRejectPlan`）。
- **压缩前历史追溯 (`lib/session-reader.ts`)**：允许用户在顶栏展开浏览上下文压缩前的全部原始历史记录，不污染当前活跃上下文。

### 5. ⚡ 前端渲染引擎与视口安全防御 (UI & React Rendering)
- **流式 Markdown 增量绕过 (`components/MarkdownBody.tsx`)**：Token 流式输出期间跳过全文公式正则扫描（`normalizeDisplayMath`）与 KaTeX 插件动态加载，仅在消息提交时执行一次 AST 构建，保持 60fps 丝滑渲染。
- **内存级 LRU 缓存加速 (`lib/markdown.ts`, `lib/patch.ts`)**：公式标准化内置 200 条容量 LRU 缓存，Unified Diff 解析内置 20 条容量 LRU 缓存（`patchCache`），消除重复计算。
- **DOM 防雪崩与极端输出截断保护 (`components/MessageView.tsx`)**：Git Diff 视图设置 800 行硬上限（`MAX_ROWS = 800`），超长思考与 ToolResult 设置 100KB 防崩保护。
- **组件细粒度 Memo 包装 (`components/PlanPanel.tsx`, `components/MessageView.tsx`)**：`React.memo` 阻断非必要级联重渲染。

### 6. 🛡️ 后端 Node.js、RPC 进程与文件 I/O 加固 (Backend & Process Safety)
- **Git 根目录内存持久缓存 + 并发去重 (`lib/worktree.ts`)**：延长 `PROJECT_CACHE_TTL_MS` 至 5 分钟，加入 `__piProjectPendingCache` 全局 Map 合并并行 Promise，杜绝重复 `git rev-parse` 进程风暴。
- **SSE 僵尸连接彻底清理 (`app/api/agent/[id]/events/route.ts`, `lib/rpc-manager.ts`)**：会话终结或销毁时主动派发 `session_destroyed` 事件并安全关闭 `ReadableStream`，杜绝文件描述符与内存泄漏。
- **子进程 Dispose 熔断保护 (`lib/omp/rpc-process.ts`)**：`RpcProcess.dispose()` 加入 `Promise.race` 熔断锁防止僵死进程挂起，`crlfDelay: Infinity` 标准化流式行解析。
- **`deferThinking` 载荷瘦身 (`lib/session-reader.ts`, `lib/types.ts`)**：在延迟加载模式下直接从 JSON 结构中解构移除 thinking 字段，显著降低网络传输体积。

### 7. ⚙️ MCP 管理器体验重构与内置 Agent MCP
- **双模式可视化表单编辑器 (`components/McpConfig.tsx`)**：提供「可视化表单（协议、命令/URL、参数、启用开关）」与「JSON 代码」双模式，内置 `Python stdio`、`NPX stdio`、`Remote HTTP` 一键模板，支持项目与全局（`~/.omp/agent/mcp.json`）配置自由切换。
- **多源分类折叠手风琴 (`components/McpConfig.tsx`)**：对跨客户端自动发现的 50+ 个服务端按来源折叠并支持实时搜索。
- **内置 Agent MCP 预设与微调 (`vendor/agent-mcp/`)**：自带多 Agent 编排工具库，配合 SQLite 高并发优化（`PRAGMA temp_store=MEMORY`、autocommit 事务无锁化）、SSE 广播队列无锁化原子置换与指数退避等待算法。

## 环境要求�会话终结或销毁时主动派发 `session_destroyed` 事件，SSE 流监听到后立即关闭 `ReadableStream` 并注销监听器，杜绝文件描述符与内存泄漏。
- **子进程 Dispose 熔断保护 (`lib/omp/rpc-process.ts`)**：在 `RpcProcess.dispose()` 中加入 `Promise.race` 熔断定时器，即使操作系统偶发未能回收僵死进程，也能安全 resolve，防止 Promise 永久挂起；以 `crlfDelay: Infinity` 标准化流式行解析。
- **原子文件操作异常清理 (`lib/omp/mcp-config.ts`)**：在原子写入中使用 `try ... finally { try { unlinkSync(temp); } catch {} }`，防止异常时残留 `.tmp-*` 孤儿文件。
- **`deferThinking` 载荷瘦身 (`lib/session-reader.ts`, `lib/types.ts`)**：将 `ThinkingContent.thinking` 改为可选字段，在延迟加载模式下直接从 JSON 结构中解构移除该 key 而非返回空字符串，显著降低会话上下文网络传输开销。

### 3. ⚙️ MCP 管理器重构与内置 Agent MCP
- **双模式可视化表单编辑器 (`components/McpConfig.tsx`)**：提供「可视化表单（协议、命令/URL、参数、启用开关）」与「JSON 代码」双模式，内置 `Python stdio`、`NPX stdio`、`Remote HTTP` 一键模板，并支持在项目与全局配置（`~/.omp/agent/mcp.json`）之间无缝切换。
- **多源分类折叠手风琴 (`components/McpConfig.tsx`)**：对跨客户端自动发现的 50+ 个服务端按来源折叠并支持实时搜索，彻底解决卡片溢出和遮挡问题。
- **内置 Agent MCP 编排引擎**：内嵌 `agent-mcp` (v3.0.0) 预设与工具，配合 SQLite 高并发优化（`PRAGMA temp_store=MEMORY`、`isolation_level=None` autocommit 事务无锁化）、SSE 广播队列无锁化原子引用置换与指数退避等待算法。

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

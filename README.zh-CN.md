# ompweb

[English](./README.md) | [简体中文](./README.zh-CN.md) | [日本語](./README.ja.md)

社区：[加入 OMPWEB Discord](https://discord.gg/evqgGzRfM5)

[oh-my-pi (omp) 编程智能体](https://github.com/can1357/oh-my-pi)的本地 Web UI。ompweb 读取本机的 omp 会话文件，在浏览器中提供一个工作区，支持会话浏览、实时对话、模型配置、技能管理和项目文件预览。

![ompweb — 演示](docs/demo.gif)

<details>
<summary>界面截图 (浅色 / 深色)</summary>

![ompweb — 浅色主题](docs/screenshot-light.png)

![ompweb — 深色主题](docs/screenshot-dark.png)

</details>

## 🌟 相比上游仓库的优化与增强 (Optimizations & Enhancements)

本仓库（[37chengshan/ompweb](https://github.com/37chengshan/ompweb)）是基于 [kahme247/ompweb](https://github.com/kahme247/ompweb) 的功能增强与深度调优版本。基于代码库的真实实现，包含了以下关键特性新增、架构升级与性能优化：

### 1. 🖥️ 内置交互式 Web PTY 终端 (Interactive Web PTY Terminal)
- **真 PTY 伪终端分配 (`lib/terminal-session-manager.ts`, `components/TerminalPanel.tsx`, `app/api/terminal/*`)**：在 macOS 上采用 `python3 -c "import pty,sys; pty.spawn(...)" /bin/zsh -i`，在 Linux 上采用 `script -qfc` 分配原生 PTY 伪设备，支持完整的 ANSI 256/TrueColor 高亮解析、交互式行编辑、光标移动及实时 zsh/bash 回显。
- **生命周期自动回收与实例上限**：无活动 30 分钟（30min TTL）自动回收销毁后台 shell 进程，全局限制最多 8 个并发终端会话，防止孤儿进程累积。
- **内存安全与按键防乱序**：历史输出缓冲区采用字节容量硬上限（`MAX_HISTORY_BYTES = 1MB`）而非单纯限制行数；前端按键输入引入串行化队列与 5 秒超时中止信号（AbortSignal），彻底解决高速连击下的按键乱序问题。

### 2. 📂 系统原生文件管理器一键定位 (System File Manager Reveal)
- **常驻「在文件管理器中显示」快捷键 (`app/api/reveal/route.ts`, `components/FileExplorer.tsx`, `components/SessionSidebar.tsx`)**：工作区卡片与文件树节点提供常驻快捷按钮（无需 hover 悬停），跨平台调用系统原生文件管理器（macOS 区分目录 `open <dir>` 与文件 `open -R <file>`，Windows `explorer /select,`，Linux `xdg-open`）。
- **安全白名单与防挂起熔断**：路径受 `getAllowedFileRoots()` 严格校验防止越权逃逸，执行调用附加 8 秒超时熔断（`timeout: 8000`），避免桌面管理器卡死导致请求阻塞。

### 3. 🎨 视觉主题工作室与排版动效定制 (Theme Studio & Motion Controls)
- **多达 18+ 预设主题 (`components/ThemePicker.tsx`, `hooks/useTheme.ts`)**：提供经典纸墨、余烬暗黑、Nord、Oatmeal、Matcha、OLED 纯黑、Sepia、Dracula、Pine、Navy 以及 6 种流体动态流动渐变主题（`aurora-flow`、`dawn-flow`、`cosmic-flow`、`ocean-flow`、`sakura-flow`、`bamboo-flow`），并支持完全自定义色彩取色。
- **排版定制与动效无障碍 (`hooks/useTypography.ts`, `hooks/useMotionPrefs.ts`)**：支持自定义字体族、字号缩放比例和行高；自动联动操作系统 `prefers-reduced-motion` 偏好，即时禁用耗性能的 SVG SMIL 动效并将平滑滚动转为瞬时跳转。

### 4. 🧭 计划模式看板与历史追溯 (Plan Mode Kanban & History)
- **交互式计划看板 (`components/PlanPanel.tsx`, `lib/plan-reader.ts`, `app/api/sessions/[id]/plan/route.ts`)**：实时同步并渲染 `<session>/local/*-plan.md` 计划成果，采用 `StringDecoder` 对前 256KB 实行字符安全边界切片读取，避免在 Node 内存中加载巨型文件。
- **会话切换状态隔离**：切换会话时自动重置 `planInfo`，杜绝跨会话计划数据残留。

### 5. ⚡ 前端渲染性能极致调优 (UI & Rendering Performance)
- **流式 Markdown 增量旁路 (`components/MarkdownBody.tsx`)**：Token 流式输出期间跳过全文公式正则扫描（`normalizeDisplayMath`）与 KaTeX 插件动态加载，待消息提交后一次性解析，保持 60fps 丝滑输出。
- **数学公式正规化 LRU 缓存 (`lib/markdown.ts`)**：为 `normalizeDisplayMath` 引入 200 容量 LRU 缓存，已提交历史消息在切换主题或滚动时 $O(1)$ 命中，消除重复正则扫描。
- **细粒度 `MessageView` Memo 比对 (`components/MessageView.tsx`)**：通过 `haveSameRelevantToolResults` 仅在消息内部包含的 `toolCallId` 发生变动时触发单条消息重渲染，避免 Agent 执行工具时触发全局重渲染。
- **超大消息渲染熔断保护 (`components/MessageView.tsx`)**：超过 100,000 字符的巨型输出自动折叠为轻量虚拟化纯文本视图（`SafeMarkdownBody`），杜绝 React AST 解析导致的主线程崩溃。
- **Unified Diff LRU 缓存 (`lib/patch.ts`)**：Diff 解析内置 20 容量 LRU 缓存，避免重复行计算。
- **自适应 TPS 采样退避算法 (`hooks/useAgentSession.ts`)**：在模型处于深度思考或耗时工具调用时，自动将 `tokensPerSecond` 轮询间隔从 2 秒退避至 4 秒，Token 恢复输出时即刻回弹至 2 秒，显著减轻服务端压力。

### 6. 🛡️ 后端并发与 RPC 内存安全加固 (Backend & RPC Hardening)
- **Git Worktree 飞行中 Promise 聚合去重 (`lib/worktree.ts`)**：通过 `__piProjectPendingCache` 将并发发生的同一目录 `resolveProject` 请求合并为一个真实 Git 进程，并享有 5 分钟 TTL 缓存。
- **会话列表加载并发限制与 LRU 缓存 (`lib/session-reader.ts`)**：`loadAllSessions` 使用 `CONCURRENCY = 6` 批处理并发限制；`loadSessionEntriesCached` 提供 32 容量的 `(size, mtimeMs)` 校验缓存。
- **Task 工具遥测数据裁剪 (`lib/session-reader.ts`)**：`keepTaskToolResultDetails` 将日志文本截断至 240 字符并最多保留 50 行，彻底解决历史会话 JSON 传输膨胀导致的 Node 堆内存溢出。
- **RPC 子进程销毁防假死超时熔断 (`lib/omp/rpc-process.ts`)**：在 `RpcProcess.dispose()` 中新增 `failsafe` 超时竞争，防止操作系统僵死进程挂起销毁流程。
- **原子 MCP 配置文件操作 (`lib/omp/mcp-config.ts`)**：临时文件写入流程附带 `try...finally` 垃圾清理，支持全局用户配置（`~/.omp/agent/mcp.json`）。

### 7. ⚙️ MCP 管理器重构与内置 Agent MCP
- **双模式可视化表单编辑器 (`components/McpConfig.ts- **减少对终端配置的依赖**：在 Web UI 中管理模型、登录/API 密钥、模型测试、任务智能体、原生 OMP 控制（顾问、审批、Bash 策略、思考、压缩、记忆、自动学习、重试/回退）、技能（搜索、安装、更新检查）、插件以及项目/全局 MCP 服务器。
- **在设置中管理 MCP**：专用 MCP 标签页显示项目与全局服务器状态（已启用 / 已禁用 / 无效），支持添加、编辑、重命名、校验和删除，并通过角落提示显示配置失败。
- **丰富的斜杠命令**：`/goal`, `/plan`, `/terminal`, `/theme`, `/mcp`, `/review`, `/fix`, `/test`, `/explain`, `/simplify`, `/commit`, `/advisor` 扩展为结构化 Prompt；omp 自身的命令（技能、`/compact` 等）通过 `available_commands_update` 自动同步。
- **保持 OMP 为最新版本**：可在设置中检查已安装运行时、更新它，并按需重启活动会话。
- **及时获知完成状态**：可选择在智能体完成时接收浏览器通知，播放完成音效，并检查已安装技能的更新。
- **⌘K 随处跳转**：命令面板（⌘K / Ctrl+K）支持切换会话、新建会话和切换主题。
- **温暖的纸感设计**：18+ 款浅色/深色主题，衬线展示字体，对比度经 WCAG AA 验证，基于 Base UI 基元、cmdk 与 lucide 图标构建。

## 配置

| 变量 | 含义 |
| --- | --- |
| `PORT` | 服务器端口（默认 `30177`；`-p/--port` 优先） |
| `OMP_WEB_HOSTNAME` | 绑定主机名（默认 `127.0.0.1`；`-H/--hostname` 优先） |
| `OMP_WEB_PASSWORD` / `--password` | 登录页面使用的密码；`--password` 适用于所有终端环境 |
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
- **MCP 服务器**：通过 OMP 原生位置（`.omp/mcp.json`、`~/.omp/agent/mcp.json`）管理项目与全局服务器，严格校验协议并原子写入。
- **文件访问**：文件浏览与预览仅限于所选项目目录以及会话中出现过的工作目录。
- **分叉与会话内分支**：分叉会创建新的 `.jsonl` 文件；“从此处编辑”则在同一会话文件内创建另一个分支。

## 开发

```bash
npm install
npm run dev
```

本地开发服务器运行在 [http://127.0.0.1:30178](http://127.0.0.1:30178)。

常用检查：

```bash
npm run typecheck      # TypeScript 类型检查 (tsc --noEmit)
npm run lint           # ESLint（零警告）
npm test               # 运行原生 Node.js 测试套件
npm run build          # 生产构建
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

ompweb 分叉自 [agegr/pi-web](https://github.com/agegr/pi-web)（MIT）——[earendil/pi-mono](https://github.com/earendil-works/pi) pi 编程智能体的 Web UI，并针对 [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) 进行了适配。

## 许可证

MIT��过受信任反向代理或 VPN 提供 HTTPS，以保护密码和会话 Cookie。默认仅监听 `127.0.0.1`；不要将 ompweb 直接暴露到互联网。

### 安全与故障排查

- 服务器默认仅绑定 `127.0.0.1`。非环回地址属于显式选择，仅可在可信网络边界内使用；ompweb 不适合直接向公网暴露。
- 文件 API 严格限制在所选工作区、有效 Git 工作树、会话引用的目录以及显式选择的根目录。路径会经过规范化处理，杜绝路径穿越和符号链接逃逸。
- 优先从 `OMP_WEB_OMP_BIN` 解析 `omp`，其次从 `PATH` 解析。如果无法启动实时对话，请在相同终端运行 `omp --version` 或设置绝对路径。
- 会话历史保留原生的 OMP JSONL 格式。OMP 拥有实时会话的写入权；ompweb 直接读取文件，仅在不与实时写入冲突时执行显式标题、归档和删除操作。
- 会话归档采用 OMP 原生的 `archive/sessions/<cwd>/<file>.jsonl.gz` 布局，并将附属产物与记录一同移动；原始 JSONL 完整保存在 gzip 内。

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

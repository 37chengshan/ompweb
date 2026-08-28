# ompweb

<p align="center">
  <img src="public/icon.png" width="96" height="96" alt="ompweb logo" />
</p>

<p align="center">
  <strong>专为 <a href="https://github.com/can1357/oh-my-pi">oh-my-pi (omp)</a> 打造的现代化、高性能、本地优先的 Web 工作区与原生桌面应用</strong>
</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">简体中文</a> | <a href="./README.ja.md">日本語</a> | <a href="https://discord.gg/evqgGzRfM5">Discord 社区</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.19.0-brightgreen.svg" alt="Node.js version" />
  <img src="https://img.shields.io/badge/Next.js-16.3-black.svg" alt="Next.js version" />
  <img src="https://img.shields.io/badge/Electron-44.0-blue.svg" alt="Electron version" />
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License" />
</p>

---

## 📖 项目简介

**ompweb** 是 [oh-my-pi (omp)](https://github.com/can1357/oh-my-pi) AI 编程智能体的全功能图形化工作台与原生桌面客户端。

它以**本地优先（Local-first）**为核心设计理念，无缝接入你本地现有的 omp 运行时（直接读取 `~/.omp/agent/sessions/` 会话历史）。通过提供直观现代的图形界面，ompweb 将 AI 编程体验从单一的命令行终端拓展为一个支持**多会话分支管理**、**实时多智能体协同**、**全功能交互式 Web PTY 终端**、**可视化 MCP 与技能生态管理**、**代码与富媒体协同浏览**、**Git 多工作树切换**的强大集成开发环境。

![ompweb 演示动图](docs/demo.gif)

<details>
<summary>📸 查看界面截图（浅色 / 深色双主题）</summary>

| 浅色模式 (Light Theme) | 深色模式 (Dark Theme) |
| :---: | :---: |
| ![ompweb 浅色模式](docs/screenshot-light.png) | ![ompweb 深色模式](docs/screenshot-dark.png) |

</details>

---

## ⚡ 快速开始

ompweb 提供灵活多样的启动方式，无论是浏览器 Web 模式、独立的桌面原生应用，还是源码本地运行，均可开箱即用。

### 方式一：Web 模式启动

#### 1. 免安装即开即用（最快体验）

只要你的电脑安装了 Node.js (>= 22.19.0) 与 [omp](https://github.com/can1357/oh-my-pi)：

```bash
npx @37chengshan/ompweb@latest
```

服务启动后将监听 `http://127.0.0.1:30177` 并自动在系统默认浏览器中打开页面。

#### 2. 全局安装为系统 CLI 工具

```bash
# 全局安装
npm install -g @37chengshan/ompweb

# 随时在终端启动
ompweb
```

> 💡 **镜像源提示**：若使用 npmmirror 等国内镜像遇到新版本 `E404` 延迟，可指定官方 registry：
> ```bash
> npm install -g @37chengshan/ompweb --registry=https://registry.npmjs.org
> ```

#### 3. 常用启动参数与环境变量

```bash
ompweb --port 8080                        # 自定义监听端口
ompweb --hostname 0.0.0.0                 # 允许局域网受信任设备访问
ompweb --password "your-strong-password"  # 开启网页访问密码保护
ompweb --no-open                          # 启动后不自动唤起浏览器（适合远程服务器或后台服务）

# 亦支持通过环境变量传递参数：
PORT=8080 OMP_WEB_PASSWORD="your-strong-password" ompweb
```

---

### 方式二：下载桌面原生应用 (Desktop App)

ompweb 提供了由 Electron 封装的独立桌面客户端，具备系统托盘常驻、Dock 状态展示、独立的窗口生命周期管理以及启动动画。

#### 1. 直接下载安装包

前往 [GitHub Releases](https://github.com/37chengshan/ompweb/releases) 页面，下载对应系统的安装文件：
- **macOS**：`.dmg` 安装包（原生支持 Apple Silicon 及 Intel 架构）
- **Windows**：`.exe` 安装程序 (NSIS)
- **Linux**：`.AppImage` 单文件可执行包

#### 2. 本地构建桌面端安装包

```bash
# 1. 克隆代码仓库并安装依赖
git clone https://github.com/37chengshan/ompweb.git
cd ompweb
npm install

# 2. 启动桌面客户端开发预览
npm run desktop:start

# 3. 打包生成各平台独立安装包
npm run desktop:build      # 打包 macOS (.dmg)
npm run desktop:build:win  # 打包 Windows (.exe)
npm run desktop:build:all  # 同时打包所有平台 (macOS, Windows, Linux)
```

---

### 方式三：源码本地开发启动

```bash
git clone https://github.com/37chengshan/ompweb.git
cd ompweb
npm install
npm run dev
# 浏览器访问 http://127.0.0.1:30178
```

---

## 🌟 核心功能特性

### 1. 💬 智能会话管理与版本分支导航 (Session Hub & Branching)
- **多项目智能分类**：自动识别工作区项目根目录，按项目智能归集和展示会话历史。
- **会话内分支导航器 (Branch Navigator)**：支持在会话内部任意历史节点上自由切换与“从此处继续”，低成本探索不同的编码方案。
- **安全会话分叉 (Fork Session)**：可从任意用户提问节点将对话克隆为全新独立会话文件，不影响主干上下文。
- **原生 Gzip 归档与导出**：与 OMP 原生 `archive/sessions/<cwd>/<file>.jsonl.gz` 格式完全兼容，支持会话搜索、重命名、自动标题生成与单文件 HTML 导出。
- **全维度实时遥测**：实时统计当前会话的 Token 消耗、费用账单、运行耗时、上下文利用率（Context Gauge）及 omp 实时 TPS 输出速率。

### 2. 🖥️ 内置全功能交互式 Web PTY 终端 (Integrated PTY Terminal)
- **真实系统伪终端分配**：基于 `node-pty` 分配底层系统终端（macOS/Linux 下为交互式 `zsh`/`bash`，Windows 下为 `cmd.exe`），完整支持 ANSI 256/TrueColor 色彩渲染、光标定位、Tab 自动补全与实时回显。
- **安全队列与资源保护**：严格保证按键顺序的 FIFO 序列与 5 秒抢占超时防护；全局限制最大 8 个终端会话，闲置 30 分钟自动回收清理。

### 3. 🤖 多智能体协作与计划执行看板 (Multi-Agent & Plan Kanban)
- **输入附着式计划看板 (Todo Plan Panel)**：常驻于输入框上方，实时展示当前任务计划、子步骤清单与执行状态。
- **Subagent 实时监控**：子智能体卡片配备脉冲呼吸灯，动态展示子任务的工具调用、Token 用量、耗时与重试状态。
- **执行摘要与完整日志**：一键调出专属子智能体详情弹窗，查看最终产出摘要或逐字节分页审阅完整 Transcript。
- **内置 Agent-MCP 多智能体调度器**：原生集成 Python 多智能体调度守护进程，内置 `designer`、`librarian`、`reviewer`、`scout`、`security-reviewer`、`sonic`、`task` 等多领域角色智能体预设。

### 4. 📂 工作区协同与富媒体深度预览 (Workspace & Rich Media)
- **Git Worktrees 多分支切换**：侧边栏无缝切换 Git 工作树分支，文件树与会话上下文即时随之联动。
- **一键系统文件管理器定位**：支持在工作区或文件节点点击 “Reveal in Finder / Explorer / File Manager”，内置 8 秒超时保护与路径防逃逸校验。
- **多格式富媒体预览器**：左侧浏览代码文件树，右侧多标签页快速预览源代码（代码高亮与行号）、Markdown（KaTeX 数学公式、Mermaid 拓扑图）、PDF、DOCX、图片（支持灯箱放大缩放）及音视频资源。

### 5. ⚙️ 可视化 MCP 与技能生态 (Visual MCP & Skills Hub)
- **双模 MCP 管理器**：支持可视化表单与原始 JSON 双向切换，内置 Python stdio、NPX stdio、Remote HTTP、Brave Search、PostgreSQL、GitHub、Fetch 等常用模板。
- **技能市场与全网检索**：自动扫描项目及全局技能（`.omp/skills` 等），支持通过 `skills.sh` 检索全网技能并一键安装/更新。
- **插件管理**：直观查看、开启、禁用或升级已安装的 `omp plugin` 插件。

### 6. 🔑 模型矩阵与原生 OMP 配置 (Models & Native Settings)
- **可视化模型配置与连通性测试**：直接编辑 `~/.omp/agent/models.yml`，支持多 Provider 切换与模型一键连通性测试。
- **原生参数微调**：在界面设置中直接调整 Advisor 顾问策略、审批模式、Bash 执行策略、Thinking 思考深度、上下文压缩算法、记忆库与自动学习等。
- **快捷斜杠指令 (Slash Commands)**：内置 `/goal`、`/plan`、`/terminal`、`/theme`、`/mcp`、`/review`、`/fix`、`/test`、`/explain` 等丰富指令模板。

### 7. 🎨 主题工作室与无障碍美学 (Theme Studio & UX)
- **18+ 预设主题与调色板**：经典纸感（Warm Paper）、Ember Dark、Nord、OLED 纯黑、抹茶、Sepia、Dracula，以及 6 款带有流体背景动效的动态主题（Aurora、Dawn、Cosmic、Ocean、Sakura、Bamboo）。
- **字体与动效定制**：支持自定义字体族与字号缩放倍率，深度适配操作系统的 `prefers-reduced-motion` 减弱动效偏好。
- **⌘K 快速命令面板**：使用 `⌘K` / `Ctrl+K` 快速在项目、会话与系统功能间全局瞬移。
- **多语言国际化**：原生支持简体中文、English、日本語，全量文本覆盖且自动识别系统语言。

---

## 🏗️ 架构设计与安全性

```
┌────────────────────────────────────────────────────────┐
│               Browser / Desktop Window (Electron)      │
└───────────────────────────┬────────────────────────────┘
                            │ HTTP / SSE / WebSocket
┌───────────────────────────▼────────────────────────────┐
│              ompweb Server (Next.js on Node)           │
│  ├─ JSONL 会话流式解析与路径缓存 (lib/session-reader.ts)   │
│  ├─ Web PTY 终端会话管理器 (lib/terminal-session-manager)│
│  ├─ 文件安全沙箱与白名单校验 (lib/file-access.ts)           │
│  └─ RPC 进程生命周期调度 (lib/rpc-manager.ts)           │
└───────────────────────────┬────────────────────────────┘
                            │ NDJSON over stdio (RPC v1/v2)
┌───────────────────────────▼────────────────────────────┐
│           本地已安装的 omp CLI (`omp --mode rpc-ui`)     │
│  ├─ 真实的 AI 智能体执行内核与工具调用                     │
│  ├─ 凭证存储 (`agent.db`) 与模型路由                     │
│  └─ 会话文件写入 (`~/.omp/agent/sessions/`)             │
└────────────────────────────────────────────────────────┘
```

- **数据主权完全归属用户**：ompweb 不自建私有数据格式，不持久化敏感 API Key，所有对话与凭证均由已安装的 `omp` 二进制和 `~/.omp/agent/` 原生驱动。
- **默认本地回环绑定**：默认仅监听 `127.0.0.1`，杜绝未经授权的公网暴露风险。
- **安全密码认证**：配置 `OMP_WEB_PASSWORD` 后自动对所有前端页面及 API 开启 Signed Cookie 鉴权阻断。
- **严格的文件访问白名单**：文件预览与读取接口受到严格的路径规范化和真实路径（`realpath`）校验，彻底防止跨目录遍历与符号链接逃逸。

---

## 🛠️ 配置环境变量说明

| 变量名 | 说明 | 默认值 / 示例 |
| :--- | :--- | :--- |
| `PORT` / `-p` / `--port` | Web 服务监听端口 | `30177` |
| `OMP_WEB_HOSTNAME` / `-H` / `--hostname` | 监听主机地址 | `127.0.0.1` |
| `OMP_WEB_PASSWORD` / `--password` | Web 访问密码保护 | *(未设置即无需密码)* |
| `OMP_WEB_NO_OPEN` | 启动后是否跳过自动打开浏览器 | `0` (`1` 表示不自动打开) |
| `OMP_WEB_OMP_BIN` | 指定 `omp` 二进制可执行文件的绝对路径 | 自动从 `PATH` 环境变量中查找 |
| `PI_CODING_AGENT_DIR` | 指定 OMP 数据与配置存放根目录 | `~/.omp/agent` |
| `HTTP_PROXY` / `HTTPS_PROXY` | 后端请求所使用的代理配置 | *(根据系统网络环境指定)* |

---

## 🧑‍💻 本地开发与质量保证

```bash
npm run dev           # 启动开发服务器 (端口 30178)
npm run typecheck     # 执行 TypeScript 类型校验 (tsc --noEmit)
npm run lint          # 执行 ESLint 语法与规范检查
npm test              # 运行内置原生 Node.js 测试套件 (450+ 测试用例)
npm run release:check # 发布前全量自动化质量验收 (Typecheck + Lint + Test + Build)
```

---

## 📄 开源协议

本项目遵循 [MIT 许可证](./LICENSE)。

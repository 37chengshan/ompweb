# 09 — Desktop：Electron 到 Tauri 2 的保真迁移

## 目标

用 Tauri 2 薄壳替换 Electron + bundled Chromium + Node standalone server，同时保留全部 React UI、视觉风格、动画、平台能力和用户数据。迁移成功的定义是更小/更快且行为等价，不是“产生了一个 Tauri build”。

## 硬前置

Tauri 官方把 frontend 当静态资源，不原生支持当前 Next server/SSR 形态；Next 集成要求 `output: 'export'`。[Tauri Next.js guide](https://v2.tauri.app/start/frontend/nextjs/)

因此开始 default cutover 前必须满足：

- 06 的独立 Host Runtime 可用；
- 10 的 UI 已可静态构建，组件不直接依赖 Next server；
- 01 的统一 Client 支持 LocalHostAdapter/Tauri shell adapter；
- 12 的 UI、动画、性能基线已冻结；
- Electron 仍可构建和回滚。

## 目标架构

```text
Tauri Core Process
  ├─ window / tray / menu / deep link / updater / file dialogs
  ├─ minimal capability allowlist
  └─ connects to user-scoped ompweb-host

System WebView
  └─ static React client → OmpwebClient

ompweb-host
  └─ Agent/Session/Remote/PTY/FS/Git authority for ompweb
```

Tauri command 不直接暴露任意文件、shell 或 OMP spawn。Remote content 永远不能获得本地壳 capability。

## 现有 Electron 功能清单

从 [`desktop/main.js`](../../../desktop/main.js)、[`desktop/preload.js`](../../../desktop/preload.js)、[`desktop/splash.html`](../../../desktop/splash.html) 建立逐项迁移表：

- 主窗口大小/最小尺寸/恢复/隐藏；
- tray、菜单、Dock、退出语义；
- 外链交给系统浏览器；
- 本地目录/文件选择、reveal、system terminal；
- 启动页、版本级 splash 视频、fade timing；
- server/host 启动等待和错误 UI；
- 日志 rotation 与 crash diagnostics；
- app update、签名、release channel；
- macOS/Windows/Linux 图标、installer、protocol/deep link（若存在）。

每项标记 `implemented / verified / intentionally changed with ADR`。未经记录不允许删功能。

## UI 与动画保真门

迁移不得修改：

- warm-paper / warm-ember palette 和 design tokens；
- 字体、字号、间距、圆角、阴影、组件层级；
- 主题切换 clip-path 动画；
- 消息进入、面板折叠、sidebar、dialog、toast、loading、activity pulse；
- splash 视频和 fade 行为；
- reduced-motion 时禁用/简化动画的语义。

逐平台对 light/dark、中文/英文/日文、Desktop 常用宽度做截图 diff；动画通过开始/中间/结束帧、持续时间容差和 reduced-motion fixture 验证。WebView 字体栅格差异允许设平台阈值，但不得用阈值掩盖布局变化。

## WebView 兼容矩阵

Tauri 当前使用 Windows WebView2、macOS WKWebView、Linux WebKitGTK，不能假设与 Electron Chromium 完全一致。[Tauri process model](https://v2.tauri.app/concept/process-model/)

必须实机验证：

- xterm 输入、resize、clipboard、CJK/IME；
- contenteditable/textarea selection 与 slash/@ menu；
- drag/drop、文件选择、paste image；
- Markdown、syntax highlight、Mermaid、KaTeX；
- PDF/DOCX/图片 preview；
- WebSocket binary、IndexedDB、WebCrypto；
- CSS `dvh`、backdrop、clip-path、font fallback；
- 多窗口/隐藏/唤醒后的 scroll anchor 和 animation state。

## 实施切片

1. Tauri skeleton，只渲染静态 fixture，不接真实 Host。
2. Capability allowlist、window/tray/menu/external link。
3. LocalHostAdapter，连接已运行 Host；Host 缺失时受控启动并显示现有风格状态页。
4. file dialog/reveal/system terminal 等壳能力。
5. splash/update/deep link/release packaging。
6. macOS canary；随后 Windows、Linux，不跨平台一次性默认启用。
7. Electron/Tauri 同版本并行 beta，收集启动/崩溃/性能和 feature parity。
8. 达到 12 的门后 Tauri 默认，Electron 保留一个稳定发布周期作回滚。

## Updater 与供应链

Tauri updater 强制验证 update signature，私钥丢失会阻断未来更新；key generation、离线备份、CI secret、rotation/emergency 流程必须先于公开 beta。[Tauri Updater](https://v2.tauri.app/plugin/updater/)

- Host binary、Tauri app、前端 assets 的版本/签名必须互相声明兼容；
- sidecar/host 替换采用原子更新和回滚；
- macOS notarization、Windows signing、Linux package 分别验证；
- update 失败不能破坏现有 Host 或 OMP session。

## 性能门

- cold/warm start-to-interactive p50/p95；
- 首次窗口、host attach、恢复最近 session 分阶段计时；
- idle RSS/CPU、安装包体积；
- 长对话打开、输入、滚动、流式渲染；
- xterm throughput/echo；
- 与同 commit Electron 同机比较。

不能通过隐藏 splash 或延迟加载关键控件伪造“可用时间”。用户能输入、滚动、打开最近会话才算 interactive。

## 退出标准

- 功能清单全部 verified 或有批准 ADR；
- UI/动画/reduced-motion 回归门通过；
- 三平台 WebView 关键矩阵通过；
- 启动、长对话、交互性能满足 12 预算，且相对 Electron 有可复现收益；
- updater/signing/rollback 演练完成；
- Tauri 不启动完整 Next/Node runtime；
- Electron 回退仍可在一个稳定周期内发布。

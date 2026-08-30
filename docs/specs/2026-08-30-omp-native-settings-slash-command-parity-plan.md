# ompweb × OMP 原生设置与斜杠命令一致性计划

- 日期：2026-08-30
- 状态：待评审 / Implementation-ready
- 仓库：`37chengshan/ompweb`
- 范围：OMP Native Settings Parity + OMP Native Slash Command Parity
- 目标版本：先在现有 4.x/Node/RPC 架构落地兼容层，再无缝迁入 5.0 Core/Client API

## 1. 背景与问题

当前 ompweb 已经能够控制一部分 OMP 原生配置，也能够通过 RPC 获取可用斜杠命令，但两条链路都还没有达到“OMP 原生能力完整映射”的状态。

### 1.1 设置侧

当前已经存在 `lib/omp/settings-config.ts` 与 `NativeExtrasSetting.tsx`，可以读取/写回 `config.yml` 中一部分 OMP 原生值，例如：

- `colorBlindMode`
- `symbolPreset`
- `composer.shape`
- `generateImage.enabled`
- `computer.enabled`
- `security.enabled`
- `github.enabled`
- `contextPromotion.enabled`
- `snapcompact.toolResults`
- `bash.autoBackground.enabled`
- Skills compatibility flags
- providers / edit / dev 等高级字段

但是 OMP 原生 Settings → Appearance 中还有大量设置尚未在 ompweb 中出现，例如：

### Theme

- Dark Theme
- Light Theme
- Symbol Preset
- Color-Blind Mode

### Composer

- Composer Shape

### Status Line

- Status Line Preset
- Status Line Separator
- Context-Reactive Line
- Session Accent
- Transparent Status Line
- Compact Thinking Level
- Show Hook Status

### Display

- Resize Scrollback
- Native Terminal Progress
- Large Headings (Kitty)
- Render Mermaid Diagrams
- Codex Reset Fireworks
- Terminal Title Run State
- Terminal Hyperlinks
- Tight Layout
- Shimmer
- Smooth Streaming
- Hide Tool Activity
- Show Token Usage
- Show Turn Time
- Cache Miss Marker
- Collapse Compacted History
- Show Hardware Cursor
- IME-Safe Prompt Layout
- Show Resolved Model Badge

### Images

- Auto-Resize Images
- Block Images

这意味着当前 Settings 只是“手工挑选了一部分 OMP config”，还不是完整的原生 Settings 映射。

### 1.2 `/` 命令侧

当前 `useAgentSession` 已经调用 OMP RPC：

```ts
sendAgentCommand(sid, { type: "get_commands" })
```

但是随后 `toSlashCommandInfo()` 明确过滤了：

```ts
if (command.source === "builtin") return null;
```

因此 OMP 已经返回的 native builtin command 并没有完整进入 Web command palette。

与此同时，`lib/web-slash-commands.ts` 又在 Web 侧重新实现了部分 `/goal`、`/plan`、`/advisor` 等命令，把它们转换成 prompt。这个方案能解决部分 RPC/TUI 差异，但会带来两个长期问题：

1. OMP 新增原生命令时，ompweb 不会自动获得；
2. Web prompt 模拟语义可能逐渐偏离 OMP 真正的 command semantics。

当前原生 OMP 菜单中至少可见：

- `/settings`
- `/setup`
- `/goal`
- `/advisor`
- `/changelog`
- `/fork`
- `/compact`
- `/plan-review`
- `/vibe`

最终目标不能是“把这 9 个命令手抄进 Web”，而应该是 **让 ompweb 直接消费 OMP Runtime Command Registry，并执行 OMP 定义的原生行为**。

---

## 2. 核心原则

### 原则 A：OMP 仍然是唯一 Agent / Native Behavior Authority

ompweb 不重新定义：

- OMP 原生 Settings 的真实值、默认值和约束；
- OMP 原生命令集合；
- OMP 原生命令语义；
- Provider Registry / Credential DB；
- Agent / Session semantics。

ompweb 负责的是：

- 把 OMP 能力暴露为 Web/Desktop/Mobile UI；
- 兼容不同 OMP 版本；
- 做浏览器/桌面端交互适配；
- 在 OMP 暂未提供结构化 RPC 的地方提供短期 compatibility adapter。

### 原则 B：Native parity ≠ TUI 像素级复刻

例如：

- `Show Hardware Cursor`
- `Large Headings (Kitty)`
- `Terminal Title Run State`
- `Status Line Separator`

这些设置可以在 ompweb 中被查看和修改，因为它们属于同一份 OMP config；但它们不应该被伪装成“会改变 Web UI”。

必须给 setting 增加 applicability：

- `shared`：可直接影响 OMP 与客户端共同体验；
- `tui-only`：只影响 OMP Terminal/TUI；
- `client-hint`：客户端可选择采用，但 OMP 仍是配置源。

### 原则 C：不永久维护硬编码原生命令表

Web command palette 的 Native OMP 区域必须来自运行中的 OMP registry，而不是源码里的固定数组。

### 原则 D：先做兼容层，再做真正协议化

现有 4.x 可以先完成：

- builtin command metadata parity；
- YAML settings parity；
- capability fallback。

然后在 OMP RPC 扩展后切换到：

- Settings Schema RPC；
- Native Command Execute RPC。

这样不需要等待 5.0 Rust Core 才开始做。

---

## 3. 目标架构

```text
                    OMP
                     │
          ┌──────────┴───────────┐
          │                      │
  Native Settings Registry   Command Registry
          │                      │
          │ RPC / compat         │ RPC
          ▼                      ▼
 ┌───────────────────────────────────────────┐
 │             OMP Adapter Layer             │
 │                                           │
 │ settings.get/schema/patch                 │
 │ commands.list/execute                     │
 │ capability negotiation                    │
 └────────────────────┬──────────────────────┘
                      │
              Unified Client API
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
       Desktop        Web       Mobile
```

其中：

- OMP 决定“有哪些设置 / 命令、含义是什么”；
- ompweb 决定“怎么展示 / 怎么交互”；
- Web UI 不直接维护 OMP TUI 行为副本。

---

# Part A — OMP Native Settings Parity

## 4. Settings 的最终数据合同

长期建议让 OMP RPC 提供一个 Settings Schema，而不是 ompweb 永久手写 `NativeSettings`。

建议协议：

### `get_settings_schema`

返回：

```json
{
  "version": 1,
  "sections": [
    {
      "id": "appearance",
      "label": "Appearance",
      "order": 10,
      "settings": [
        {
          "key": "symbolPreset",
          "label": "Symbol Preset",
          "description": "...",
          "type": "enum",
          "value": "unicode",
          "default": "unicode",
          "options": ["unicode", "ascii"],
          "scope": "global",
          "applicability": "shared",
          "restartRequired": false,
          "sensitive": false
        }
      ]
    }
  ]
}
```

### `get_settings`

用于获取当前原始值以及版本/etag。

### `patch_settings`

```json
{
  "type": "patch_settings",
  "changes": {
    "symbolPreset": "unicode"
  },
  "expectedVersion": 42
}
```

必须支持：

- validation；
- enum values；
- unknown/new fields；
- restart/reload requirement；
- optimistic concurrency；
- stable error code。

## 5. 4.x 立即可做的 Settings Compatibility Layer

在 OMP 尚未提供 schema RPC 之前，继续使用 `lib/omp/settings-config.ts`，但将它明确定位为 **compatibility adapter**。

### 5.1 增加统一 schema renderer

建议新增：

```text
lib/omp/native-settings-schema.ts
components/OmpNativeSettings.tsx
components/settings/NativeSettingField.tsx
```

`native-settings-schema.ts` 临时维护 OMP 当前版本的字段描述，UI 根据 schema 自动生成：

- boolean → switch；
- enum → select；
- number → number input；
- string → text input；
- sections → 原生 Settings 分组；
- description → 帮助说明；
- applicability → TUI-only / Shared badge。

这个本地 schema 是过渡方案，后续直接替换为 OMP RPC 返回的 schema。

### 5.2 Settings UI 新增独立入口

在 Settings 中增加：

```text
OMP Native
```

而不是继续把 OMP 原生设置散落在：

- General
- Models
- Intelligence
- Native Extras

最终建议形成：

```text
Settings
├── Interface & Behavior      # ompweb-only
├── OMP Native               # OMP config source of truth
│   ├── Appearance
│   ├── Composer
│   ├── Status Line
│   ├── Display
│   ├── Images
│   └── ...
├── Safety & Approvals
├── Providers
├── Agents
├── MCP / Extensions
├── System
└── Remote
```

现有 Web 专属主题、字体、动效继续属于 `Interface & Behavior`，不要和 OMP Terminal Theme 强绑定。

可额外提供一个显式选项：

```text
Sync compatible appearance preferences with OMP
```

默认不自动同步。

## 6. 原生 Appearance 首批迁移验收表

第一批要求覆盖用户当前 OMP Settings → Appearance 页面中的全部字段。

> 注意：实现前必须从实际 OMP config/schema 确认真实 key。禁止仅根据 UI label 猜 YAML key。

| Section | Setting | Web 可编辑 | Web 自身行为同步 |
|---|---|---:|---:|
| Theme | Dark Theme | ✅ | Optional |
| Theme | Light Theme | ✅ | Optional |
| Theme | Symbol Preset | ✅ | Optional |
| Theme | Color-Blind Mode | ✅ | Optional |
| Composer | Composer Shape | ✅ | Optional |
| Status Line | 全部原生字段 | ✅ | ❌ / TUI-only 为主 |
| Display | 全部原生字段 | ✅ | 按 applicability |
| Images | Auto-Resize Images | ✅ | 按 capability |
| Images | Block Images | ✅ | 按 capability |

## 7. Settings 写入安全要求

必须满足：

1. 保留未知 YAML key，不做 destructive rewrite；
2. 保留用户未来版本 OMP 新增但 ompweb 不认识的字段；
3. 写入前 validation；
4. 原子写入（temp + rename）；
5. 失败不得留下半写文件；
6. UI 展示真实 persisted value，而不是本地乐观值永久覆盖；
7. 配置修改若需要 restart，要明确提示；
8. Credential / secret 不进入通用 schema renderer；
9. Provider auth 继续走现有专用逻辑。

---

# Part B — OMP Native Slash Command Parity

## 8. 第一阶段：先恢复完整 Native Command Metadata

这是当前代码中最直接的缺口。

### 8.1 不再过滤 builtin

当前：

```ts
if (command.source === "builtin") return null;
```

需要改为保留 builtin，并映射成：

```ts
source: "ompBuiltin"
```

或更干净地统一成：

```ts
source: "omp-native"
```

### 8.2 `SlashCommandInfo` 不再丢 metadata

当前 `RpcAvailableSlashCommand` 已经包含：

- `name`
- `aliases`
- `description`
- `input.hint`
- `subcommands`
- `source`

Web 类型应完整保留：

```ts
interface SlashCommandInfo {
  name: string;
  aliases?: string[];
  description?: string;
  inputHint?: string;
  subcommands?: Array<{
    name: string;
    description?: string;
    usage?: string;
  }>;
  source:
    | "omp-native"
    | "extension"
    | "skill"
    | "prompt"
    | "web";
}
```

### 8.3 Palette 分组建议

```text
OMP Native
  /settings
  /setup
  /goal
  /advisor
  /changelog
  /fork
  /compact
  /plan-review
  /vibe
  ...runtime registry 中的其它命令

Extensions
Skills
Prompts
Web Commands
```

这里的列表必须动态生成；上面只是当前验收样例。

## 9. 第二阶段：Native Command Execute Bridge

仅“显示” builtin 不够，因为 OMP 中一部分 native command 当前属于 TUI `handleTui`，直接走 prompt path 会被当作普通文字。

因此需要 OMP 暴露结构化执行协议。

建议新增：

### `run_command`

```json
{
  "type": "run_command",
  "name": "compact",
  "args": ""
}
```

或者：

```json
{
  "type": "execute_slash_command",
  "command": "/compact"
}
```

推荐前一种，避免重新解析字符串。

### Command Result

```ts
type NativeCommandResult =
  | { kind: "ok"; message?: string }
  | { kind: "state_changed"; state?: unknown }
  | { kind: "client_action"; action: string; payload?: unknown }
  | { kind: "ui_request"; request: unknown }
  | { kind: "unsupported_in_client"; reason: string };
```

## 10. Interactive Native Commands 映射

以下命令不能简单等价成“向模型发一条 prompt”。

### `/settings`

应执行 OMP native command semantics，返回：

```text
client_action: open_native_settings
```

Web 打开 `OMP Native` Settings panel。

### `/setup`

返回：

```text
client_action: open_provider_setup
```

复用现有 Provider setup UI，Provider Registry / Credential DB 仍由 OMP 管理。

### `/fork`

必须走 Session/Branch 的结构化 fork 操作，Web 展示 previous-message picker；禁止用 prompt 模拟。

### `/compact`

优先复用已经存在的 compact RPC command，保持 OMP compaction 结果与状态一致。

### `/goal`

不要长期保留 Web Prompt 模拟；应由 OMP 原生 goal state / command handler 决定开关和内容。

### `/advisor`

应映射 OMP 原生 advisor state，而不是只维护浏览器 localStorage 语义。

### `/plan-review`

应从 OMP plan mode / plan state 获得真实状态，可通过 client action 打开现有 PlanPanel。

### `/vibe`

应由 OMP 返回真实开关状态和执行效果。

### `/changelog`

由 OMP 返回 changelog entries 或一个结构化 client action，Web 只负责展示。

## 11. 命令执行优先级和冲突规则

建议固定：

1. `OMP Native executable command`
2. `Extension command`
3. `Skill / Prompt command`
4. `ompweb-only command`

如果名字冲突：

- 原生 OMP command 默认优先；
- Web-only command 使用显式命名空间，例如 `/web:reload`、`/web:copy`；
- 兼容期可保留旧别名，但 palette 显示 canonical name。

## 12. `web-slash-commands.ts` 的迁移策略

现有 prompt-composing commands 不要一次删除。

建议增加 capability 判断：

```text
if OMP supports native slash execute
    execute native
else if web fallback exists
    use compatibility fallback
else
    show unsupported message
```

迁移顺序：

1. `/compact`
2. `/fork`
3. `/settings`
4. `/setup`
5. `/goal`
6. `/advisor`
7. `/plan-review`
8. `/vibe`
9. `/changelog`

当 installed OMP 支持对应 native execute 后，Web fallback 自动退出。

最终 `web-slash-commands.ts` 只保留真正属于 Web 的命令，而不是 OMP native semantics 的副本。

---

# Part C — Capability / Version Negotiation

## 13. 必须增加能力协商

OMP 与 ompweb 不可能永远同步升级，因此不能用版本号猜功能。

建议 OMP `get_capabilities`：

```json
{
  "protocolVersion": 2,
  "features": {
    "nativeSettingsSchema": true,
    "nativeSettingsPatch": true,
    "nativeSlashList": true,
    "nativeSlashExecute": true,
    "nativeSlashClientActions": true
  }
}
```

Web 使用 feature flag 决定：

- RPC native path；
- compatibility YAML path；
- compatibility slash fallback。

## 14. 新旧 OMP 兼容矩阵

| OMP 能力 | Settings | Slash Commands |
|---|---|---|
| 旧版，无新 RPC | YAML compatibility adapter | 当前 fallback + runtime metadata |
| 有 command list | YAML compatibility adapter | 完整显示 native registry |
| 有 command execute | YAML compatibility adapter | 原生命令真正执行 |
| 有 settings schema | Schema RPC | 原生命令真正执行 |

---

# Part D — 具体代码改造点

## 15. 当前仓库文件影响范围

### `hooks/useAgentSession.ts`

- 移除 builtin command filter；
- `SlashCommandInfo` 扩展 aliases/hint/subcommands/native source；
- 增加 native command execute dispatcher；
- 增加 capability state；
- native command 与 Web fallback 的选择在这里统一完成。

### `components/ChatInput.tsx`

- command palette 显示完整 OMP Native 分组；
- 显示 aliases；
- 显示 argument hint；
- 支持 subcommand 二级选择/过滤；
- native / extension / skill / prompt / web 使用明确 badge；
- 不再依靠静态 `BUILTIN_SLASH_COMMAND_DEFS` 代表 OMP native command 集合。

### `lib/web-slash-commands.ts`

- 改成 compatibility fallback；
- OMP-native name 支持 capability-gated 退出；
- 最终只保留真正 Web-only command。

### `lib/pi-types.ts`

增加：

- richer command metadata；
- native command execute request/result；
- capability response；
- settings schema/value types。

### `lib/agent-client.ts`

底层 generic command transport 已经够用。

只建议增加 typed helpers：

```ts
getOmpCapabilities()
getNativeCommands()
executeNativeCommand()
getNativeSettingsSchema()
patchNativeSettings()
```

### `app/api/agent/[id]/route.ts`

当前已经把合法 command body 透传到 OMP session，因此若 OMP 增加新的 RPC command，原则上无需为每个 native command 新写一个 API route。

需要补：

- protocol contract tests；
- unsupported-command stable error handling。

### `lib/omp/settings-config.ts`

短期：

- 扩展 NativeSettings / YAML mapping；
- 覆盖 Appearance 全字段；
- 将字段声明与 UI schema 合并，消除重复定义。

长期：

- 保留为 legacy compatibility adapter；
- 新 OMP 使用 RPC schema。

### `components/NativeExtrasSetting.tsx`

当前手写表单逐步退出；由 schema-driven `OmpNativeSettings` 替代。

### `components/SettingsConfig.tsx`

- 移除重复的局部 `NativeSettings` type；
- 统一 import `lib/omp/settings-config.ts` / protocol type；
- 增加 `OMP Native` panel。

### `components/SettingsTabs.tsx`

增加：

```ts
| "omp-native"
```

并添加独立导航项。

---

# Part E — 实施阶段

## Stage 0 — Inventory & Contract Freeze

目标：先确定真实 OMP 能力，不凭 UI label 猜实现。

任务：

- [ ] 锁定最低支持 OMP 版本；
- [ ] 导出该版本完整 `get_commands` fixture；
- [ ] 记录 native command aliases / input / subcommands；
- [ ] 从实际 OMP 源码/schema/config 确认 Appearance 全部真实 key；
- [ ] 建立 `native-settings-fixture.yml`；
- [ ] 建立 `native-commands-fixture.json`；
- [ ] 冻结 RPC capability proposal。

输出：

```text
docs/specs/...-parity-plan.md
lib/omp/__fixtures__/native-settings.yml
lib/omp/__fixtures__/native-commands.json
```

## Stage 1 — Slash Metadata Parity

目标：不等 OMP 新 RPC，先让 palette 完整展示 native builtins。

任务：

- [ ] 删除 builtin filter；
- [ ] 丰富 SlashCommandInfo；
- [ ] 显示 aliases / hint / subcommands；
- [ ] 增加 OMP Native group；
- [ ] 处理 command name conflict；
- [ ] 加快 command list caching；
- [ ] 增加测试。

验收：

> 安装的 OMP 新增一个普通 builtin command 后，只要 `get_commands` 能返回，ompweb palette 无需改源码即可显示它。

## Stage 2 — Native Slash Execute RPC

需要 OMP 侧配合。

任务：

- [ ] OMP 新增 `run_command` / `execute_slash_command`；
- [ ] OMP command handler 不再限定只有 TUI 可调用；
- [ ] 定义 `client_action`；
- [ ] `/settings`、`/setup`、`/fork` 等 interactive commands 使用结构化 action；
- [ ] ompweb 增加 dispatcher；
- [ ] capability fallback；
- [ ] 协议测试。

## Stage 3 — Native Appearance Settings Parity

目标：把当前截图中的全部原生 Appearance setting 在 Web 中可查看、可编辑、可持久化。

任务：

- [ ] 扩展 `settings-config.ts`；
- [ ] 创建 compatibility schema；
- [ ] 创建通用 SettingField renderer；
- [ ] 新增 `OMP Native` Settings 页；
- [ ] Appearance 分组完整迁移；
- [ ] 标记 TUI-only 设置；
- [ ] 重启要求提示；
- [ ] unknown key preservation tests。

## Stage 4 — OMP Settings Schema RPC

需要 OMP 侧配合。

任务：

- [ ] OMP 提供 schema/value/patch；
- [ ] ompweb capability 优先 RPC；
- [ ] 本地 hardcoded compatibility schema 只给旧 OMP；
- [ ] OMP 新增 schema-supported setting 时，ompweb 自动出现。

## Stage 5 — Remove Native Semantic Duplication

任务：

- [ ] `/goal` 改走 native handler；
- [ ] `/plan` / `/plan-review` 改走 native plan state；
- [ ] `/advisor` 改走 native state；
- [ ] `/vibe` 改走 native state；
- [ ] `/compact` / `/fork` 统一 native RPC；
- [ ] 清理对应 prompt emulation；
- [ ] 仅保留 Web-only fallback。

## Stage 6 — Remote / 5.0 Integration

当 5.0 Core/Client SDK 建立后：

```text
React
  ↓
Client SDK
  ↓
Unified Domain API
  ↓
OMP Adapter
  ↓
OMP
```

将本次实现的：

- Settings schema；
- Native command registry；
- Native command execute；
- capability negotiation；

迁移进共享 Client API，让 Desktop/Web/Mobile 三端获得相同能力。

---

# Part F — 测试计划

## 16. Settings Tests

### Unit

- [ ] bool / enum / string / number round-trip；
- [ ] unknown YAML field preserved；
- [ ] invalid enum rejected；
- [ ] nested field merge 不丢 sibling；
- [ ] atomic write failure 不破坏 config；
- [ ] 新 OMP unknown value 能以 fallback UI 展示，不擅自重置。

### Integration

- [ ] Web 修改设置 → OMP config 立即反映；
- [ ] OMP TUI 修改设置 → Web reload 后显示一致；
- [ ] OMP 升级新增 setting → schema path 自动出现；
- [ ] restart-required setting 正确提示。

## 17. Slash Command Tests

### Metadata

- [ ] builtin 不再被过滤；
- [ ] alias 可搜索；
- [ ] subcommand 可展示；
- [ ] input hint 正确；
- [ ] source badge 正确；
- [ ] 新 fixture command 自动出现。

### Execution

- [ ] `/settings` 打开 Native Settings；
- [ ] `/setup` 打开 Provider Setup；
- [ ] `/goal` 使用 OMP native semantics；
- [ ] `/advisor` 使用 OMP native semantics；
- [ ] `/changelog` 显示 OMP changelog；
- [ ] `/fork` 真实创建 fork；
- [ ] `/compact` 真实压缩 context；
- [ ] `/plan-review` 使用真实 plan mode；
- [ ] `/vibe` 使用 OMP native state；
- [ ] unsupported old OMP 自动 fallback；
- [ ] command name conflict 按固定优先级处理。

### E2E

- [ ] slash palette → command → interactive UI → result；
- [ ] settings 修改 → 重启 ompweb/OMP → 值仍然存在；
- [ ] 切换 session 后 command state 不串线；
- [ ] Web/Desktop 行为一致；
- [ ] Remote Client 后续通过统一协议得到相同列表。

---

# Part G — Acceptance Criteria

## 18. Settings Done

必须全部满足：

- [ ] 当前 OMP Appearance 页面中截图所示全部设置在 `OMP Native` 页面可见；
- [ ] Web 显示值与 OMP 实际 config 完全一致；
- [ ] Web 修改后 OMP TUI 能读取同一值；
- [ ] OMP TUI 修改后 Web 能读取同一值；
- [ ] TUI-only 字段明确标记；
- [ ] Web-only Theme/Motion/Typography 不伪装成 OMP Native；
- [ ] unknown config key 100% preserved；
- [ ] 不复制 Credential DB。

## 19. Slash Commands Done

必须全部满足：

- [ ] palette 显示 installed OMP `get_commands` 返回的完整 native builtin 集合；
- [ ] aliases / argument hints / subcommands 完整；
- [ ] 原生命令不再依赖一份永久的 ompweb hardcoded list；
- [ ] 可执行 native command 走 OMP command handler，而不是转换成普通 user prompt；
- [ ] `/settings` `/setup` `/goal` `/advisor` `/changelog` `/fork` `/compact` `/plan-review` `/vibe` 全部完成 parity；
- [ ] 老 OMP 有明确 compatibility fallback；
- [ ] 新 OMP 新增 schema-supported setting / registry command 后，原则上无需发布新 ompweb 才能“看见”它。

---

# 20. 非目标

本次不做：

- OMP TUI 的像素级 Web 复刻；
- 让 terminal-only visual setting 强制控制 Browser UI；
- 重写 OMP Provider Registry；
- 重写 OMP Credential DB；
- 重写 Agent / Session semantics；
- 为每个 native command 在 React 中维护一份独立业务逻辑；
- 等 5.0 Rust/Tauri 完成后才开始做 parity。

---

# 21. 最终定义

这次改造完成后，所谓“OMP 原生能力移植到 ompweb”应定义为：

```text
Installed OMP
    │
    ├── Native Settings Registry
    │        ↓
    │   ompweb renders + edits
    │
    └── Native Command Registry
             ↓
        ompweb lists + executes
```

而不是：

```text
OMP has feature X
      ↓
copy X into React
      ↓
OMP changes
      ↓
React drifts
```

**Definition of Done：OMP 是能力源，ompweb 是跨端表现层。**

这样未来 OMP 新增设置或 `/` 命令时，ompweb 不需要再靠人工“追着补功能”，而是通过 schema、registry 与 capability negotiation 自动获得能力；5.0 再把同一套能力接到 Desktop/Web/Mobile Client SDK。

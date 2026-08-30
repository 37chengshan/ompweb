# 07 — OMP Native Settings Parity

## 目标

让 ompweb 展示和修改 OMP 真实设置，而不是永久维护一份手工字段子集；在上游尚无 Settings Schema RPC 时，用 OMP 当前 schema-driven CLI 做 compatibility adapter，并保留严格版本/能力边界。

## 当前事实

- [`lib/omp/settings-config.ts`](../../../lib/omp/settings-config.ts) 手工定义并外科式写入一部分 `config.yml`。
- [`components/SettingsConfig.tsx`](../../../components/SettingsConfig.tsx) 与 [`components/NativeExtrasSetting.tsx`](../../../components/NativeExtrasSetting.tsx) 维护对应 UI。
- OMP `18.0.10` 当前官方 RPC 命令表没有 settings schema/get/patch。
- 但 OMP `config list/get/set/reset --json` 已由上游 `SETTINGS_SCHEMA` 驱动；list 提供 value/type/description，并对有值 credential 省略 value、标记 redacted。[OMP config CLI](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/cli/config-cli.ts)

因此 Phase 1 不等待新 RPC，也不继续扩大 YAML 手抄表。

## 适配层优先级

```text
1. Settings Schema RPC（未来，feature probe）
2. omp config ... --json CLI adapter（OMP 支持时）
3. 当前 surgical YAML adapter（旧 OMP fallback）
4. unsupported（明确展示，不猜）
```

每个 Host 返回 capability：schema source、可读/可写、scope、reset、revision、credential redaction。客户端不得根据 OMP version 字符串猜能力，必须 probe。

## Normalized Contract

```ts
interface SettingDefinition {
  key: string;
  type: "boolean" | "number" | "string" | "enum" | "array" | "record" | "unknown";
  description?: string;
  defaultValue?: unknown;
  options?: unknown[];
  applicability: "shared" | "tui-only" | "client-hint" | "unknown";
  scopes: Array<"global" | "project" | "runtime">;
  restartPolicy: "none" | "session" | "host" | "unknown";
  securityClass: "normal" | "sensitive" | "dangerous";
  source: "rpc" | "cli" | "legacy-yaml";
}

interface SettingValue {
  key: string;
  configuredValue?: unknown;
  effectiveValue?: unknown;
  redacted?: true;
  sourceScope: "default" | "global" | "project" | "runtime" | "unknown";
  revision: string;
}
```

缺失 metadata 必须保持 `unknown`，不能把 CLI 没给的 default/options/scope 推测出来。

## 写入与冲突

- CLI adapter 使用参数数组执行 `omp config set/reset ... --json`，禁止 shell 拼接。
- 读取 config 文件 metadata/hash 形成 revision；写前再次检查，变化则返回 `SETTINGS_CONFLICT`。
- 同一 Host settings mutation 经过单 writer queue。
- OMP `reset` 当前语义是写 schema default，UI 必须显示“Reset to OMP Default”，不能改成 remove override。
- Project/runtime scope 只有上游真实支持并能验证时才展示；不能写 ompweb 旁路文件冒充 OMP native。
- credential 永不进入 generic renderer；redacted 不等于字符串值，不能回写 `********`。

## UI 保真

- 现有 Settings 外观、tab、字段组件、颜色、间距、动画不变。
- Generic renderer 复用当前 UI primitives 和 design tokens。
- 高频字段可保留 curated component，但其合法值/default 来自 registry。
- TUI-only setting 可查看/修改，但明确标注“影响 OMP Terminal，不改变 Web UI”。
- unknown type 默认只读 JSON 预览；危险 raw editor 需显式高级模式和校验。

## 实施切片

1. 冻结当前 OMP `config list --json` fixture 与 credential redaction tests。
2. 新建 SettingsService contract，先包住当前 YAML adapter。
3. 加 CLI adapter：list/get/set/reset、timeout、stderr/exit code、profile/path 继承。
4. 建 generic renderer，先只读展示，再开启 boolean/enum/number/string 写入。
5. 手工字段逐个迁到 normalized definition；同一字段不允许双 authority。
6. 新 OMP 增加 Settings Schema RPC 后加 adapter，与 CLI/YAML 跑 parity suite。
7. CI 对基线/目标 OMP 输出 ADDED/REMOVED/TYPE/DEFAULT/OPTION/SCOPE 变化。

## 测试

- 每个 definition 的 read/write/reload/reset；
- credential configured/unset/clear，不泄漏原值；
- unknown type、malformed CLI JSON、unsupported OMP；
- 外部编辑后的 expected revision conflict；
- profile、XDG、project cwd 解析；
- CLI/YAML/RPC adapter 同一 fixture 归一化等价；
- screenshot/animation/reduced-motion 无回归。

## 退出标准

- 普通 OMP setting 不再要求手改 `NativeSettings` 才能被发现；
- credential 无法通过 registry/API/log 泄漏；
- reset 与 installed OMP 一致；
- scope/applicability/restart 未知时明确显示未知；
- parity drift report 成为 OMP 升级和 5.0 发布门；
- 当前 curated UI 风格和动效保持不变。

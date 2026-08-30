# 11 — Mobile Client、Offline Snapshot 与 Push Attention Plane

## 目标

提供移动网络下可恢复、安全、响应快的 Agent 控制体验。Mobile 不复制 Desktop 全部面板，但视觉语言、设计令牌、状态语义和细节动效必须一致。

## 技术栈先做决策 Spike

协议稳定前不锁定 React Native/PWA/Tauri Mobile。对三个候选做相同 vertical slice：

```text
Pair → Host list → Session snapshot → stream → background 60s
→ foreground → resume → approval notification tap
```

评分维度：

- 与现有 React/design tokens/animations 的复用度；
- iOS/Android background、push、biometric、secure storage；
- WebSocket/WebCrypto/IndexedDB/文件预览；
- 包体、cold start、内存、输入/滚动；
- 原生插件维护成本、App Store/Play 合规；
- OTA/update 与 crash diagnostics。

Tauri 2 已支持 iOS/Android 和 Swift/Kotlin plugin，但这不等于 background/push 能零成本复用；需要实机 spike。[Tauri mobile plugin](https://v2.tauri.app/develop/plugins/develop-mobile/)

## Mobile v1 范围

优先：

- enrollment / revoke status；
- Hosts、Running、Needs Attention；
- session transcript、stream、prompt/steer/cancel；
- approval 查看与安全确认；
- connection/reconnect/resume 状态；
- push tap/deep link；
- offline snapshot 和 last synced。

后置：

- interactive raw PTY；
- files/diff 的大内容编辑；
- Git 写操作；
- 完整 settings/commands 管理；
- MCP/Plugins/Skills 开发面板；
- theme studio。

后置不等于另做风格。新页面继续使用现有 palette、shape、type、motion tokens。

## Push 只做 Attention

Apple 明确后台通知是低优先级、不保证送达、可能节流，旧待发通知还可能被新通知替换；FCM 也会延迟、折叠或最终丢弃。因此：

```text
Push notification
  → 唤醒/提醒/打开 app
  → authenticate
  → RESUME(last cursor)
  → authoritative snapshot/replay
```

[Apple background notifications](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app) · [FCM delivery/lifespan](https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-lifespan)

Push payload 默认只含 opaque `notificationId`、Host alias/id、kind 和可选 session id；不含 prompt、code、terminal、command、secret。锁屏预览由用户隐私设置控制。

## Approval 通知

- Low：可提供打开 app 的快捷入口；是否允许通知 action 直接批准由安全 ADR 决定。
- Medium：打开 app、重新同步、显示 structured payload 后确认。
- High：foreground + device unlock/biometric + 最新 snapshot；锁屏 action 不直接执行。
- 过期/已解决 approval 的通知 tap 返回 stale state，不显示成功。

## Offline Snapshot

缓存：

- Host/session summary；
- 最近 completed messages/tool summary；
- pending attention 的最后已同步状态；
- cursor、schema version、lastSyncedAt。

不缓存或默认加密/缩短保留：

- credential、完整 terminal、巨型 file/diff、thinking、未授权 workspace。

离线时 UI 明确显示“Last synced … / Offline”，禁用 mutation 或排入显式 outbox。默认不自动排高风险 mutation；普通 prompt outbox 也必须在恢复后重新确认 expected state，避免发送到过期 session。

## 生命周期与性能

状态机覆盖 foreground/background/suspended/killed/reboot。禁止假设 WebSocket 后台常驻。

参考中端 iOS/Android 设备测：

- cold/warm launch to usable；
- transcript 1k/5k messages 的内存、scroll、input-to-paint；
- stream + soft keyboard + IME；
- background 10s/10m、Wi-Fi ↔ 5G、process killed resume；
- battery/network bytes，PTY/data 默认 pause；
- 动画 60Hz 目标与 reduced-motion。

## UI 保真

- 不重新定义主题、颜色、圆角、字体和动效节奏；
- Mobile 可以改变布局层级和触摸 target，但组件视觉语言一致；
- loading/reconnect/offline/attention 必须有现有风格动画，不能用永久 spinner 隐藏状态；
- 所有动画在 background 停止，在 foreground 根据 state 恢复而非重复乱跳；
- reduced-motion 与 desktop 同语义。

## 实施切片

1. 三栈 spike，产出 ADR-006，不接生产 push。
2. Fixture-only Mobile shell + golden UI/motion tests。
3. Enrollment、Host list、read-only session + resume。
4. Prompt/cancel/approval + capability/biometric。
5. Offline snapshot、cache clear、storage encryption。
6. APNs/FCM token registration、attention notification、deep link。
7. 网络/生命周期/性能 canary；通过后 beta。
8. Terminal/files/git/settings/commands 分别按 capability 和性能新增。

## 退出标准

- 平台选择有实测数据，不由团队偏好决定；
- Wi-Fi/5G/background/kill 后最终状态收敛且不重复 mutation；
- push 丢失不影响最终正确性；
- high-risk approval 满足本地认证和最新状态检查；
- offline 数据范围、保留和清理可控；
- 长对话、输入、启动性能满足 12 的 Mobile 预算；
- 视觉和动画与现有 ompweb 风格一致。

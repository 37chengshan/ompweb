# ADR-006 — Mobile 技术栈（占位：按计划延后）

状态：**延后（计划要求的占位，非决策）** · 日期：2026-08-30 · 关联：`11-mobile-and-push.md`、`00-plan-audit.md`

## 背景

00 审计明确：协议稳定前不锁定 React Native / PWA / Tauri Mobile 三选一，避免把技术栈偏好写进总计划。13 号交接文档的 ADR 清单（001/002/003/004/005/007）刻意不含 006。

## 决定

**不做技术栈决策。** 本文件仅登记决策门与评分框架，防止后续波次绕过评审。

## 决策门（触发条件）

W2（WS v1 + Security PoC）通过、且 03 的 resume/reliability 指标稳定后，用同一 vertical slice 对三个候选做 spike：

```text
Pair → Host list → Session snapshot → stream → background 60s
→ foreground → resume → approval notification tap
```

评分维度按 11 号文档：React/design tokens/animations 复用度、background/push/biometric/secure storage、WebSocket/WebCrypto/IndexedDB、包体与冷启动、原生插件维护成本与商店合规、OTA/crash diagnostics。

## 已预先决定的约束（不受选型影响）

1. Push 只做 attention plane：Apple/FCM 后台通知不保证送达，最终正确性依赖 RESUME + 权威 snapshot。
2. Mobile 不复制 Desktop 全部面板；palette/shape/type/motion tokens 与桌面一致。
3. offline snapshot 不缓存 credential/thinking/未授权 workspace；离线时默认禁用高风险 mutation。

## 外部依赖

APNs/FCM 开发者账号与推送链路；实机（中端 iOS/Android）测试设备。

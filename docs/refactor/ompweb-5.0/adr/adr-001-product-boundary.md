# ADR-001 — 产品边界：从"非远程控制面"到 local-first agent host

状态：草案 · 日期：2026-08-30 · 关联：`DESIGN.md`、`docs/refactor/ompweb-5.0/00-plan-audit.md`

## 背景

`DESIGN.md` 目前把"通用远程控制面"列为非目标。原始 5.0 计划（Native Runtime + Remote Continuity）实质上修订了该边界，但没有显式改契约。审计结论（00）要求先做产品/架构 ADR，再动远程实现。

## 已决定

1. 产品方向接受：ompweb 演进为 **local-first agent host**——本机体验不变，远程连续性（手机/第二台设备查看与控制 Agent）成为一等能力，但 OMP 保持 Agent/Session/Provider/Auth 唯一权威。
2. 范围护栏不变：不做远程桌面、VPN、文件同步器、云 IDE（04 的边界继续有效）。
3. 4.x 用户可见行为与措辞在 W2 之前不变；本 ADR 只是契约修订的登记，不是立即改 UI 的授权。

## 待 spike / 后续决定

- Remote 的最终产品形态（临时分享 vs 长期设备接入的 UI 分层）在 WS v1 + 安全 PoC（W2）之后定稿。
- `DESIGN.md` 的正式修订文本与 Quick Tunnel 降级措辞（00 止血项 1）在首个远程切片 PR 一并落地。

## 外部依赖

- 无硬依赖；Quick Tunnel 能力受 Cloudflare 官方限制约束（无 SLA、200 in-flight、不支持 SSE），文案与诊断必须如实反映。

## 后果

- 后续 Remote/Relay/Mobile 工作包有了明确的产品授权来源。
- 若 W2 安全门未过，本 ADR 不产生任何用户可见变化（回滚成本为零）。

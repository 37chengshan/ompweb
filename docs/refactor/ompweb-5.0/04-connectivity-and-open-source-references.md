# 04 — Connectivity、Relay 与开源项目参考

## 目标

用成熟开源项目的已验证模式减少自创设计，同时保持 ompweb 的边界：它是 Agent Host 控制面，不是远程桌面、VPN、文件同步器或云 IDE。

## 开源参考矩阵

| 项目 | 借鉴点 | 明确不照搬 |
|---|---|---|
| [OpenCode Server](https://dev.opencode.ai/docs/server/) | headless server、TUI/Web 多客户端、OpenAPI → SDK、默认 loopback、mDNS opt-in | OMP 仍是 Agent authority；不复制 OpenCode session/provider/runtime |
| [Tailscale / DERP](https://tailscale.com/blog/how-nat-traversal-works) | relay-first 可立即连接、后台探测更优 direct path、失败回退 relay、E2EE 与路径分离 | 5.0 不自研完整 VPN/WireGuard/NAT traversal，不宣称达到 Tailscale 成功率 |
| [RustDesk Server](https://github.com/rustdesk/rustdesk-server) | rendezvous (`hbbs`) 与 relay (`hbbr`) 分离、self-host、direct/forced relay 运维参数 | 不复制屏幕/键鼠/远程桌面协议，不照搬其身份/密码实现 |
| [Syncthing](https://docs.syncthing.net/) | device identity、local/global discovery、relay fallback、设备显式信任 | 不做文件同步/冲突副本，不广播 workspace/session 敏感元数据 |
| [code-server](https://github.com/coder/code-server/blob/main/docs/guide.md) | 默认 localhost、远程需认证+加密、登录限速、WebSocket 和浏览器安全上下文约束 | 不直接暴露完整主机 IDE/terminal；不把密码登录当长期设备身份 |
| [Noise Protocol](https://noiseprotocol.org/) | 经过形式化描述的认证密钥协商模式和现有 Rust/JS 实现生态 | 不自己拼 Ed25519/X25519 消息序列；具体库仍需审计 |

参考代码的许可证、活跃度、安全记录和实现复杂度必须在采用前单独记录。此矩阵是设计输入，不是复制清单。

## 分阶段连接产品

### C0 — 可信现有网络

首个可靠版本只承诺：

- loopback/local IPC；
- LAN + HTTPS；
- 用户已有 VPN（Tailscale/WireGuard/ZeroTier 等）；
- 用户管理的 Named Cloudflare Tunnel。

Quick Tunnel 只保留开发/临时演示。Cloudflare 官方明确 Quick Tunnel 无 SLA、200 in-flight 上限且不支持 SSE。[官方限制](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)

### C1 — ompweb Blind Relay

Host 与 Client 都发起 outbound WSS：

```text
Host ── encrypted frames ──▶ Relay ◀── encrypted frames ── Client
```

Relay 只负责：

- authenticated rendezvous；
- connection/presence routing；
- encrypted frame forwarding；
- per-device/host/IP rate limit；
- byte/session/time quota；
- region health 与可观察错误。

Relay 不存 session、prompt、code、terminal replay 或解密密钥。它仍能看到连接时间、字节数、路由 ID 和 IP，因此使用“payload-confidential blind relay”，不使用绝对的“zero knowledge”宣传。

### C2 — Direct Path Upgrade（非 5.0.0 必需）

只有 Relay 稳定后才评估 STUN/ICE/QUIC/WebRTC data channel 或现有网络库。Tailscale 的经验说明 NAT traversal 需要 UDP socket 控制、side channel、STUN 和可靠 relay fallback；这不是给 WebSocket 加几个 probe 就能完成的功能。[Tailscale NAT traversal](https://tailscale.com/blog/how-nat-traversal-works)

## Connection Manager

状态：

```text
offline → discovering → connecting → authenticating
        → syncing → connected → degraded → reconnecting → resuming
```

候选 path 记录：

- endpoint/type（loopback、LAN、VPN、named tunnel、relay、future direct）；
- transport security 和 identity binding；
- RTT、最近成功、连续失败、可用带宽；
- policy（例如“只允许 VPN/Relay”）；
- 成本与 battery hint。

选择策略先做简单、可解释的 happy-eyeballs：并行探测少量候选，成功后继续低频探测备用；切换一定重新认证并从 02 的 cursor resume，不能把 socket continuity 当 session continuity。

## LAN Discovery

- mDNS 默认只在用户启用 Remote/Pairing 后打开。
- 广播仅含 protocol version、随机 host alias、port、pairing-required；不含用户名、项目名、session title、cwd。
- discovery 结果只是候选地址，不是身份；连接后必须校验 Host identity fingerprint。
- 支持手动地址，避免企业/访客网络禁 mDNS 时完全不可用。

## Relay MVP 实施切片

1. 本地 in-process relay simulator，验证多连接路由、限额、drop/reorder/delay。
2. 单 region relay，只有 `/health`、rendezvous 和 frame forwarding。
3. Abuse gate：未配对 host/device 不允许占用持久连接；认证前严格 byte/time 限制。
4. Connection trace：每个阶段、选择原因、失败码、resume cursor 可导出且默认脱敏。
5. 自托管文档、容器镜像、密钥轮换和数据保留说明。
6. 托管服务、账号、付费、multi-region 需要新的产品和运营批准，不属于代码 MVP 的默认授权。

## 测试矩阵

- 同 LAN、访客 Wi-Fi、VPN、CGNAT、UDP blocked、DNS outage；
- relay 高延迟/限速/断连/重启；
- LAN → 5G、Relay → LAN、Host sleep/wake；
- 非对称 path、旧 path 晚到 frame；
- rogue mDNS、host alias 冲突、relay replay/injection；
- 1/10/100 并发 Host，每 Host 多客户端；
- 控制 P0 延迟和 PTY/file 吞吐分开计量。

## 退出标准

- C0 在受支持路径上通过断网/resume 和安全门；
- C1 单 region 能 self-host、限流、滚动升级且 Relay 无法解密 payload；
- path switch 不产生重复 mutation 或永久 stale state；
- connection trace 能解释每次失败和选择；
- C2 未完成不阻止 5.0.0，产品文案不承诺自研 NAT traversal。

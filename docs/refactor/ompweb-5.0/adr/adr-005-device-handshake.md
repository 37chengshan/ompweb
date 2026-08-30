# ADR-005 — 设备握手协议与密钥存储：不自创协议，选型待评审

状态：草案（约束与边界已决定，具体协议/库选型待评审）· 日期：2026-08-30 · 关联：`05-security-and-device-identity.md`

## 背景

当前 pairing 是"one-time token → 长期 Cookie"，Cookie 未设 `Secure`，Host header 参与信任判定，paired 等价于大范围 API access。5.0 要求可撤销、可分权、绑定设备密钥的 enrollment。审计明确拒绝"Ed25519 + X25519 拼消息序列 = 协议设计"。

## 已决定（约束层，选型前即生效）

1. **不自创握手协议**。候选限定为：成熟 Noise pattern 库（需 Rust/JS 可互操作实现）或成熟 TLS 之上经过审查的应用层会话协议。
2. transcript 绑定 protocol version、Host/device ID、capability revision（防 downgrade/UKS）。
3. 密钥层级：Host private key 进 OS keychain，Runtime DB 只存引用；Native client 用 Keychain/Keystore；Browser 用 non-extractable WebCrypto + IndexedDB，且**纯浏览器设备默认不授予高风险 capability**。
4. Enrollment：bootstrap token 一次性、monotonic expiry、放 fragment 或 app-handled QR payload（不进 URL/history/referrer/log）；重复/过期/撤销 token 返回同类错误（不做有效性 oracle）；Host 本机确认设备名/平台/fingerprint 后才写 Device Registry。
5. 4.x pairing Cookie 不静默升级为加密设备身份；迁移 = 显式重新 enrollment。
6. Relay 场景下 Host/Client 间 payload 端到端加密；Relay 定性为 payload-confidential blind relay（能看到路由元数据）。

## 待 spike（W2 Security PoC）

1. 协议选型：Noise 具体 pattern 与库（维护状态、审计记录、constant-time、key zeroization、nonce/rekey API）vs TLS+应用层会话；产出互操作 vectors 后定稿。
2. 浏览器 WebCrypto 能力差异矩阵（Safari/Chrome/Firefox non-extractable key 支持度）。
3. device key 轮换与丢失恢复流程（不允许可猜 recovery code 恢复高权限）。

## 外部依赖

- 独立安全评审通过前不得进入 public beta（05 发布门）；Noise/Rust 实现生态的 license 与审计记录收集。

## 后果

- 在选型冻结前，03 协议层的 AUTH handshake 只定义 error code 与阶段边界，不自创 challenge/signature。
- 当前 4.x 止血项（rate limit、Secure cookie、非 loopback 语义、token 暴露收紧）不依赖本 ADR 选型，先行落地。

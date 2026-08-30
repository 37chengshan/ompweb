# 05 — Security、Device Identity 与 Capability Authorization

## 目标

把当前“拿到 one-time token 后获得长期 Cookie”的 Web pairing，迁移成可撤销、可分权、绑定设备密钥的 enrollment；所有 Remote path 在相同身份和权限模型下工作，Relay 只能转发密文 payload。

## 当前安全基线与缺口

当前已有值得保留的安全行为：

- token 单次使用、短期过期、刷新后旧 token 作废；
- loopback-only token issuance；
- paired device 列表、heartbeat、单设备/全部撤销；
- origin check、文件 allow-list、路径 canonicalization；
- Web password 使用 HttpOnly signed cookie；
- 不读取 OMP `agent.db`，API key 不回传。

结构性缺口：

- Desktop server 默认监听 `0.0.0.0`；
- pairing Cookie 未设置 `Secure`，HTTP LAN 上不能抵抗同网窃听/劫持；
- Host header 被用来区分 loopback/remote，反向代理或非浏览器请求可改变它，不能作为信任根；
- paired 等价于大范围 API access，没有 capability；
- query 中的 pairing token 可能进入 history/referrer/log；
- Relay/E2EE/密钥轮换/设备恢复还不存在。

因此进入 5.0 前必须先完成 00 的 4.x 止血；本计划不把当前 pairing 描述成“已安全支持公网”。

## Threat Model

至少覆盖：

1. 同 LAN 被动监听和主动中间人；
2. 恶意/被攻陷 Relay：观察、drop、delay、reorder、replay outer frame；
3. 被盗手机、浏览器 profile、Host 磁盘；
4. XSS 后调用已有 device credential；
5. 配对 QR 泄漏、重放和用户误配；
6. capability 提权、命令 confused deputy；
7. path 切换/协议降级攻击；
8. 供应链、自动更新、sidecar 替换；
9. 恶意大 frame、压缩炸弹、磁盘/日志耗尽；
10. Host 与客户端时钟不可信。

每个资产（OMP session、workspace、terminal、credentials、device key、approval）要列 confidentiality/integrity/availability 目标及剩余风险。

## 身份与密钥层级

### Host

- user-scoped Host identity；
- private key 存 OS keychain/secure storage，Runtime DB 只存 key reference/public metadata；
- 支持备份/恢复策略，但默认不把 private key 上传 Relay；
- identity rotation 与“新 Host”语义分开。

### Native Client（Tauri/Mobile）

- private key 存 Keychain/Keystore/平台 secure enclave 能力；
- biometric 只解锁高风险动作，不把 biometric 当网络身份；
- app uninstall/restore 后按新设备或显式恢复处理。

### Browser Client

- 优先 non-extractable WebCrypto key + IndexedDB；
- 明确安全等级低于 native secure storage：XSS/浏览器 profile compromise 仍可代替用户调用 key；
- 高风险 capability 默认不授予纯浏览器设备，或要求 Host/native 再确认；
- 清站点数据视为丢失设备 credential，需要重新 enrollment。

## 协议选择

不以“Ed25519 + X25519 + AES/ChaCha”作为完整设计。先产出 `ADR-005`：

- 候选：成熟 Noise handshake pattern/库，或能满足浏览器/Relay 场景的成熟 TLS 之上应用层会话协议；
- 必须有 Rust 与 Web/Native 可互操作实现；
- 检查维护状态、审计记录、constant-time、key zeroization、nonce/rekey API；
- transcript 绑定 protocol version、Host/device ID、capability revision，防 downgrade/UKS；
- 正式采用前由独立安全评审和互操作 vectors 通过。

Noise 提供标准化认证、前向保密和 transport key 建模，但具体 pattern 和实现仍需审查，不能只因为用了 Noise 名称就自动安全。[Noise Protocol Framework](https://noiseprotocol.org/)

## Enrollment

推荐流程：

```text
Host 生成短期 enrollment session
  → QR 含 host public fingerprint、一次性 secret、expiry、候选 endpoints
  → Client 建立受保护握手并证明 possession
  → Host 本机显示设备名/平台/fingerprint/请求角色
  → 用户确认
  → 写 Device Registry + capability preset
  → bootstrap secret 立即销毁
```

要求：

- token 只用一次，使用 monotonic expiry + server state，不信任客户端时间；
- 浏览器链接 token 放 fragment 或 app-handled payload，避免自动发到 server/log/referrer；
- QR 不包含 session title/project/cwd；
- enrollment 与长期 session key 分离；
- Host 未确认前只能使用严格 bootstrap quota；
- 重复/过期/已撤销 token 返回同类错误，避免有效性 oracle。

## Capability Policy

基础能力：

```text
session.read / session.control / prompt.send / agent.cancel
approval.read / approval.resolve
terminal.read / terminal.write
file.read / file.write
git.read / git.write
settings.read / settings.write
commands.execute
devices.manage / remote.admin
```

规则：

- role 只是 preset，授权计算使用 capability；
- capability 绑定 device、Host、可选 workspace/session scope、revision 和 expiry；
- 每个 mutation 在 Host 侧重新授权，不能信客户端隐藏按钮；
- command/setting 自身的 security class 与 device capability 同时满足；
- high risk 要求 foreground + native local auth + 可选 Host 再确认；
- deny 和 stale revision 都进入安全审计，但不记录 prompt/code/secret。

## Revocation 与会话

- revoke 先写 registry，再断开所有活动 connection；
- session key 有短期 lifetime 和 rekey；device key 只用于认证/协商；
- Relay outage/Host restart 不应要求重新 pairing；
- device private key 丢失不能只用可猜 recovery code 恢复高权限；
- 管理员可查看 last seen、client version、capability、key age，不显示原始 token/key。

## 4.x 止血切片

1. 文档/UI 强制说明非 loopback 需要 VPN 或 HTTPS，Quick Tunnel 非生产。
2. pairing/login/token/mutation 增加 rate limit 和 abuse tests。
3. 反向代理配置显式信任 proxy allowlist；不根据可伪造 Host 跳过认证。
4. 设备 Cookie 在 HTTPS 路径设置 `Secure`；HTTP LAN 标记降级且默认不给高风险能力。
5. 收紧 token 在 URL、日志、诊断和错误中的暴露。

## 测试与发布门

- 重放/过期/并发消费 enrollment；
- forged device proof、wrong Host fingerprint、downgrade；
- revoked device 的活动 socket 和后续 resume；
- capability scope/expiry/revision、confused deputy；
- malicious Relay 的 drop/reorder/replay/injection；
- key storage 失败、锁屏、设备迁移、浏览器清数据；
- path traversal、symlink escape、terminal/file/git 权限旁路；
- oversized/compression bomb/rate-limit evasion；
- 外部安全评审未关闭 P0/P1 finding 不得进入 public beta。

## 退出标准

- 所有 Remote path 使用相同设备认证和 capability engine；
- Relay 与网络攻击者无法解密或伪造已认证 payload；
- 浏览器与 native 的安全等级和功能限制对用户透明；
- revoke 在规定时间内关闭活动连接并拒绝 resume；
- 不存在 Host header/Cookie 作为唯一信任根的 5.0 路径；
- 协议、库、key storage 和残余风险都有审计记录。

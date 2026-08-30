# ompweb 5.0 ADR 目录

状态标记：`草案`（内容可改，未接受）→ `已接受` → `被取代`。按 13 号交接文档要求，每份草案明确区分 **已决定 / 待 spike / 外部依赖**，不得把待定项写成已定。

| ADR | 主题 | 状态 | 决策门 |
|---|---|---|---|
| [ADR-001](./adr-001-product-boundary.md) | 产品边界：从"非远程控制面"到 local-first agent host | 草案 | DESIGN.md 修订随 W2 首个远程切片落地 |
| [ADR-002](./adr-002-host-lifecycle.md) | Host 生命周期（独立 daemon vs 跟随桌面进程） | 草案（方向已定，机制待 spike） | 06 Host PoC 产出实测后冻结 |
| [ADR-003](./adr-003-event-cursor.md) | 事件 cursor（hostEpoch + streamId + seq）与保留策略 | 草案（模型已定，参数待测） | 02 Slice 1/2 fixtures 通过后冻结 |
| [ADR-004](./adr-004-remote-v1-encoding.md) | Remote v1 编码与流控 | 草案（传输已定，预算待测） | 03 P1–P3 + benchmark 记录后冻结 |
| [ADR-005](./adr-005-device-handshake.md) | 设备握手协议与密钥存储 | 草案（约束已定，协议选型待评审） | 互操作 vectors + 独立安全评审 |
| [ADR-006](./adr-006-deferred-mobile-stack.md) | Mobile 技术栈（占位：按计划延后） | 延后 | 协议稳定后三方 spike |
| [ADR-007](./adr-007-performance-reference.md) | 性能参考环境、fixture 与预算冻结 | 草案（W0 参考环境已登记） | W0 基线实测后冻结绝对数值 |

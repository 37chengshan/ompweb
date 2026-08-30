# 03 — Remote Protocol v1

## 目标

在浏览器、Desktop 和 Mobile 间建立可版本化、可恢复、可限流的远程协议。v1 优先保证 correctness、resume 和广泛兼容，不提前追求自定义二进制协议的理论极限。

## 关键修订

原计划把固定 binary header、四 channel、独立 credit window 都放进首版。审计后改为：

- transport：WebSocket；
- control/event：版本化 JSON message；
- PTY/file/diff：必要时使用 binary message；
- 单连接内做逻辑 stream 和优先级调度；
- 只有 benchmark 证明 JSON/现有 framing 是瓶颈，才 ADR 引入 CBOR/Protobuf 或自定义 header。

原因是浏览器稳定 `WebSocket` API 本身没有 backpressure；先解决有界队列和调度比先压缩 header 更重要。[MDN WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)

## v1 Envelope

```ts
interface ProtocolMessage<T = unknown> {
  version: 1;
  kind: "request" | "response" | "event" | "flow" | "error";
  requestId?: string;
  streamId: string;
  cursor?: { hostEpoch: string; seq: number };
  type: string;
  payload?: T;
}
```

Binary data message 使用小型版本化 prefix 关联 `streamId/requestId/chunkIndex`，但其格式在 file/PTY PoC 后冻结。不得把 JS `number` 当无损 u64；seq 在 JSON 中用安全整数范围或十进制字符串。

## 握手

```text
Socket open
  → HELLO(client version, protocol versions, features, device id)
  → AUTH handshake / proof
  → WELCOME(selected version, host epoch, capabilities, limits)
  → RESUME(subscriptions + cursors)
  → replay/snapshot
  → SYNC_COMPLETE
  → live
```

握手超时、认证失败、版本不兼容、设备撤销和 clock skew 都返回稳定 error code。安全握手由 05 定义，协议层不自创 challenge/signature。

## Stream 与优先级

| 优先级 | 内容 | 策略 |
|---|---|---|
| P0 | auth、revoke、approval、mutation receipt、cancel | 预留队列，不能被 data 饿死 |
| P1 | session state、message complete、tool complete | reliable、有 cursor、可 replay |
| P2 | streaming checkpoint、todo/diff update | 可合并但有最终状态 |
| P3 | telemetry、typing、presence tick | 可采样/丢弃 |
| Data | PTY/file/artifact chunks | credit/pause、单独 byte budget |

每个连接设总 byte 上限，每个 stream 设 message/byte 上限。达到 high-water mark：

- P3 先丢；
- P2 合并；
- Data pause；
- P0/P1 无空间时主动断开并要求 resume，不能无限堆内存。

客户端发送端监控 `WebSocket.bufferedAmount`；Host 维护自己的 bounded scheduler。WebSocket 没有自动背压，任何“无限 send”实现都不得合并。

## Mutation

```json
{
  "version": 1,
  "kind": "request",
  "requestId": "device-scoped-uuid",
  "streamId": "session:abc",
  "type": "agent.prompt",
  "payload": {
    "clientMsgId": "uuid",
    "expectedState": "idle",
    "content": {}
  }
}
```

Host 先返回持久化的 `COMMAND_ACCEPTED` receipt，再异步返回 committed/failed/unknown。网络超时后客户端只能用相同 `clientMsgId` 查询/重试，不能生成新 id。

## 版本与能力协商

- Protocol version 只用于 breaking wire semantics。
- Feature 使用 intersection，例如 `resume_v1`、`binary_data_v1`、`settings_registry_v1`。
- Host capability 决定 UI 是否展示 Terminal write、settings scope 等。
- 未知 optional 字段保留/忽略；未知 required feature 拒绝连接。
- downgrade 必须被认证握手覆盖，防止攻击者强制降级。

## 从 SSE 迁移

1. 保留现有 SSE，新增实验 WS endpoint。
2. FixtureAdapter 向 SSE/WS 投入同一 AgentEvent fixture，比较最终 snapshot。
3. 仅内部/loopback canary 使用 WS mutation；SSE 仍是回退。
4. Remote 流量先切 WS event，再切 mutation。
5. 只有 resume/reliability 指标稳定后才下线 Agent SSE；file watch/auth login 可按各自需要保留 HTTP/SSE，不强求一个协议包揽全部。

Quick Tunnel 不支持 SSE 的事实是“Agent Remote 改 WS”的直接动机，但不是移除所有 SSE 的理由。[Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)

## 实施切片

- P1：message schema、codec、limits、golden vectors。
- P2：Node WS loopback server，仅 HELLO/PING/SUBSCRIBE/EVENT。
- P3：接 02 的 resume/snapshot；注入断网/乱序/重复。
- P4：mutation receipt、expected state、dedup query。
- P5：PTY/file binary data + pause/resume。
- P6：加密 transport adapter、relay adapter、path switch。

## 测试

- frame 分片/合并、非法 JSON、超长 message、binary length 欺骗；
- 未知 type/version/feature；
- P0 在 PTY flood 下的最大延迟；
- `bufferedAmount` 超阈值、慢客户端、后台 tab；
- reconnect mid-snapshot、live-tail 接续、重复 cursor；
- compression bomb、未认证消息、认证后降级；
- 兼容当前/前一 minor 客户端。

## 退出标准

- LAN/代理/relay transport 都通过同一协议 suite。
- 断网恢复无永久 stale state；mutation 重试不静默重复。
- PTY/file flood 不阻塞 cancel/approval。
- 慢客户端内存有明确上限和降级路径。
- JSON/binary 的选择有 benchmark 记录；没有数据不得引入更复杂 codec。

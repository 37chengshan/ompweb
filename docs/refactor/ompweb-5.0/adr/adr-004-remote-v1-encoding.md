# ADR-004 — Remote v1 编码与流控：WS + 版本化 JSON，二进制仅限数据块

状态：草案（传输与消息形态已决定，字节预算待 benchmark）· 日期：2026-08-30 · 关联：`03-remote-protocol.md`

## 背景

浏览器稳定 `WebSocket` API 没有内建背压；原计划的"自定义二进制 header + 四 channel + 独立 credit window 首发"被审计否决。Quick Tunnel 不支持 SSE 是把 Agent 远程流改 WS 的直接动机。

## 已决定

1. v1 transport 固定 WebSocket；control/event 用版本化 JSON envelope（`version:1, kind, requestId, streamId, cursor?, type, payload?`）。
2. PTY/file/diff 数据块可用 binary message，但仅用小型版本化 prefix 关联 `streamId/requestId/chunkIndex`；格式在 file/PTY PoC 后冻结。
3. 单连接内做逻辑 stream + 优先级调度（P0 auth/revoke/approval/cancel 预留队列；P3 telemetry 可丢；Data 有独立 byte budget），达到 high-water 依次：丢 P3 → 合并 P2 → pause Data → P0/P1 无空间主动断开要求 resume。
4. 客户端监控 `WebSocket.bufferedAmount`；Host 侧 bounded scheduler。
5. 不引入 CBOR/Protobuf/自定义压缩，除非同机 benchmark 证明 JSON framing 是瓶颈（benchmark 记录进本 ADR 附录后才可改）。
6. seq 在 JSON 中保持安全整数范围；不用 JS number 表示无损 u64。
7. mutation：先持久化 `COMMAND_ACCEPTED` receipt 再异步回 committed/failed/unknown；超时重试只能复用相同 `clientMsgId`。

## 待 spike（03 P1–P5 期间）

1. 总连接 byte 上限、每 stream message/byte 上限的具体数值（Stream/PTY fixture 实测后冻结）。
2. binary prefix 字段布局冻结（file/PTY PoC 后）。
3. WS endpoint 暴露位置与鉴权边界（依赖 ADR-005 落地）。

## 外部依赖

- Cloudflare Quick Tunnel 无 SSE（现有 Agent SSE 远程链路的已知缺陷，WS 迁移的动机依据）。

## 后果

- SSE 保留为回退与部分 HTTP 场景（file watch、auth login）不下线；协议切换按 03 的迁移顺序（event 先、mutation 后）。
- 未知 optional 字段保留/忽略、未知 required feature 拒绝连接——写入 contract fixtures。

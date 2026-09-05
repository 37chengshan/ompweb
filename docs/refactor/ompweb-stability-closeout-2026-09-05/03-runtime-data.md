# 工作包 B：Rust 生命周期与数据一致性

## 目标与边界

修复现有 Supervisor、IPC、脚本、文件路径和标题保存。保留当前 Node/Next → Rust host → OMP 的生产链路，不进行 Tauri 迁移、事件日志重构或新协议开发。

## 实施后的关键约束

1. **进程创建不等于 readiness。** boot Promise 必须覆盖旧进程退出、spawn、boot 行校验；后续请求还必须等待控制连接 hello。
2. **阻塞 I/O 不持全局注册表锁。** 每会话 writer 独立串行化；list、广播和 kill 不能等待写管道。
3. **重启替换整个通信代次。** child/stdin/restarts 一次提交，停止标记重新检查；不重放未知是否执行过的用户命令。
4. **阻塞业务不占 cancel/state 连接。** agent.send、commands.run、git.push 使用独立控制连接；保留单次请求期限。
5. **内存有边界。** 不保留无人消费的 receiver；订阅队列和回放同时有界。队列满的连接关闭后需要重新同步。
6. **文件改名不重写消息正文。** 已有固定槽只覆盖 256 字节。旧格式与损坏槽明确报错，禁止在未知写入者存在时全文件改写。
7. **路径比较基于同一语义。** 脚本与 PTY 对根、目标都 canonicalize；不能把 symlink 逃逸放行。
8. **运行库路径由同一配置决定。** Node 以 getAgentDir 推导 Rust runtime.db，尊重显式覆盖，避免 Windows HOME 缺失与 profile 分叉。

## 已加入的行为回归

- `supervisor::lifecycle_tests`：重启后下一条命令得到响应；大写入卡住仍可 list/kill；stdout EOF 后仍可取消。
- `rust-host-lifecycle.test.mjs`：八路冷启动、一个 host、hello 顺序、控制断线、长命令不阻塞 ping。
- `rename_preserves_body_and_fixed_utf8_slot`：长 UTF-8 标题与重复写入后正文及大小不变。
- `canonical_root_tests`：根别名接受、逃逸链接拒绝。
- `wait_mode_times_out`：同时验证 timedOut 和实际经过的时间。

## 下一轮必须补的压力验收

| 场景 | 操作 | 验收 |
|---|---|---|
| 多会话隔离 | 一个 agent 停止读取，其他会话持续发送/取消 | 健康会话继续响应；停滞会话可停止 |
| IPC 容量 | 逐步增加 PTY、agent attach 和并发请求至连接上限 | 达限有确定错误、释放后恢复，不把永久挂起当运行中 |
| 慢消费者 | 降低 SSE/attach 读取速度并断线重连 | 内存不无限增长；重连后明确恢复/报错，不伪装完整结果 |
| 取消/重启竞态 | 在 crash/backoff/ready 各阶段取消 | 用户取消不会拉起新 agent |
| 长时间运行 | 多小时重复建会话、终端、关闭、重连 | 文件句柄、进程与 RSS 在稳态范围内 |
| 标题与外部写入 | 外部 OMP 持续 append，同步改标题 | 消息尾部不丢失、正文 hash 不被标题写破坏 |

这些场景未全部执行，不能标记为高可用性认证。下一轮只补证据和发现的缺陷，不借此新增平台功能。

## 风险与回滚

有界队列溢出是显式断开策略，需要 UI 重连/对账配合，不能承诺无条件不丢 live frame。进程组外的主动脱离子孙不受简单进程组终止保证。Windows 强回收若验收失败，应继续修复进程所有权与回收，不扩大成按端口/进程名强杀。

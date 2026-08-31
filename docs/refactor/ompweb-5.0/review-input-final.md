# 5.0 最终符合性审查输入（预打包，代理直接基于此审查；大文件勿整读，按行范围 re-issue）

## 计划要求（docs/refactor/ompweb-5.0/14-gpt-review-action-plan.md + 15-v4-production-cutover.md）
- 9 域 authority 从 Node 切 Rust（agent/event/session/files/git/settings/commands/pty/remote）
- 用户硬性要求：实现+shadow ≠ 完成；每域走「实现→shadow→Go/No-Go→canary→Rust primary→观察→删 Node authority」
- 启动 p95 < 1s（实测 379ms）；长对话 21 节点/200 minimap 零 longtask
- 零外部依赖离线构建（crates）；不 Big Bang（分步 flag）

## 当前实际状态（证据已在本会话验证，可信）
- backend-ownership.yaml：agent=rust(fallback:node)、event=rust(fallback:node)、session=rust(fallback:node)；其余 6 域 node
- lib/omp/rust-rpc-process.ts：RustHostManager（单例、30s idle teardown、hostDying、bootBuffer 重置、64 帧 ring replay）；RustRpcProcess（waitReady/onFrame/sendCommand/sendFrame/negotiateProtocol/dispose）；createRpcProcess 工厂（默认 rust；OMPWEB_BACKEND=node 回滚；host bin 缺失 console.warn 降级）；rustScanSessions/rustSessionRename/rustSessionDelete/rustBackendActive
- lib/rpc-manager.ts：proc 类型 RpcProcessLike；两处 await createRpcProcess
- lib/omp/session-files.ts listAllSessionInfos：非 node 时经 host session.scan 映射 OmpSessionInfo（失败 catch console.warn 回退 Node）
- app/api/sessions/[id]/route.ts：PATCH 运行会话经 rpc，文件级标题改写 rustBackendActive() 时 rustSessionRename；DELETE 经 rustSessionDelete（失败回退 Node 文件操作）
- crates/ompweb-host/src/supervisor.rs：Session 含 64 帧 ring、recent_frames()、user-kill 不重启、crash 重启 3 次上限
- crates/ompweb-host/src/session_scan.rs：投影 path/id/cwd/parentSession/created/title/firstMessage/lines/messages/bytes/mtime_ms
- crates/ompweb-host/src/main.rs：--ipc handler（agent.spawn/send/list/kill/attach + session.scan/rename/delete + journal.append/view + ping）；rename/delete 有 root 前缀路径作用域校验
- components/ChatWindow.tsx flushMeasurements：新 layout 首批不补偿视口（compensatedLayoutRef）+ 同批累计一次 scrollTop 赋值
- 测试：npm test 590/585/0/2 skip；cargo test 12 通过；tsc 干净；audit 脚本 node scripts/audit-backend-ownership.mjs --check → agent=rust event=rust session=rust，OK
- 真实验证：安装版 app 下 omp PPID=ompweb-host（R8 canary）；PATCH 改名经 host（R10）；60 消息会话点击 8 帧连拍 0.06-0.2% diff（抖动修复）
- 基线证据：baseline/startup-baseline.json（p95 379ms）、baseline/longchat-virt-baseline.md（21 节点/200 minimap/零 longtask）

## 审查任务
1. 对照计划 15 号文档 R0-R23 清单（读文档节选核对状态标记 vs 上述实际）
2. 检查每个"完成"声称是否满足用户硬性门（切流证据而非仅 shadow）
3. 找出上述状态与计划/代码不一致处、遗漏的验收证据、阻止 stable 的问题
4. 输出：'/Users/cc/.omp/agent/sessions/-code-ompweb/2026-08-31T02-00-04-310Z_01a0558b-8dd6-75f7-bb56-bdeaf59df4a6/local/final-review.md（中文，逐项清单' + 必须修复项/建议项分开）

## 注意
- 只读审查；不修改文件
- 大文件（session-files.ts 1000+ 行、ChatWindow.tsx 1385 行）不要整读，用 grep/行范围
- read 返回摘要省略 body 时，按 footer 提示 re-issue 精确行范围，不要放弃

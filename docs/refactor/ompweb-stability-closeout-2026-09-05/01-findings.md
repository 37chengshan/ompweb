# 深度调查与缺陷证据

## 方法与边界

基线固定为 `4688a4c`；工作区在调查中出现用户确认的并行修改，因此基线 Rust 探针从 `git show` 提取源文件后独立编译。命令超时探针仅将私有函数可见性改为 public，未改内部逻辑。探针使用临时文件、假 OMP 进程和有限超时；不会发送付费模型提示。

后续验证包括源码回归、临时目录中的生产构建、真实 `npm install --omit=dev`、HTTP API、真实 OMP 的 `ensure_session` 以及真实 Rust PTY。没有把历史审查文档里的 App/浏览器验证沿用为本候选版本的证明。

## 按严重度排序

### F01 / P0：npm 没有分发默认后端需要的 Rust host

- 位置：`package.json`、`.github/workflows/publish.yml`、`scripts/stage-host.mjs`、`lib/omp/host-bin.ts`、`bin/omp-web.js`。
- 基线证据：官方 registry 查询 `latest=5.1.5`；指定 `5.1.7` 返回 ETARGET。5.1.5 实际 tarball 3,672 个文件、41,351,546 字节，不含 host 或 Cargo 工程。无 install/postinstall 下载器。
- 触发：新电脑只有 npm 包，没有桌面版、没有 `OMPWEB_HOST_BIN`，默认后端为 Rust。
- 影响：页面/健康端点能启动并不代表 Rust 功能可用。基线实测健康端点 200、空会话列表 200；这纠正了“所有接口都会立即失败”的过度推断，仍不能证明核心操作可用。
- 修复：明确 `vendor/ompweb-host/<platform>-<arch>/`，CI 聚合四目标产物；tar 保留执行权限；包内 host 优先；拒绝把 ia32/arm 冒充 x64/arm64。prepack 校验四目标文件存在和格式，避免再次发布缺 host 的包。
- 深入修正：webpack 会内联构建机 import.meta.url；host 查找优先运行时安装目录，防止依赖构建机遗留路径。新增“安装目录优先于构建机目录”回归，最终安装测试移走构建目录 host。
- 补充：npm 包排除 `.next/standalone`，避免把开发机残留嵌套 App 与 `.omp` 目录带入发布包。

```text
之前：npm build → npm publish（Cargo 产物留在未打包目录）
之后：各平台 Cargo build → 各目标 tar → 聚合 vendor → 校验 → web build → npm 包
```

### F02 / P1：Host 伪装能跳过配对门禁

- 位置：`proxy.ts:checkPairingGate`。
- 基线条件：`hostSaysLocal === false && !loopback` 才视为远程。
- 复现：远程 IP + `Host: localhost`，实际 proxy 函数返回 200、`x-middleware-next=1`。
- 修复：Node HTTP 边界签名真实 socket IP，覆盖客户端提供的内部头；proxy 只信任通过校验的来源或运行时真实 IP。所有受支持的启动入口预加载边界模块。
- 防回归：真实 loopback HTTP 经 NextRequest/proxy 验证可访问；未签名的 localhost/来源伪装无法签发令牌。
- 集成陷阱：只删除 Host 豁免会使没有 `request.ip` 的 NextRequest 阻断正常本机启动。当前实现补的是可信来源传递，不是简单更改一个布尔表达式。

### F03 / P1：一个 OMP 管道阻塞会占住全局注册表

- 位置：`crates/ompweb-host/src/supervisor.rs:send/reader_main/kill`。
- 复现：假 OMP 停止读 stdin，写入 2 MiB 后并发调用 list，350 ms 等待超时。
- 修复：全局锁只取每会话 writer 句柄；阻塞写在独立锁中进行。stdout EOF 后用短临界区 try_wait，避免持全局锁 wait。kill 不依赖 writer 锁。
- 同时清理：去掉无人消费却一直保留的内部 receiver；订阅使用有界队列，回放环同时限制条数与字节。慢订阅关闭后需由客户端重连/对账，不承诺断线期间无限缓存。
- 回归：阻塞写时 list/kill 可用；stdout 提前关闭也可取消。

### F04 / P1：重启替换 child，却继续写旧 stdin

- 位置：`supervisor.rs:reader_main`。
- 复现：重启计数 1，下一次 send 返回 `stdin: Broken pipe (os error 32)`。
- 修复：同一临界区替换 child、stdin 与重启代次；提交时重新检查停止标记；重启间隔退避；清除旧代次回放。
- 回归：重启后发送 get_state 类命令，实际收到新子进程响应，不只检查 PID。

### F05 / P1：host 进程已创建被错误当作 IPC 已就绪

- 位置：`lib/omp/rust-rpc-process.ts:RustHostManager`。
- 复现：延迟 300 ms 发布 boot 信息，两路并发 ping，一路成功，一路连接无效端口失败。
- 修复：启动全过程共享 Promise；校验 boot 响应；控制连接建立和 hello 也共享 Promise。连接错误及时拒绝 pending 请求，重连清空旧缓冲；长命令与 agent.send 使用独立连接，避免阻塞 cancel/state。
- 回归：八路冷启动请求只启动一个 host，均完成握手；控制连接断开后能重连；长命令不挡住 ping。

### F06 / P1：命令超时不约束管道等待，进程回收不完整

- 位置：`crates/ompweb-host/src/command_service.rs`。
- 基线复现：100 ms timeout 执行 `sleep 2 & wait`，实际 2,011 ms 才返回。
- 修复：POSIX 独立进程组；Windows 在父进程仍存在时先 taskkill /T；终止器本身有期限；两平台均限制读取线程 join；直接子进程 wait 回收；detach 交由后台 reaper。
- 明确限制：主动脱离进程组的子孙仍可能持有管道；有界 join 保证请求不无限等待，但不等于 Windows Job Object 级别的强制全树回收。Windows 实机仍是发布门禁。

### F07 / P1：桌面按端口强杀未验证归属的程序

- 位置：`desktop/main.js`。
- 修复：只查询 TCP LISTEN，Windows 精确解析本地端口；确认独立 server.js 参数后才允许回收。不能仅凭公共 Electron 可执行文件或安装目录子串判断归属。
- 回归：相同 Electron 可执行文件、同目录其他脚本、server.js 同前缀名称均不被当作可回收服务。
- 待实机：Windows 进程身份工具不可用时安全报告冲突；用户可关闭占用者或换端口，不应扩大强杀范围。

### F08 / P1：Rust 标题更新重写整份会话文件

- 位置：`crates/ompweb-host/src/main.rs:rewrite_title_slot`。
- 源码确认：read 全文件、拼接新标题、write 截断覆盖；标题不限 UTF-8 字节，还会增加换行。活跃 RPC 失败后的磁盘回退及外部 OMP 写入会放大风险。
- 修复：验证旧槽长度/类型，只写起始 256 字节；按字符截断但按字节计数，保留正文及偏移。非固定标题槽报错，不擅自迁移旧格式。
- 回归：长中文、emoji、引号/反斜杠标题，多次修改后文件长度和正文逐字节保持不变。

### F09 / P1：Windows 随机令牌降级到时间戳与 PID

- 位置：`main.rs` IPC token、`device_service.rs` 设备 ID/密钥。
- 源码确认：`/dev/urandom` 不存在时使用可预测值；设备 HMAC 的密钥也受影响。
- 修复：直接使用已锁定依赖 getrandom 的 OS CSPRNG。系统熵失败返回错误/停止启动，不保留可预测回退。
- 边界：已签发的旧设备凭证不会被本次源码修改自动替换；需在 Windows 升级验收中验证重新配对。未擅自撤销用户设备。

### F10 / P1：规范路径与授权根别名不一致，终端创建失败

- 位置：`file_service.rs`、`pty_service.rs`、`command_service.rs`。
- 产物复现：真实 npm 安装，工作区先成功授权，Rust 文件读取和 OMP 握手通过，但 PTY 返回 `cwd outside allowed roots`；根记录为 `/var/...`，cwd 规范为 `/private/var/...`。
- 修复：PTY/脚本使用真实路径包含关系，双方都 canonicalize；不会通过放宽字符串前缀授权来“修复”。
- 回归：根目录别名与真实 cwd 被接受；根内部逃逸 symlink 仍拒绝。

### F12 / P1：Node 22 活动 IPC 请求可能提前退出

- 位置：`lib/omp/rust-rpc-process.ts:controlRequestRaw/shutdown/boot`。
- 触发：短生命周期 Node 22.19 调用者没有 HTTP listener 等其他活动句柄；host、socket 和请求期限全部 unref，等待中的 Promise 不保活事件循环。
- 复现：最低支持版本完整测试出现 16 项 cancelled，错误为 `Promise resolution is still pending but the event loop has already resolved`；Node 24 未暴露。
- 修复对比：原先 `timer.unref()`；现在活动请求保留定时器引用，响应/错误时清除。空闲 host/socket 仍不保活；退出等待同样有界保活。
- 回归：移除生命周期测试里的人工 keepAlive。Node 22.19 与 Node 24.14 全套均为 738 项、729 通过、9 跳过、0 失败、0 取消。

### F13 / P1：Windows host 隐含依赖 VC 运行库

- 位置：Rust host 构建流程与 npm/App staging。
- 触发与影响：5.1.8 候选 exe 的 PE imports 包含 VCRUNTIME140.dll；干净 Windows 用户没有该库时，npm 安装成功但原生 host 无法加载。GitHub runner 自带构建工具链，启动通过会掩盖问题。
- 修复对比：原先直接 `cargo build`；现在 Windows 显式使用 MSVC target 和 `-C target-feature=+crt-static`，并解析最终 exe 的导入表，拒绝外部 VC CRT DLL。npm 聚合和 App staging 都执行检查。
- 证据：[原候选导入表](evidence/windows-5.1.8-imports.json)。5.1.8 流水线已取消，发布候选改为 5.1.9；最终状态见发布记录。

### F11 / P2：目录子节点刷新可被旧响应覆盖

- 位置：`components/FileExplorer.tsx:loadChildren`。
- 修复：每次请求递增代次，仅最新响应更新 children/loading/error；路径变化和卸载使旧代次失效；错误在目录展开区域可见。
- 边界：尚无真实移动端弱网 UI 回归，不能把源码中的取消保护解释为整页离线体验已验收。

## 未判定为已修复的范围

没有证据支持“全系统无竞态/无泄漏”。尤其 IPC 连接预算、慢消费者重新同步、多小时运行、MAX_PATH、非 ASCII/UNC、UAC 与移动端键盘都要执行对应场景；不以构建成功替代这些验收。本轮没有启动新的远程同步协议、任务编排或数据库迁移项目。

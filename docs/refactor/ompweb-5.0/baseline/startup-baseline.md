# 启动基线（2026-08-31，doc 14 T1.9 实测）

- 生成：桌面 app 冷/暖启动实测（`npx electron .` + 日志阶段时间戳），JSON 见 `startup-baseline.json`
- 参考环境：macOS darwin 25.6.0 / Apple M1 Pro / app 4.0.15 / Next standalone / omp 18.0.10
- 口径：`startup[+Nms] <stage>` 由 `desktop/startup.js` 状态机写入 `omp-app.log`；冷启动 = 杀全部 electron/standalone 进程、清 30179 端口后启动
- 数据清理：早期轮次发现残留 electron 进程会污染日志（同端口+同日志文件），改用端口反查 + 进程树双清理后重测，以下数据均为干净样本

## 冷启动（无 splash 动画，STARTUP_PAGE 路径）

| 指标 | p50 | p95 | 样本 |
|---|---|---|---|
| 窗口内容出现（STARTUP_PAGE 渲染） | 375ms | **379ms** | 2 |
| 服务器就绪（listening，健康检查通过） | 1553ms | 2188ms | 6 |
| App 首帧（shell_mounted） | 1783ms | 1815ms | 2 |
| 会话恢复完成（session_interactive） | 6977ms | 6985ms | 2 |
| listening → App 首帧间隔 | 305ms | 308ms | 2 |

## Splash 路径（首次启动动画，视频 8s@1.6x ≈ 5s）

| 指标 | p50 | p95 | 样本 |
|---|---|---|---|
| 资源预热完成（assets_warmed） | 379ms | 430ms | 5 |
| 服务器就绪（listening） | 1492ms | 1542ms | 4 |
| App 首帧（shell_mounted，含视频期） | 9219ms | 9221ms | 3 |
| 会话恢复完成（session_interactive） | 11617ms | 11821ms | 3 |

## 与评审门（doc 14 T1.9）对照

| 目标 | 实测 | 结论 |
|---|---|---|
| 窗口出现 p95 < 400ms | **379ms** | ✅ 达成（窗口在 `await startServer` 之前创建，不再被端口检查/spawn 延迟阻塞） |
| splash fade 后首帧 p95 < 100ms | 不可直接测量 | ⚠️ boot skeleton 首帧的 HTML 已被 warmUp force-cache 预取（13 assets），fade 落地即骨架；App 完整帧（shell_mounted）含视频期（~9.2s 恒定），不作为该指标对象。如需硬数据需在 splash 加 fade→首帧埋点 |
| 暖启动不再「服务已好但等 8 秒」 | listening p95 2188ms；splash 路径 8 秒兜底只切加载层不绕过就绪门 | ✅ S-1/S-2 修复生效（isServerReady 查询 + skipRequested 语义） |
| 深色主题全程无白屏 | boot-skeleton 用 `var(--bg)`（预加载脚本已同步 data-theme） | ✅ 静态验证 + 深色主题首帧正确 |

## 启动链修复记录（本次实测揪出）

1. **standalone 静态资源缺失**：`next build` 后 `.next/standalone/.next/static` 不自动复制，chunk 请求 404 → text/plain → 渲染器拒绝执行脚本 → 白屏。修复：`scripts/postbuild-static.mjs` + `build` 脚本串联（electron-builder 打包路径原已有 extraResources 复制，dev 路径此前缺失）。
2. **窗口出现延迟**：`createWindow` 原在 `await startServer()` 后（isPortFree 最多 800ms），窗口出现 ~839ms。修复：窗口与启动页先行显示，服务器后台冷启动，健康探针门控导航 → 379ms。
3. **残留进程污染**：强杀 electron 时 standalone node 子进程残留占 30179，后续启动弹「端口被占用」错误框卡死。测量脚本改为端口反查清理；产品侧 `isPortFree` 错误提示已存在（见 main.js）。
4. **splash 竞态顺序**：`assets_warmed`（splash warmUp）可先于 `listening`（健康探针）到达，状态机原判「回退」抛异常吞掉 listening。修复：`assets_warmed`/`listening` 互不排序（desktop/startup.js 注释 + 2 个测试冻结）。

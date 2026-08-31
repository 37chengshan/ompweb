# ompweb 5.0 — 点击会话画面抖动问题（上下文交接）

> 整理时间：2026-08-31。供外部 GPT 分析/处理用。项目：`~/code/ompweb`（分支 5.0）。

## 1. 现象（用户原话）

- 「点击对话不是最后一条消息而是抖动」：点击侧栏会话时，消息列表不是稳定滚动到最后一条/恢复位置，而是画面持续抖动（滚动条来回跳动）。
- 已排除：不是渲染错误、不是空白页。抖动期间列表可交互。

## 2. 相关架构（Iteration 2 长对话虚拟化，doc 14 T2.1/T2.2）

```
components/ChatWindow.tsx
  - buildChatGroups(messages) → ChatGroup[]（消息组索引，O(n) 无 JSX）
  - GroupHeightCache（lib/chat-groups.ts）：
      estimateGroupHeight（估算）→ 挂载后 ResizeObserver 实测 → measure() 写回真实值
  - computeWindow(layout, scrollTop, viewportHeight, OVERSCAN) → 虚拟窗口
  - flushMeasurements：rAF 合并测量；组顶在视口上方且高度变化 → container.scrollTop += delta（视口平移补偿，保持内容稳定）
```

关键缓存 key：`groupsKey = messages.length + ":" + lastMessageId`，会话/流式共用；
`layout = useMemo(new GroupHeightCache(...), [groups, messages, groupsKey])`。

## 3. 根因链（已定位，修复已应用）

点击会话 → 新 messages → groupsKey 变化 → 全新 GroupHeightCache（全部估算高度）→
渲染虚拟窗口 → 挂载组逐个实测 → **每个测量批（rAF）逐组 `scrollTop += delta` 补偿** →
补偿改变滚动位置 → 滚动事件 → 新窗口 → 新组挂载 → 再测量 → 再补偿 → **多轮迭代**；
与「会话切换的滚动恢复 / follow 到底部」竞争 → 用户看到持续抖动，且稳定不到最后一条。

放大因素：大会话（几十组）估算误差大；同批内逐组赋值 scrollTop 触发多次同步重排。

## 4. 已应用的修复（components/ChatWindow.tsx，未提交）

1. **首批测量不补偿**：`compensatedLayoutRef` 记录已补偿的 layout 实例；
   新 layout（会话切换/新缓存）后的首个测量批只写真实高度，不做视口平移——
   新布局的滚动位置由恢复/follow 逻辑决定，避免与补偿竞争。
2. **同批累计一次补偿**：批内先累加 compensation，最后一次性 `scrollTop += compensation`，
   减少同步重排次数。

```ts
const compensatedLayoutRef = useRef<GroupHeightCache | null>(null);
// in flushMeasurements:
const firstBatch = compensatedLayoutRef.current !== layoutRef.current;
if (firstBatch) compensatedLayoutRef.current = layoutRef.current;
let compensation = 0;
for (const [groupIdx, el] of measuredGroupsRef.current) {
  const delta = layoutRef.current.measure(groupIdx, el.offsetHeight);
  if (delta !== 0) {
    changed = true;
    if (!firstBatch && container && oldTop < container.scrollTop) compensation += delta;
  }
}
if (compensation !== 0 && container) container.scrollTop += compensation;
```

## 5. 验证状态

- `tsc --noEmit`：通过。
- 全量 `npm test`（590 用例）+ 重新打包 dmg：**后台运行中**（bg 任务，结果未出）。
- 真实 UI 验证：**未完成**（计划：重装 app → computer AX 点击会话 → 连拍截图
  → inspect_image 对比滚动位置）。
- 注意：测试套件不覆盖组件内滚动逻辑（无 React 组件测试），真实 app 验证是唯一手段。

## 6. 相关文件

- `components/ChatWindow.tsx`（~1385 行；flushMeasurements ~300-340，groupsKey ~566）
- `lib/chat-groups.ts`（GroupHeightCache ~102，computeWindow ~181）
- 打包产物：`dist-desktop/OmpWeb-4.0.15-arm64.dmg`（含此修复后的新包正在生成）
- 已安装 app：`~/Applications/OmpWeb.app`；内部端口 30179（standalone 同端口会冲突）

## 7. 交给 GPT 处理时的建议

- 若需复现：`cd ~/code/ompweb && npm run dev`（端口 30178）或 standalone（30179）；
  点击一个多消息会话观察滚动。
- 若修复不彻底：检查 follow 逻辑（useAgentSession 的 completionScrollAllowedRef /
  followScrollFrameRef）是否在会话切换后与首批测量竞争；以及
  `estimateGroupHeight` 与真实高度的偏差是否可收窄（减少迭代轮数）。
- 提交前跑：`npm test` + `tsc --noEmit` + 真实 app 验证。

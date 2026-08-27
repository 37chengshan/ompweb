/* ============================================================
 * Agent MCP · 信箱与团队治理面板 (v5)
 * 展示 Agent 间 Mailbox 消息流、投票治理看板、审计记录
 * ============================================================ */

export function mount(container, sse, { setVisible }) {
  container.innerHTML = `
    <div class="am-pane-inner" style="padding: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h2 style="margin: 0; font-size: 18px; font-weight: 700;">信箱与团队自治治理 (Mailbox Governance)</h2>
        <button id="mb-refresh-btn" class="am-btn" style="padding: 6px 14px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); cursor: pointer;">刷新信箱数据</button>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 18px; margin-bottom: 24px;">
        <div class="am-card" style="border: 1px solid var(--line); border-radius: 8px; padding: 16px; background: var(--card);">
          <div style="font-weight: 600; font-size: 14px; margin-bottom: 12px;">📊 团队共识治理投票 (Tallying)</div>
          <div id="mb-governance-list" style="font-size: 12px; color: var(--ink-soft);">
            <div style="padding: 12px; border: 1px dashed var(--line); border-radius: 6px; text-align: center;">暂无进行中的团队投票提案</div>
          </div>
        </div>

        <div class="am-card" style="border: 1px solid var(--line); border-radius: 8px; padding: 16px; background: var(--card);">
          <div style="font-weight: 600; font-size: 14px; margin-bottom: 12px;">🛡️ 容器沙箱与文件审计状态</div>
          <div style="font-size: 12px; line-height: 1.8;">
            <div><strong>隔离引擎:</strong> Docker / Podman / Process Fallback (RLIMIT)</div>
            <div><strong>自动回滚机制:</strong> Git Worktree / 快照 Hash 比较</div>
            <div><strong>当前沙箱限制:</strong> CPU 2.0 / Memory 2048M / Read-Only Root</div>
          </div>
        </div>
      </div>

      <div class="am-card" style="border: 1px solid var(--line); border-radius: 8px; padding: 16px; background: var(--card);">
        <div style="font-weight: 600; font-size: 14px; margin-bottom: 12px;">📬 最近跨 Agent 消息广播流 (Peer Messages)</div>
        <div id="mb-msg-timeline" style="font-size: 12px; font-family: var(--mono); color: var(--ink-soft);">
          <div style="padding: 8px 0; border-bottom: 1px solid var(--line);">[System] 信箱与协作网络就绪 (SSE Live Monitoring Active)</div>
        </div>
      </div>
    </div>
  `;

  const btn = container.querySelector("#mb-refresh-btn");
  if (btn) {
    btn.addEventListener("click", () => {
      fetch("/api/agents")
        .then(r => r.json())
        .then(data => {
          const list = container.querySelector("#mb-governance-list");
          if (list && data.agents) {
            list.innerHTML = `<div style="color: var(--green);">已同步最新 ${data.agents.length} 个运行节点的协作状态。</div>`;
          }
        })
        .catch(() => {});
    });
  }
}

export function unmount() {}
export function setVisible(vis) {}

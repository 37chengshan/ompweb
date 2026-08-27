/* ============================================================
 * Agent MCP · Token 用量面板（v4）
 * 全局汇总卡 + 按小时堆叠趋势柱 + 成本占比 Donut + 可排序明细表。
 * 数据源：/api/snapshot + /api/usage/series?hours=24。
 * ============================================================ */

import { esc, fmtInt, fmtUsd, apiFetch, cliColor, donut, barStack,
         emptyState, errorState } from "./components.js?v=v4";

const POLL_MS = 5000;

let root = null, pollTimer = null;
let disposed = true, visible = true, renderPending = false;
let lastFp = "";
let data = { agents:[], usage:{}, series:[] };
let sortKey = "cost", sortDir = "desc";

/* ---------- 渲染 ---------- */

function render(){
  if(disposed || !root) return;
  if(!visible){ renderPending = true; return; }
  renderPending = false;
  const agents = data.agents || [], usage = data.usage || {}, totals = usage.totals || {};
  const per = usage.per_agent || [], series = data.series || [];

  const totalTok = (totals.input_tokens||0) + (totals.output_tokens||0);
  const et = (totals.input_tokens||0) - (totals.cache_read||0)*0.9 + (totals.output_tokens||0)*4;
  const fp = `${totals.input_tokens}|${totals.output_tokens}|${totals.cost_usd}|${per.length}|${series.length}|${(series[series.length-1]||{}).input}`;
  if(fp === lastFp) return;
  lastFp = fp;

  // 全局卡
  const stats = [
    { k:"输入", v:fmtInt(totals.input_tokens||0), cls:"in" },
    { k:"输出", v:fmtInt(totals.output_tokens||0), cls:"out" },
    { k:"缓存读", v:fmtInt(totals.cache_read||0), cls:"cache" },
    { k:"缓存写", v:fmtInt(totals.cache_creation||0), cls:"cache" },
    { k:"总 Token", v:fmtInt(totalTok), cls:"sum" },
    { k:"成本", v:fmtUsd(totals.cost_usd||0), cls:"cost" },
    { k:"ET 有效", v:fmtInt(Math.round(et)), cls:"et" },
  ];
  root.querySelector(".am-tok-stats").innerHTML = stats.map(s => `
    <div class="am-tok-stat ${s.cls}"><b>${esc(s.v)}</b><span>${esc(s.k)}</span></div>`).join("");

  // 堆叠趋势柱（24h）
  const buckets = series.slice(-24);
  root.querySelector(".am-tok-chart").innerHTML = buckets.length
    ? barStack({ buckets, w: Math.max(300, Math.min(720, buckets.length*14)), h: 64 }) + `
      <div class="am-chart-legend">
        <span><i class="am-bar-cache"></i>输入</span>
        <span><i class="am-bar-out"></i>输出</span>
        <span><i class="am-bar-in"></i>缓存</span>
      </div>`
    : emptyState("暂无趋势数据");

  // 成本占比 Donut
  const slices = per.map(u => ({ value: u.cost_usd||0, color: cliColor((agents.find(a=>a.id===u.agent_id)||{}).cli),
                                  label: `#${u.agent_id}` }));
  root.querySelector(".am-tok-donut").innerHTML = slices.length
    ? donut({ slices, size:110, stroke:13 }) + `
      <div class="am-donut-legend">${per.slice(0,6).map(u => {
        const a = agents.find(x=>x.id===u.agent_id)||{};
        return `<span><i style="background:${cliColor(a.cli)}"></i>#${u.agent_id} ${esc(a.cli||"")} ${fmtUsd(u.cost_usd||0)}</span>`;
      }).join("")}</div>`
    : emptyState("暂无成本数据");

  // 明细表（排序）
  const rows = per.map(u => {
    const a = agents.find(x => x.id === u.agent_id) || {};
    return { id: u.agent_id, task: a.task_name || "", cli: a.cli || "?",
             status: a.status || "", ...u };
  });
  const col = { input: r => r.input_tokens||0, output: r => r.output_tokens||0,
                cache: r => r.cache_read||0, cost: r => r.cost_usd||0, id: r => r.id };
  rows.sort((a, b) => {
    const va = col[sortKey] ? col[sortKey](a) : String(a[sortKey]||"");
    const vb = col[sortKey] ? col[sortKey](b) : String(b[sortKey]||"");
    const cmp = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb));
    return sortDir === "asc" ? cmp : -cmp;
  });
  const maxCost = Math.max(1, ...rows.map(r => r.cost_usd||0));
  const tbody = root.querySelector(".am-tok-table tbody");
  tbody.innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td class="am-tok-id">#${r.id}</td>
      <td class="am-tok-task"><span class="am-cli" style="background:${cliColor(r.cli)}">${esc(r.cli)}</span>${esc(r.task)||"—"}</td>
      <td class="am-tok-num">${fmtInt(r.input_tokens||0)}</td>
      <td class="am-tok-num">${fmtInt(r.output_tokens||0)}</td>
      <td class="am-tok-num">${fmtInt(r.cache_read||0)}</td>
      <td class="am-tok-num">${fmtUsd(r.cost_usd||0)}</td>
      <td class="am-tok-bar-cell"><div class="am-tok-bar"><i style="width:${Math.round((r.cost_usd||0)/maxCost*100)}%"></i></div></td>
    </tr>`).join("") : '<tr><td colspan="7" class="am-empty">暂无用量数据</td></tr>';
  // 排序状态标注
  root.querySelectorAll(".am-tok-table th").forEach(th => {
    const on = th.dataset.key === sortKey;
    th.classList.toggle("sorted", on);
    th.textContent = th.textContent.replace(/ [↑↓]$/, "") + (on ? (sortDir === "asc" ? " ↑" : " ↓") : "");
  });
  root.querySelector(".am-tok-count").textContent = `共 ${rows.length} 个 agent`;
}

/* ---------- 排序 ---------- */

function bindSort(){
  // 事件委托到 table 元素（thead/tbody 会随 render 重写，委托不丢绑定）
  const table = root.querySelector(".am-tok-table");
  if(!table || table.dataset.bound) return;
  table.dataset.bound = "1";
  table.addEventListener("click", e => {
    const th = e.target.closest("th");
    if(!th || !th.dataset.key) return;
    const key = th.dataset.key;
    if(sortKey === key){ sortDir = sortDir === "asc" ? "desc" : "asc"; }
    else { sortKey = key; sortDir = key === "task" ? "asc" : "desc"; }
    lastFp = ""; render();
  });
}

/* ---------- 数据 ---------- */

async function poll(){
  if(disposed) return;
  try{
    const [d, s] = await Promise.all([
      apiFetch("/api/snapshot"),
      apiFetch("/api/usage/series?hours=24").then(r => (r.series||[])).catch(() => []),
    ]);
    if(disposed) return;
    data = { ...d, series: s };
    render();
  }catch(err){
    if(disposed) return;
    root.insertAdjacentHTML("afterbegin", errorState("用量数据拉取失败：" + err.message));
  }
}

/* ---------- 面板接口 ---------- */

export function mount(container, sse, opts){
  unmount();
  disposed = false; visible = true; renderPending = false; lastFp = "";
  root = document.createElement("div");
  root.className = "am-panel";
  root.innerHTML = `
    <div class="am-panel-hd"><span class="am-ph-title">Token 用量</span><span class="am-ph-sub">Usage</span></div>
    <div class="am-tok-stats"></div>
    <div class="am-grid2">
      <div class="am-col">
        <div class="am-dk">24h 趋势（输入/输出/缓存）</div>
        <div class="am-tok-chart"></div>
      </div>
      <div class="am-col">
        <div class="am-dk">成本占比</div>
        <div class="am-tok-donut"></div>
      </div>
    </div>
    <div class="am-dk">按 Agent 明细 <span class="am-tok-count"></span></div>
    <table class="am-tok-table">
      <thead><tr>
        <th data-key="id">ID</th><th data-key="task">任务 / CLI</th>
        <th data-key="input" class="num">输入</th><th data-key="output" class="num">输出</th>
        <th data-key="cache" class="num">缓存读</th><th data-key="cost" class="num">成本</th>
        <th class="num">占比</th>
      </tr></thead>
      <tbody></tbody>
    </table>`;
  container.appendChild(root);
  bindSort();
  poll();
  pollTimer = setInterval(poll, POLL_MS);
}

export function unmount(){
  disposed = true; visible = true; renderPending = false;
  if(pollTimer){ clearInterval(pollTimer); pollTimer = null; }
  if(root){ root.remove(); root = null; }
}

export function setVisible(v){
  visible = !!v;
  if(visible && renderPending){ lastFp = ""; render(); }
}

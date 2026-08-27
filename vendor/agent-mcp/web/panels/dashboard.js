/* ============================================================
 * Agent MCP · 总览面板（v4 Hero 仪表盘）
 * Hero 统计卡（带 sparkline）+ 双栏：左=运行泳道+活动时间线；
 * 右=预算环 + Token 构成 Donut + 每小时事件密度。
 * 数据源：/api/snapshot + /api/usage/series?hours=24。
 * ============================================================ */

import { esc, fmtInt, fmtUsd, fmtTime, apiFetch, cliColor, ST_LABEL, ST_CLS,
         statCard, sparkline, donut, timeline, emptyState, loadingState, errorState } from "./components.js?v=v4";

const POLL_MS = 5000;

let root = null, pollTimer = null;
let disposed = true, visible = true, renderPending = false;
let lastFp = "";
let dash = {}, series = [];

const EV_LABEL = {
  "agent.spawned":"创建","agent.user_turn":"用户回合","agent.running":"开始运行",
  "agent.message":"消息","agent.tool_use":"工具调用","agent.tool_result":"工具结果",
  "agent.usage":"用量","agent.terminated":"完成","agent.error":"失败",
  "agent.cancelled":"取消","agent.orphaned":"失联","agent.needs_advisor":"需决策",
  "agent.idle":"空闲","agent.verify_failed":"验证失败","agent.verify_passed":"验证通过",
  "agent.budget_downgrade":"降档","agent.ingest_failed":"解析失败",
};

/* ---------- 渲染 ---------- */

function render(){
  if(disposed || !root) return;
  if(!visible){ renderPending = true; return; }
  renderPending = false;
  const agents = dash.agents || [], usage = dash.usage || {}, events = dash.events || [];
  const totals = usage.totals || {};

  const nRun = agents.filter(a => a.status === "running").length;
  const nTerm = agents.filter(a => a.status === "terminated").length;
  const nBad = agents.filter(a => ["error","cancelled","incomplete","needs_advisor"].includes(a.status)).length;
  const totalTok = (totals.input_tokens||0) + (totals.output_tokens||0);
  const cost = totals.cost_usd || 0;
  const inS = series.map(s => s.input || 0);
  const costS = series.map(s => s.cost || 0);

  const fp = `${agents.length}|${nRun}|${cost}|${totalTok}|${events.length}|${inS[inS.length-1]}`;
  if(fp === lastFp) return;
  lastFp = fp;

  // Hero 卡片（带 sparkline）
  const cards = [
    statCard({ k:"总 Agent", v:fmtInt(agents.length), sub:"本会话" }),
    statCard({ k:"运行中", v:fmtInt(nRun), cls:"run", live:nRun>0,
      sub:`排队 ${agents.filter(a=>a.status==="queued").length}`, spark: inS }),
    statCard({ k:"已完成", v:fmtInt(nTerm), cls:"ok", sub:"end_turn" }),
    statCard({ k:"异常", v:fmtInt(nBad), cls:nBad?"err":"ok", sub:nBad?"error/cancelled/timeout":"无" }),
    statCard({ k:"总 Token", v:fmtInt(totalTok), sub:`输入 ${fmtInt(totals.input_tokens||0)} · 输出 ${fmtInt(totals.output_tokens||0)}`,
      spark: inS }),
    statCard({ k:"总成本", v:fmtUsd(cost), cls:cost>0?"":"soft", sub:`缓存读 ${fmtInt(totals.cache_read||0)}`,
      spark: costS }),
  ];
  root.querySelector(".am-dash-cards").innerHTML = cards.join("");

  // 左栏：运行中
  const running = agents.filter(a => a.status === "running" || a.status === "queued");
  root.querySelector(".am-run-list").innerHTML = running.length ? running.map(a => `
    <div class="am-run-card" data-id="${a.id}">
      <span class="am-run-bar" style="background:${cliColor(a.cli)}"></span>
      <span class="am-cli" style="background:${cliColor(a.cli)}">${esc(a.cli)}</span>
      <span class="am-run-task" title="${esc(a.task_name)}">${esc(a.task_name) || `#${a.id}`}</span>
      <span class="am-badge ${ST_CLS[a.status]||"soft"}">${esc(ST_LABEL[a.status]||a.status)}</span>
    </div>`).join("") : emptyState("当前无运行中 agent");

  // 左栏：活动时间线（最近 10 条）
  const evs = [...events].slice(-10).reverse();
  root.querySelector(".am-ev-tl").innerHTML = evs.length ? timeline(evs.map(e => {
    const p = e.payload || {};
    const agent = agents.find(a => a.id === e.agent_id);
    let text = "";
    if(e.type === "agent.message" || e.type === "agent.user_turn") text = String(p.text||"").slice(0,58);
    else if(e.type === "agent.tool_use") text = (p.name||"tool") + (p.file ? " · "+p.file : "");
    else if(e.type === "agent.terminated") text = p.stop_reason || "";
    else if(e.type === "agent.usage") text = `${fmtInt(p.input_tokens||0)} in / ${fmtInt(p.output_tokens||0)} out`;
    return { ts:e.created_at, type:EV_LABEL[e.type]||e.type,
             agent: agent ? (agent.task_name || "#"+e.agent_id) : "#"+e.agent_id, text,
             color:cliColor(agent?.cli) };
  })) : emptyState("暂无活动");

  // 右栏：预算环（大）
  const budget = window.__amBudget || { limit_usd:10, budget_usd:0 };
  const limit = Number(budget.limit_usd)||10, spent = Number(budget.budget_usd)||0;
  const pct = limit>0 ? Math.min(spent/limit*100,100) : 0;
  const over = limit>0 && spent>limit;
  const RING_R = 56, RING_C = 2*Math.PI*RING_R;
  root.querySelector(".am-budget-big .am-ring-fg").setAttribute("stroke-dasharray",
    `${(pct/100*RING_C).toFixed(1)} ${RING_C.toFixed(1)}`);
  root.querySelector(".am-budget-big .am-ring-fg").classList.toggle("over", over);
  root.querySelector(".am-budget-big .am-budget-num b").textContent = Math.round(pct)+"%";
  root.querySelector(".am-budget-big .am-budget-num span").textContent = `${fmtUsd(spent)} / ${fmtUsd(limit)}`;

  // 右栏：Token 构成 Donut
  const don = donut({ size:110, stroke:13, slices: [
    { value:totals.input_tokens||0, color:"var(--green,#6FA587)", label:"输入" },
    { value:totals.output_tokens||0, color:"var(--accent,#D96B4F)", label:"输出" },
    { value:totals.cache_read||0, color:"var(--amber,#C9A34F)", label:"缓存读" },
  ]});
  root.querySelector(".am-donut-box").innerHTML = totalTok ? don + `
    <div class="am-donut-legend">
      <span><i style="background:var(--green)"></i>输入 ${fmtInt(totals.input_tokens||0)}</span>
      <span><i style="background:var(--accent)"></i>输出 ${fmtInt(totals.output_tokens||0)}</span>
      <span><i style="background:var(--amber)"></i>缓存读 ${fmtInt(totals.cache_read||0)}</span>
    </div>` : emptyState("暂无 Token 数据");
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
    dash = d; series = s;
    render();
  }catch(err){
    if(disposed) return;
    const box = root.querySelector(".am-err");
    if(box) box.textContent = "总览数据拉取失败：" + err.message;
    else root.insertAdjacentHTML("afterbegin", errorState("总览数据拉取失败：" + err.message));
  }
}

/* ---------- 面板接口 ---------- */

export function mount(container, sse, opts){
  unmount();
  disposed = false; visible = true; renderPending = false; lastFp = "";
  root = document.createElement("div");
  root.className = "am-panel";
  root.innerHTML = `
    <div class="am-panel-hd"><span class="am-ph-title">总览</span><span class="am-ph-sub">Overview</span></div>
    <div class="am-dash-cards"></div>
    <div class="am-grid2">
      <div class="am-col">
        <div class="am-dk">运行中</div>
        <div class="am-run-list"></div>
        <div class="am-dk">最近活动</div>
        <div class="am-ev-tl"></div>
      </div>
      <div class="am-col">
        <div class="am-dk">预算</div>
        <div class="am-budget-big">
          <div class="am-budget-ring-wrap" style="width:132px;height:132px">
            <svg class="am-budget-ring" viewBox="0 0 132 132" aria-hidden="true">
              <circle class="am-ring-bg" cx="66" cy="66" r="56"></circle>
              <circle class="am-ring-fg" cx="66" cy="66" r="56"></circle>
            </svg>
            <div class="am-budget-num"><b>0%</b><span></span></div>
          </div>
        </div>
        <div class="am-dk">Token 构成</div>
        <div class="am-donut-box"></div>
      </div>
    </div>`;
  container.appendChild(root);
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

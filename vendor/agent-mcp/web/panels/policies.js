/* ============================================================
 * Agent MCP · 策略可视化面板
 * 预算进度环（spent_usd / limit_usd，超限红色闪烁）+ 策略链日志表。
 * 数据源：GET /api/policies/state（每 5s 轮询）+ policy_decision SSE 实时追加。
 * 接口：{ mount(container, sse), unmount() }，由 loader.js 组装。
 * ============================================================ */

const POLL_MS = 5000;   // 轮询周期
const MAX_ROWS = 100;   // 策略日志保留上限
const RING_R = 52;      // 环形半径（与 viewBox 对应）
const RING_C = 2 * Math.PI * RING_R;

/* ---------- 小工具 ---------- */

function esc(v){
  return String(v ?? "").replace(/[&<>"']/g,
    c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function fmtTime(ts){
  if(ts == null) return "—";
  const n = (typeof ts === "number" || /^\d+$/.test(String(ts))) ? Number(ts) : Date.parse(ts);
  if(!Number.isFinite(n)) return String(ts);
  const d = new Date(n);
  const p = x => String(x).padStart(2,"0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const fmtUsd = v => "$" + (Number(v) || 0).toFixed(2);

/* ---------- 模块状态 ---------- */

let root = null;
let state = { limit_usd: 0, spent_usd: 0, spawns: 0, policies: [] };
let unsubs = null;
let pollTimer = null;
let disposed = true;
let visible = true;
let renderPending = false;
let lastShown = "";   // 上次渲染的日志行指纹（增量渲染防闪烁）

/* ---------- 渲染 ---------- */

function render(){
  if(disposed || !root) return;
  if(!visible){ renderPending = true; return; }
  renderPending = false;
  const limit = Number(state.limit_usd) || 0;
  const spent = Number(state.spent_usd) || 0;
  const pct = limit > 0 ? Math.min(spent / limit * 100, 100) : 0;
  const over = limit > 0 && spent > limit;
  const warn = !over && pct >= 80;
  const cls = over ? "over" : warn ? "warn" : "";
  const dash = (pct / 100) * RING_C;

  const fg = root.querySelector(".am-ring-fg");
  fg.setAttribute("stroke-dasharray", `${dash.toFixed(1)} ${RING_C.toFixed(1)}`);
  fg.classList.toggle("warn", warn);
  fg.classList.toggle("over", over);
  const pctEl = root.querySelector(".am-budget-num b");
  pctEl.textContent = (limit > 0 ? Math.round(pct) : 0) + "%";
  pctEl.classList.toggle("over", over);
  root.querySelector(".am-budget-num span").textContent = limit > 0 ? "已用 / 上限" : "未设置上限";
  root.querySelector('[data-k="spent"]').textContent = fmtUsd(spent);
  root.querySelector('[data-k="limit"]').textContent = fmtUsd(limit);
  root.querySelector('[data-k="spawns"]').textContent = String(state.spawns ?? 0);

  // 日志行增量：指纹不变不重建 DOM（防闪烁/省重绘）
  const log = root.querySelector(".am-log");
  const rows = state.policies || [];
  const fingerprint = rows.slice(0, 20).map(p => `${p.name}|${p.result}|${p.ts}`).join(";");
  if(fingerprint === lastShown) return;
  lastShown = fingerprint;
  if(!rows.length){
    log.innerHTML = '<div class="am-empty">暂无策略决策记录</div>';
    return;
  }
  log.innerHTML = rows.map((p, i) => `
    <div class="am-log-row${i === 0 && p._fresh ? " am-new" : ""}">
      <span class="am-log-time">${esc(fmtTime(p.ts))}</span>
      <span class="am-log-name" title="${esc(p.reason || "")}">${esc(p.name || "?")}${
        p.reason ? ` <span class="am-log-reason">· ${esc(trunc(p.reason, 40))}</span>` : ""}</span>
      <span class="am-badge am-log-result ${p.result === "allow" ? "allow" : p.result === "deny" ? "deny" : "soft"}">${esc(p.result || "?")}</span>
    </div>`).join("");
}

export function setVisible(v){
  visible = !!v;
  if(visible && renderPending){ lastShown = ""; render(); }
}

function trunc(s, n){ return String(s || "").length > n ? String(s).slice(0, n) + "…" : String(s || ""); }

/* ---------- 数据 ---------- */

async function poll(){
  if(disposed) return;
  try{
    const headers = {};
    const t = authToken();
    if(t) headers["X-Auth-Token"] = t;
    const r = await fetch("/api/policies/state", {headers});
    if(!r.ok) throw new Error("policies/state HTTP " + r.status);
    const d = await r.json().catch(() => ({}));
    const cfg = d.policy_configs || {};
    const limit = Number(cfg.budget_limit_usd) || Number(d.limit_usd) || 0;
    state = {
      limit_usd: limit,
      spent_usd: Number(d.budget_usd) || Number(d.spent_usd) || 0,
      spawns: Number(d.spawns) || 0,
      // 审计日志在 log 数组；policies 是策略链（{name, enabled}）
      policies: (d.log || []).map(p => ({ name: p.name, result: p.result, ts: p.ts, reason: p.reason, _fresh: false })),
    };
    render();
  }catch(err){
    if(disposed) return;
    const box = root.querySelector(".am-err");
    if(box) box.textContent = "策略状态拉取失败：" + err.message;
    else root.insertAdjacentHTML("afterbegin", `<div class="am-err">策略状态拉取失败：${esc(err.message)}</div>`);
  }
}

/* ---------- 认证（与 index.html 同约定：URL hash #token=） ---------- */

function authToken(){
  // 优先 daemon 注入的全局 token（index 页注入 window.__amToken），回退 URL hash
  if(window.__amToken) return window.__amToken;
  const m = (location.hash || "").match(/token=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

/* SSE：policy_decision（data 内嵌 type 字段，payload 含 name/result/reason） */
function onDecision(data){
  if(disposed) return;
  const p = data.payload || {};
  state.policies.unshift({ name: p.name, result: p.result, ts: p.ts ?? data.ts ?? Date.now(), reason: p.reason, _fresh: true });
  if(state.policies.length > MAX_ROWS) state.policies.length = MAX_ROWS;
  render();
}

/* ---------- SSE 订阅（命名事件 + message 内嵌 type 双通道去重） ---------- */

function subscribe(sse, type, fn){
  const named = ev => {
    let d; try { d = JSON.parse(ev.data); } catch { return; }
    if(!d || d.type) return;
    fn(d, ev);
  };
  const msg = ev => {
    let d; try { d = JSON.parse(ev.data); } catch { return; }
    if(!d || d.type !== type) return;
    fn(d, ev);
  };
  sse.addEventListener(type, named);
  sse.addEventListener("message", msg);
  unsubs.add(() => { sse.removeEventListener(type, named); sse.removeEventListener("message", msg); });
}

/* ---------- 面板接口 ---------- */

export function mount(container, sse, opts){
  unmount(); // 防御：重复 mount 前先清理旧状态
  disposed = false;
  visible = true;
  renderPending = false;
  lastShown = "";
  unsubs = new Set();
  root = document.createElement("div");
  root.className = "am-panel";
  root.innerHTML = `
    <div class="am-budget">
      <div class="am-budget-ring-wrap">
        <svg class="am-budget-ring" viewBox="0 0 120 120" aria-hidden="true">
          <circle class="am-ring-bg" cx="60" cy="60" r="${RING_R}"></circle>
          <circle class="am-ring-fg" cx="60" cy="60" r="${RING_R}"></circle>
        </svg>
        <div class="am-budget-num"><b>0%</b><span>已用 / 上限</span></div>
      </div>
      <div class="am-budget-stats">
        <div class="am-stat"><b data-k="spent">$0.00</b><span>已花费</span></div>
        <div class="am-stat"><b data-k="limit">$0.00</b><span>预算上限</span></div>
        <div class="am-stat"><b data-k="spawns">0</b><span>已派发</span></div>
      </div>
    </div>
    <div class="am-dk">策略链日志</div>
    <div class="am-log"><div class="am-empty">加载中…</div></div>`;
  container.appendChild(root);

  render(); // 先渲染初始状态（0% 环形），轮询失败时界面也不残缺

  subscribe(sse, "policy_decision", onDecision);
  poll();
  pollTimer = setInterval(poll, POLL_MS);
}

export function unmount(){
  disposed = true;
  visible = true;
  renderPending = false;
  if(pollTimer){ clearInterval(pollTimer); pollTimer = null; }
  if(unsubs){ for(const fn of unsubs) fn(); unsubs = null; }
  if(root){ root.remove(); root = null; }
}

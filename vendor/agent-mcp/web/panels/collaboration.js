/* ============================================================
 * Agent MCP · 协作泳道面板
 * 纵向泳道列表（每个 agent 一条：agent_id / cli / status / 活动摘要），
 * 数据源：GET /api/agents/list + GET /api/agents/activity；
 * SSE：agent.* 命名事件（现有格式 {seq,agent_id,payload}）实时更新状态，
 *      review_requested 事件（data 内嵌 type）高亮"审查请求"卡片。
 * 导出接口：{ mount(container, sse), unmount() }，由 loader.js 组装。
 * ============================================================ */

const AGENT_EVENTS = [
  "agent.spawned","agent.user_turn","agent.running","agent.message","agent.message_delta",
  "agent.tool_use","agent.tool_result","agent.usage","agent.thread_message_sent",
  "agent.thread_message_received","agent.idle","agent.terminated","agent.error",
  "agent.cancelled","agent.orphaned","agent.needs_advisor","agent.verify_failed",
  "agent.verify_passed","agent.budget_downgrade","agent.ingest_failed",
];
const MAX_ACTIVITY = 20;   // 每个泳道保留的活动条目上限
const MAX_REVIEWS = 3;     // 每个泳道保留的审查卡片上限
const DIFF_MAX = 140;      // diff 预览截断长度

/* ---------- 小工具 ---------- */

function esc(v){
  return String(v ?? "").replace(/[&<>"']/g,
    c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function fmtTime(ts){
  if(ts==null)return "";
  const n = (typeof ts === "number" || /^\d+$/.test(String(ts))) ? Number(ts) : Date.parse(ts);
  if(!Number.isFinite(n)) return String(ts);
  const d = new Date(n);
  const p = x => String(x).padStart(2,"0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* 状态 → 中文标签 / 徽章类（与 index.html 的 statusLabel/statusColor 对齐） */
const STATUS_LABEL = {
  running:"运行中", terminated:"完成", queued:"排队", error:"失败", cancelled:"已取消",
  incomplete:"超时/失联", needs_advisor:"需决策", idle:"空闲", reviewing:"审查中",
};
function statusLabel(s){ return STATUS_LABEL[s] || s || "—"; }
function statusClass(s){
  return s==="running" ? "run" : s==="terminated" ? "ok" : s==="error" ? "err"
       : s==="needs_advisor" ? "warn" : s==="reviewing" ? "warn" : "soft";
}

/* CLI → 品牌色（与 index.html 的 cliColor 对齐） */
const CLI_COLORS = {
  grok:"var(--grok,#C9A34F)", opencode:"var(--opencode,#6FA587)",
  omp:"var(--omp,#9A8EDA)", atomcode:"var(--atomcode,#5A9CD6)",
};
function cliColor(cli){ return CLI_COLORS[String(cli||"").toLowerCase()] || "var(--claude,#C87A5A)"; }

/* agent.* 事件 → 活动摘要文本 */
function eventText(type, payload){
  const p = payload || {};
  switch(type){
    case "agent.spawned":            return "创建 · " + (p.task_name || p.task || "派发任务");
    case "agent.user_turn":          return "用户回合";
    case "agent.running":            return "开始运行";
    case "agent.message":            return p.text || p.message || "新消息";
    case "agent.message_delta":      return null; // 增量流式文本，不逐条入泳道
    case "agent.tool_use":           return "▸ 工具 " + (p.name || "tool");
    case "agent.tool_result":        return "工具结果" + (p.name ? " " + p.name : "") + (p.ok === false ? " 失败" : "");
    case "agent.usage":              return "用量 " + (p.tokens != null ? p.tokens + " tok" : "");
    case "agent.thread_message_sent":return "线程消息已发送";
    case "agent.thread_message_received": return "收到线程消息";
    case "agent.idle":               return "空闲等待";
    case "agent.terminated":         return "完成" + (p.stop_reason ? " · " + p.stop_reason : "");
    case "agent.error":              return "错误：" + (p.error || p.message || "未知");
    case "agent.cancelled":          return "已取消";
    case "agent.orphaned":           return "失联（orphaned）";
    case "agent.needs_advisor":      return "需决策：" + (p.question || "");
    case "agent.verify_failed":      return "验证失败（attempt " + (p.attempt || 1) + "）";
    case "agent.verify_passed":      return "验证通过";
    case "agent.budget_downgrade":   return "预算降级";
    case "agent.ingest_failed":      return "上下文注入失败";
    default:                         return type.replace(/^agent\./, "");
  }
}

/* ---------- 模块状态（loader 每次 mount 重新初始化） ---------- */

let root = null;        // 面板根元素
let lanes = null;       // Map<agentId, lane 对象>
let unsubs = null;      // Set<() => void> SSE 退订函数
let disposed = true;

/* ---------- 数据获取（对后端响应形状做防御性归一化） ---------- */

function normalizeAgent(a){
  return {
    id: String(a.id ?? a.agent_id ?? a.agentId ?? "?"),
    cli: a.cli || "?",
    status: a.status || "idle",
    task: a.task_name || a.task || a.name || "",
    created_at: a.created_at || a.created || null,
  };
}

function normalizeActivity(x){
  const p = x.payload || {};
  return {
    agent_id: String(x.agent_id ?? x.id ?? p.agent_id ?? "?"),
    type: x.type || x.event || x.kind || "event",
    ts: x.ts ?? x.time ?? x.created_at ?? x.updated_at ?? Date.now(),
    text: x.text ?? x.message ?? x.summary ?? "",
    tool: x.tool ?? x.name ?? p.name ?? p.tool ?? "",
  };
}

/* ---------- 认证（与 index.html 同约定：URL hash #token=） ---------- */

function authToken(){
  // 优先 daemon 注入的全局 token（index 页注入 window.__amToken），回退 URL hash
  if(window.__amToken) return window.__amToken;
  const m = (location.hash || "").match(/token=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function fetchAgents(){
  const headers = {};
  const t = authToken();
  if(t) headers["X-Auth-Token"] = t;
  const r = await fetch("/api/agents/list", {headers});
  if(!r.ok) throw new Error("agents/list HTTP " + r.status);
  const d = await r.json().catch(() => ({}));
  const list = Array.isArray(d) ? d : (d.agents || []);
  return (list || []).map(normalizeAgent);
}

async function fetchActivity(){
  const headers = {};
  const t = authToken();
  if(t) headers["X-Auth-Token"] = t;
  const r = await fetch("/api/agents/activity", {headers});
  if(!r.ok) throw new Error("agents/activity HTTP " + r.status);
  const d = await r.json().catch(() => ({}));
  const list = Array.isArray(d) ? d : (d.activity || d.events || []);
  return (list || []).map(normalizeActivity);
}

/* ---------- 渲染 ---------- */

function laneEl(id){
  const lane = lanes.get(id);
  const head = `<div class="am-swimlane-head">
      <span class="am-lane-id">#${esc(id)}</span>
      <span class="am-cli" style="background:${cliColor(lane.cli)}">${esc(lane.cli)}</span>
      <span class="am-badge ${statusClass(lane.status)}">${esc(statusLabel(lane.status))}</span>
    </div>
    <div class="am-lane-task" title="${esc(lane.task)}">${esc(lane.task) || '<span class="am-empty">（无任务描述）</span>'}</div>`;

  // 审查请求卡片（最新在前）
  const reviews = lane.reviews.map(rv => `
    <div class="am-review${rv.flash ? " flash" : ""}" title="diff 预览：${esc(rv.diff)}">
      <div class="am-rev-title">审查请求</div>
      <div class="am-rev-flow">
        <span class="am-cli" style="background:${cliColor(rv.writer_cli)}">${esc(rv.writer_cli)}</span>
        <span class="am-rev-arrow">→</span>
        <span class="am-cli" style="background:${cliColor(rv.reviewer_cli)}">${esc(rv.reviewer_cli)}</span>
        <span class="am-rev-agent">#${esc(id)}</span>
      </div>
      <div class="am-diff">${esc(rv.diff)}</div>
    </div>`).join("");

  // 活动摘要：最新一条
  const last = lane.activity[0];
  const act = last ? `<div class="am-lane-act">${
      last.type === "agent.running" ? '<span class="am-dot-live"></span>' : ""
    }${esc(fmtTime(last.ts))} · ${esc(last.text)}</div>` : "";

  return `<div class="am-swimlane ${lane.status === "running" ? "run" : ""}" data-id="${esc(id)}">${head}${reviews}${act}</div>`;
}

/* 过滤器：all / running / done / bad */
let filter = "all";

function render(){
  if(disposed || !root) return;
  if(!visible){ renderPending = true; return; }
  renderPending = false;
  const filterFn = {
    all: () => true,
    running: l => ["running","queued"].includes(l.status),
    done: l => l.status === "terminated",
    bad: l => ["error","cancelled","incomplete","needs_advisor"].includes(l.status),
  }[filter] || (() => true);

  const ids = [...lanes.values()]
    .filter(filterFn)
    .sort((a,b) => (b.created_at || 0) < (a.created_at || 0) ? -1
                  : (b.created_at || 0) > (a.created_at || 0) ? 1
                  : String(a.id).localeCompare(String(b.id), "zh"))
    .map(l => l.id);
  if(!ids.length){
    root.querySelector(".am-swimlanes").innerHTML = '<div class="am-empty">暂无 agent 泳道，等待派发…</div>';
    return;
  }
  root.querySelector(".am-swimlanes").innerHTML = `<div class="am-swimlanes">${ids.map(laneEl).join("")}</div>`;
}

function bindFilter(){
  const box = root.querySelector(".am-collab-filters");
  if(!box || box.dataset.bound) return;
  box.dataset.bound = "1";
  box.addEventListener("click", e => {
    const btn = e.target.closest("button[data-f]");
    if(!btn) return;
    filter = btn.dataset.f;
    box.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
    render();
  });
}

/* 面板数据量小（泳道最多几十条），直接同步渲染；
 * 不使用 requestAnimationFrame 节流——后台 tab / 隐藏窗口会暂停
 * rAF，导致渲染永久冻结。隐藏面板（切到其他分页）时只标记 pending，
 * 切回时一次渲染（v2 loader 可见性通知）。 */
let visible = true;
let renderPending = false;

function scheduleRender(){
  if(disposed) return;
  if(!visible){ renderPending = true; return; }
  render();
}

export function setVisible(v){
  visible = !!v;
  if(visible && renderPending){ renderPending = false; render(); }
}

/* ---------- 状态更新 ---------- */

function upsertLane(agent){
  let lane = lanes.get(agent.id);
  if(!lane){
    lane = { id: agent.id, cli: agent.cli, status: agent.status, task: agent.task,
             created_at: agent.created_at, activity: [], reviews: [] };
    lanes.set(agent.id, lane);
  }
  // 已存在则合并可更新的字段（SSE 可能先于 list 返回）
  if(agent.cli && agent.cli !== "?") lane.cli = agent.cli;
  if(agent.task) lane.task = agent.task;
  if(agent.status) lane.status = agent.status;
  if(agent.created_at) lane.created_at = agent.created_at;
  return lane;
}

function pushActivity(agentId, entry){
  const lane = lanes.get(agentId);
  if(!lane) return;
  // M3：按 seq 幂等去重（重连重放后同一事件只入列一次）
  if(entry.seq != null){
    const dup = lane.activity.some(a => a.seq === entry.seq);
    if(dup) return;
  }
  lane.activity.unshift(entry);
  if(lane.activity.length > MAX_ACTIVITY) lane.activity.length = MAX_ACTIVITY;
}

/* SSE：agent.* 命名事件（data = {seq, agent_id, payload}，无内嵌 type） */
function onAgentEvent(type, data){
  const payload = data.payload || {};
  const aid = String(data.agent_id ?? payload.agent_id ?? "");
  if(!aid || !lanes.has(aid)) return;
  const lane = lanes.get(aid);
  if(type === "agent.running") lane.status = "running";
  else if(type === "agent.terminated") lane.status = payload.stop_reason === "timeout" ? "incomplete" : "terminated";
  else if(type === "agent.error") lane.status = "error";
  else if(type === "agent.cancelled") lane.status = "cancelled";
  else if(type === "agent.orphaned") lane.status = "incomplete";
  else if(type === "agent.needs_advisor") lane.status = "needs_advisor";
  else if(type === "agent.idle") lane.status = "idle";
  // agent.message_delta 为高频打字机增量（终态 message 已含全文），
  // 入活动列表只会触发无意义的全量重绘 → 忽略（性能/防闪烁）
  if(type === "agent.message_delta") return;
  const text = eventText(type, payload);
  if(text) pushActivity(aid, { type, ts: payload.ts ?? data.ts ?? Date.now(), text, seq: data.seq });
  scheduleRender();
}

/* SSE：review_requested（data 内嵌 type 字段的通用格式） */
function onReviewRequested(data){
  const payload = data.payload || {};
  const aid = String(data.agent_id ?? payload.agent_id ?? payload.writer_agent_id ?? "");
  const diff = truncateDiff(payload.diff_preview || payload.diff || "");
  // agent 未知时先建一条泳道（字段可能不全）
  if(aid && !lanes.has(aid)) upsertLane({ id: aid, cli: payload.writer_cli || "?", status: "reviewing", task: payload.task || "" });
  if(!aid) return;
  const lane = lanes.get(aid);
  lane.reviews.unshift({
    writer_cli: payload.writer_cli || "writer",
    reviewer_cli: payload.reviewer_cli || "reviewer",
    diff, flash: true,
  });
  if(lane.reviews.length > MAX_REVIEWS) lane.reviews.length = MAX_REVIEWS;
  scheduleRender();
}

function truncateDiff(text){
  const s = String(text || "");
  const lines = s.split("\n").slice(0, 3);          // 最多保留 3 行
  let out = lines.join("\n");
  if(out.length > DIFF_MAX) out = out.slice(0, DIFF_MAX);
  if(out.length < s.length) out += "\n…";
  return out;
}

/* ---------- SSE 订阅：命名事件 + message 内嵌 type 双通道去重 ---------- */

function subscribe(sse, type, fn){
  // 命名事件通道：data 不含 type 字段时处理（兼容现有 agent.* 格式）
  const named = ev => {
    let d; try { d = JSON.parse(ev.data); } catch { return; }
    if(!d || d.type) return;
    fn(d, ev);
  };
  // message 通道：data.type 匹配时处理（新事件契约格式）
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
  lanes = new Map();
  unsubs = new Set();
  root = document.createElement("div");
  root.className = "am-panel";
  root.innerHTML = `
    <div class="am-panel-hd"><span class="am-ph-title">协作泳道</span><span class="am-ph-sub">Collaboration</span>
      <span class="am-ph-ops am-collab-filters">
        <button class="am-chip active" data-f="all">全部</button>
        <button class="am-chip" data-f="running">运行中</button>
        <button class="am-chip" data-f="done">完成</button>
        <button class="am-chip" data-f="bad">异常</button>
      </span>
    </div>
    <div class="am-swimlanes"><div class="am-empty">加载泳道数据…</div></div>`;
  container.appendChild(root);
  bindFilter();

  // 初始数据：list + activity 并行拉取
  Promise.all([fetchAgents(), fetchActivity()])
    .then(([agents, acts]) => {
      if(disposed) return;
      agents.forEach(a => { upsertLane(a); });
      acts.forEach(x => {
        if(lanes.has(x.agent_id)) pushActivity(x.agent_id, { type: x.type, ts: x.ts, text: x.text || eventText(x.type, { name: x.tool }) });
      });
      render();
    })
    .catch(err => {
      if(disposed) return;
      const box = root.querySelector(".am-swimlanes");
      if(box) box.innerHTML = `<div class="am-err">泳道数据加载失败：${esc(err.message)}</div>`;
    });

  // SSE 订阅
  for(const t of AGENT_EVENTS) subscribe(sse, t, (d) => onAgentEvent(t, d));
  subscribe(sse, "review_requested", onReviewRequested);
}

export function unmount(){
  disposed = true;
  visible = true;
  renderPending = false;
  if(unsubs){ for(const fn of unsubs) fn(); unsubs = null; }
  if(root){ root.remove(); root = null; }
  lanes = null;
}

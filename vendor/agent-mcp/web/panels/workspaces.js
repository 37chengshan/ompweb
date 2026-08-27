/* ============================================================
 * Agent MCP · 工作区视图面板
 * worktree 列表（id/path/status/branch/task + 状态徽章配色），
 * 合并/丢弃按钮调用 POST /api/workspaces/merge|discard，
 * workspace_status SSE 实时更新徽章。
 * 接口：{ mount(container, sse), unmount() }，由 loader.js 组装。
 * ============================================================ */

/* ---------- 小工具 ---------- */

function esc(v){
  return String(v ?? "").replace(/[&<>"']/g,
    c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* 状态徽章：clean/dirty/merged/discarded 配色与中文标签 */
const STATUS_META = {
  clean:     { label: "干净",   cls: "ok" },
  dirty:     { label: "未提交", cls: "warn" },
  merged:    { label: "已合并", cls: "ok" },
  discarded: { label: "已丢弃", cls: "err" },
};
function statusMeta(s){
  return STATUS_META[s] || { label: s || "—", cls: "soft" };
}
/* 终态（merged/discarded）不再显示操作按钮 */
function isTerminal(s){ return s === "merged" || s === "discarded"; }

/* 鉴权 token：优先 daemon 注入的全局 token（index 页注入 window.__amToken），
 * 回退 URL hash #token=...（与 index.html 同约定） */
function authToken(){
  if(window.__amToken) return window.__amToken;
  return new URLSearchParams(location.hash.slice(1)).get("token") || "";
}

async function apiFetch(path, opts){
  const r = await fetch(path, Object.assign({}, opts, {
    headers: Object.assign({}, opts && opts.headers, { "X-Auth-Token": authToken() }),
  }));
  const d = await r.json().catch(() => ({}));
  if(!r.ok) throw new Error(d.error || ("HTTP " + r.status));
  return d;
}

/* ---------- 模块状态 ---------- */

let root = null;
let rows = null;    // Map<id, row DOM 元素>
let unsubs = null;
let disposed = true;
let visible = true;
let renderPending = false;

/* ---------- 渲染 ---------- */

function rowEl(ws){
  const meta = statusMeta(ws.status);
  const terminal = isTerminal(ws.status);
  const div = document.createElement("div");
  div.className = "am-ws-row";
  div.dataset.id = ws.id;
  div.innerHTML = `
    <div class="am-ws-head">
      <span class="am-ws-id">${esc(ws.id)}</span>
      <span class="am-badge am-ws-status ${meta.cls}">${esc(meta.label)}</span>
      <span class="am-ws-path" title="${esc(ws.path)}">${esc(ws.path)}</span>
    </div>
    <div class="am-ws-meta">
      <span class="am-ws-task" title="${esc(ws.task)}">${esc(ws.task) || "（无任务描述）"}</span>
      ${ws.branch ? `<span class="am-ws-branch" title="${esc(ws.branch)}">${esc(ws.branch)}</span>` : ""}
    </div>
    ${terminal ? "" : `
    <div class="am-ws-ops">
      <button class="am-btn primary" data-op="merge">合并</button>
      <button class="am-btn danger" data-op="discard">丢弃</button>
    </div>`}
    <div class="am-ws-feedback"></div>`;
  return div;
}

function render(){
  if(disposed || !root) return;
  if(!visible){ renderPending = true; return; }
  renderPending = false;
  const list = [...rows.values()].map(r => r.ws);
  if(!list.length){
    root.innerHTML = '<div class="am-empty">暂无工作区（worktree）</div>';
    return;
  }
  root.innerHTML = '<div class="am-ws"></div>';
  const box = root.firstChild;
  for(const ws of list){
    const el = rowEl(ws);
    rows.set(ws.id, { ws, el });
    box.appendChild(el);
  }
  root.querySelector(".am-ws").addEventListener("click", onOpsClick);
}

function setStatus(id, status, flash){
  const rec = rows.get(id);
  if(!rec) return;
  rec.ws.status = status;
  const meta = statusMeta(status);
  const el = rec.el;
  el.querySelector(".am-ws-status").textContent = meta.label;
  el.querySelector(".am-ws-status").className = "am-badge am-ws-status " + meta.cls;
  // 进入终态：移除操作按钮
  if(isTerminal(status)){
    const ops = el.querySelector(".am-ws-ops");
    if(ops) ops.remove();
  }
  if(flash){
    el.classList.remove("flash");
    void el.offsetWidth; // 重启动画
    el.classList.add("flash");
  }
  feedback(id, status === "merged" ? "已合并" : status === "discarded" ? "已丢弃" : "", false);
}

function feedback(id, text, isErr){
  const rec = rows.get(id);
  if(!rec) return;
  const fb = rec.el.querySelector(".am-ws-feedback");
  if(!fb) return;
  fb.textContent = text || "";
  fb.className = "am-ws-feedback" + (isErr ? " error" : "");
}

function setBusy(id, busy){
  const rec = rows.get(id);
  if(!rec) return;
  rec.el.querySelectorAll(".am-ws-ops .am-btn").forEach(b => { b.disabled = busy; });
}

/* ---------- 操作：合并 / 丢弃 ---------- */

async function onOpsClick(e){
  const btn = e.target.closest("button[data-op]");
  if(!btn) return;
  const row = btn.closest(".am-ws-row");
  const id = row.dataset.id;
  const op = btn.dataset.op;
  setBusy(id, true);
  feedback(id, op === "merge" ? "正在合并…" : "正在丢弃…", false);
  try{
    const d = await apiFetch("/api/workspaces/" + op, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if(disposed) return;
    setStatus(id, d.status || (op === "merge" ? "merged" : "discarded"), true);
  }catch(err){
    if(disposed) return;
    feedback(id, "失败：" + err.message, true);
    setBusy(id, false);
  }
}

/* ---------- 数据 ---------- */

function normalize(ws){
  return {
    id: String(ws.id ?? "?"),
    path: ws.path || "",
    status: ws.status || "clean",
    branch: ws.branch || "",
    task: ws.task || ws.task_name || "",
  };
}

async function load(){
  try{
    const d = await apiFetch("/api/workspaces");
    const list = Array.isArray(d) ? d : (d.workspaces || []);
    rows = new Map((list || []).map(ws => [String(ws.id ?? "?"), { ws: normalize(ws) }]));
    render();
  }catch(err){
    if(disposed) return;
    root.innerHTML = `<div class="am-err">工作区列表加载失败：${esc(err.message)}</div>`;
  }
}

/* ---------- SSE：workspace_status（data 内嵌 type，payload 含 id/status） ---------- */

function onWorkspaceStatus(data){
  if(disposed) return;
  const p = data.payload || {};
  const id = String(data.id ?? p.id ?? "");
  const status = p.status || data.status;
  if(!id || !status) return;
  // 若列表尚未加载到该 id，先补一条占位记录
  if(!rows.has(id)){
    const ws = { id, path: p.path || "", status: "clean", branch: p.branch || "", task: p.task || "" };
    rows.set(id, { ws });
    render();
  }
  setStatus(id, status, true);
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
  rows = new Map();
  unsubs = new Set();
  root = document.createElement("div");
  root.className = "am-panel";
  root.innerHTML = '<div class="am-empty">加载工作区列表…</div>';
  container.appendChild(root);

  subscribe(sse, "workspace_status", onWorkspaceStatus);
  load();
}

export function unmount(){
  disposed = true;
  visible = true;
  renderPending = false;
  if(unsubs){ for(const fn of unsubs) fn(); unsubs = null; }
  if(root){ root.remove(); root = null; }
  rows = null;
}

export function setVisible(v){
  visible = !!v;
  if(visible && renderPending) render();
}

/* ============================================================
 * Agent MCP · 仪表盘加载器（loader）v4
 * 完整仪表盘骨架：
 *   - 顶部 Header：品牌 + 全局胶囊（运行中/异常/成本）+ token 迷你条
 *   - 左侧导航：图标 + 文字（总览/Token/协作/策略/工作区）
 *   - 主内容：分页 pane（常驻 + 可见性通知）
 *   - 底部状态条：SSE 状态 · 最近事件 · 版本
 * 面板常驻不重建（切页零闪烁）、隐藏面板暂停渲染、SSE 共享连接。
 * 接口：面板导出 { mount(container, sse, {setVisible}), unmount(), setVisible() }。
 * ============================================================ */

const SSE_URL = "/api/events";
const CSS_URL = "/css/panels.css";
const CSS_ID = "am-panels-css";
const PANEL_V = "v5";

const NAV = [
  { key: "dashboard",     label: "总览",       icon: "◧", module: `./dashboard.js?v=${PANEL_V}` },
  { key: "tokens",        label: "Token 用量", icon: "∑", module: `./tokens.js?v=${PANEL_V}` },
  { key: "collaboration", label: "协作泳道",   icon: "≋", module: `./collaboration.js?v=${PANEL_V}` },
  { key: "policies",      label: "策略可视化", icon: "◈", module: `./policies.js?v=${PANEL_V}` },
  { key: "workspaces",    label: "工作区视图", icon: "▤", module: `./workspaces.js?v=${PANEL_V}` },
  { key: "mailbox",       label: "信箱与治理", icon: "✉", module: `./mailbox.js?v=${PANEL_V}` },
];

let inited = false;
let sse = null;
let stage = null, nav = null, headerEl = null, statusBar = null;
let panes = new Map();      // key -> { paneEl, module, setVisible }
let currentKey = null;
let lastEventText = "";

/* ---------- 样式注入 ---------- */

function injectCss(){
  if(document.getElementById(CSS_ID)) return;
  const link = document.createElement("link");
  link.id = CSS_ID; link.rel = "stylesheet"; link.href = CSS_URL;
  document.head.appendChild(link);
}

/* ---------- SSE ---------- */

/* A6：令牌读取——daemon 注入的全局变量优先，回退 URL hash（#token=...）。
   SSE EventSource 无法带 header，统一走 ?token= 查询通道。 */
function amToken(){
  if(window.__amToken) return window.__amToken;
  const m = location.hash.match(/token=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

function getSse(){
  const existing = window.__amSse;
  if(existing && (existing.readyState === EventSource.CONNECTING || existing.readyState === EventSource.OPEN)){
    sse = existing;
  }else{
    const tk = amToken();
    sse = new EventSource(tk ? `${SSE_URL}?token=${encodeURIComponent(tk)}` : SSE_URL);
    window.__amSse = sse;
  }
  sse.onopen = () => setSseDot(true);
  sse.onerror = () => setSseDot(false);
  sse.onmessage = ev => {
    let d; try { d = JSON.parse(ev.data); } catch { return; }
    if(!d || !d.type) return;
    // 底部状态条最近事件
    const p = d.payload || {};
    let text = "";
    if(d.type === "agent.message") text = String(p.text||"").slice(0, 48);
    else if(d.type === "agent.terminated") text = "agent 完成 · " + (p.stop_reason || "");
    else if(d.type === "agent.error") text = "agent 失败 · " + String(p.error||"").slice(0, 40);
    else if(d.type === "agent.tool_use") text = "工具调用 · " + (p.name || "");
    if(text && statusBar){ statusBar.querySelector(".am-sb-last").textContent = text; }
    // Header 胶囊实时刷新
    if(["agent.spawned","agent.terminated","agent.error","agent.cancelled","agent.running"].includes(d.type)){
      refreshHeaderCapsules();
    }
  };
  return sse;
}

function setSseDot(on){
  const dots = document.querySelectorAll(".am-dot");
  dots.forEach(d => { d.className = "am-dot " + (on ? "on" : "off"); d.title = on ? "SSE 已连接" : "SSE 连接异常（自动重连中）"; });
}

/* ---------- Header 胶囊（实时全局统计） ---------- */

function applyTheme(theme){
  // theme: "dark" | "light" | null（跟随系统）
  const root = document.documentElement;
  if(theme === "dark"){ root.dataset.theme = "dark"; }
  else if(theme === "light"){ root.dataset.theme = "light"; }
  else { delete root.dataset.theme; }
  const btn = document.getElementById("am-theme-btn");
  if(btn) btn.textContent = currentTheme() === "dark" ? "☀" : "☾";
}

function currentTheme(){
  const t = document.documentElement.dataset.theme;
  if(t) return t;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function bindThemeToggle(){
  const btn = document.getElementById("am-theme-btn");
  if(!btn) return;
  btn.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    localStorage.setItem("am-theme", next);
    applyTheme(next);
  });
  // 初始化：localStorage 优先，其次跟随系统
  const saved = localStorage.getItem("am-theme");
  applyTheme(saved || null);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if(!localStorage.getItem("am-theme")) applyTheme(null);
  });
}

async function refreshHeaderCapsules(){
  if(!headerEl) return;
  try{
    const d = await apiFetchSafe("/api/snapshot");
    const agents = d.agents || [], totals = (d.usage || {}).totals || {};
    const nRun = agents.filter(a => a.status === "running").length;
    const nBad = agents.filter(a => ["error","cancelled","incomplete","needs_advisor"].includes(a.status)).length;
    const cost = totals.cost_usd || 0;
    const tot = (totals.input_tokens||0) + (totals.output_tokens||0);
    const caps = headerEl.querySelector(".am-hdr-caps");
    if(!caps) return;
    caps.innerHTML = `
      <span class="am-cap ${nRun ? "run" : ""}"><i class="am-cap-dot"></i>运行 ${nRun}</span>
      <span class="am-cap ${nBad ? "err" : ""}">异常 ${nBad}</span>
      <span class="am-cap">成本 ${fmtUsdSafe(cost)}</span>
      <span class="am-cap mono">${fmtIntSafe(tot)} tok</span>`;
  }catch(e){ /* header 静默 */ }
}

function apiFetchSafe(path){
  const headers = {};
  const t = amToken();
  if(t) headers["X-Auth-Token"] = t;
  return fetch(path, { headers }).then(r => r.json().catch(() => ({}))).catch(() => ({}));
}
function fmtUsdSafe(v){ return "$" + (Number(v)||0).toFixed(2); }
function fmtIntSafe(n){ return Number(n||0).toLocaleString("zh-CN"); }

/* ---------- DOM 骨架 ---------- */

function buildDom(){
  stage = document.createElement("div");
  stage.className = "am-stage";
  stage.innerHTML = `
    <header class="am-hdr">
      <span class="am-hdr-brand">Agent MCP <span class="am-hdr-brand-sub">仪表盘</span></span>
      <span class="am-hdr-caps"></span>
      <span class="am-hdr-right">
        <button class="am-theme-btn" id="am-theme-btn" type="button" title="切换明暗主题">☾</button>
        <span class="am-dot" title="SSE 未连接"></span>
        <button class="am-stage-close" id="am-stage-close" title="关闭仪表盘（Esc）">✕</button>
      </span>
    </header>
    <div class="am-body">
      <nav class="am-nav" aria-label="仪表盘导航">
        ${NAV.map((n, i) => `<button class="am-nav-item" data-key="${n.key}" role="tab" aria-selected="false" title="${n.label}">
          <span class="am-nav-ico">${n.icon}</span><span class="am-nav-txt">${n.label}</span>
        </button>`).join("")}
      </nav>
      <main class="am-panes">
        ${NAV.map(n => `<section class="am-pane" data-key="${n.key}" role="tabpanel" hidden></section>`).join("")}
      </main>
    </div>
    <footer class="am-sb">
      <span class="am-sb-item"><span class="am-dot" title="SSE"></span><span class="am-sb-last">就绪</span></span>
      <span class="am-sb-item am-sb-right mono">v0.3 · agent-mcp daemon</span>
    </footer>`;
  document.body.appendChild(stage);
  headerEl = stage.querySelector(".am-hdr");
  statusBar = stage.querySelector(".am-sb");
  nav = stage.querySelector(".am-nav");

  nav.addEventListener("click", onNavClick);
  stage.querySelector("#am-stage-close").addEventListener("click", closeStage);
  document.addEventListener("keydown", e => {
    if(e.key === "Escape" && stage.classList.contains("open")) closeStage();
  });
  refreshHeaderCapsules();
}

/* ---------- 分页切换 ---------- */

function paneFor(key){
  if(!panes.has(key)){
    const paneEl = stage.querySelector(`.am-pane[data-key="${key}"]`);
    panes.set(key, { paneEl, module: null, setVisible: null });
  }
  return panes.get(key);
}

async function openPane(key){
  if(currentKey === key){ stage.classList.add("open"); return; }
  if(currentKey){
    const old = panes.get(currentKey);
    if(old && old.setVisible) old.setVisible(false);
    if(old && old.paneEl) old.paneEl.classList.remove("active");
  }
  currentKey = key;
  const rec = paneFor(key);
  rec.paneEl.hidden = false;
  void rec.paneEl.offsetWidth;
  rec.paneEl.classList.add("active");
  stage.classList.add("open");
  setNavActive(key);

  if(!rec.module){
    rec.paneEl.innerHTML = '<div class="am-panel"><div class="am-state loading">加载面板…<span class="am-shimmer"></span></div></div>';
    try{
      const mod = await import(NAV.find(n => n.key === key).module);
      if(currentKey !== key) return;
      rec.paneEl.innerHTML = "";
      rec.module = mod;
      rec.setVisible = v => { if(mod.setVisible) mod.setVisible(v); };
      if(mod.mount) mod.mount(rec.paneEl, sse, { setVisible: rec.setVisible });
      if(rec.setVisible) rec.setVisible(true);
    }catch(err){
      if(currentKey !== key) return;
      rec.paneEl.innerHTML = `<div class="am-panel"><div class="am-state error"><span class="am-state-ico">⚠</span>面板模块加载失败：${String(err.message || err)}</div></div>`;
    }
  }else{
    if(rec.setVisible) rec.setVisible(true);
  }
}

function closeStage(){
  if(currentKey){
    const rec = panes.get(currentKey);
    if(rec && rec.setVisible) rec.setVisible(false);
    if(rec && rec.paneEl) rec.paneEl.classList.remove("active");
  }
  stage.classList.remove("open");
  setNavActive(null);
  currentKey = null;
}

function setNavActive(key){
  if(!nav) return;
  nav.querySelectorAll(".am-nav-item").forEach(b => {
    const active = b.dataset.key === key && stage.classList.contains("open");
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function onNavClick(e){
  const btn = e.target.closest(".am-nav-item");
  if(!btn) return;
  const key = btn.dataset.key;
  if(key === currentKey && stage.classList.contains("open")){ closeStage(); return; }
  openPane(key);
}

/* ---------- 初始化 ---------- */

export function init(){
  if(inited) return;
  if(!document.body) return;
  inited = true;
  injectCss();
  buildDom();
  getSse();
  bindThemeToggle();
  window.__amOpenDashboard = (key) => { openPane(key || currentKey || NAV[0].key); };
  const btn = document.getElementById("dashboard-btn");
  if(btn) btn.addEventListener("click", () => { openPane(currentKey || NAV[0].key); });
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", init);
}else{
  init();
}

/* ============================================================
 * Agent MCP · 仪表盘组件库（零依赖 SVG 自绘）
 * StatCard / Sparkline / BarStack / DonutChart / DataTable /
 * Timeline / 三态（empty/loading/error）。
 * 纯函数渲染字符串，调用方负责注入 DOM。
 * ============================================================ */

/* ---------- 工具 ---------- */

export function esc(v){ return String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
export function fmtInt(n){ return Number(n || 0).toLocaleString("zh-CN"); }
export function fmtUsd(v){ return "$" + (Number(v) || 0).toFixed(2); }
export function fmtTime(ts){
  if(ts == null) return "—";
  const n = (typeof ts === "number" || /^\d+$/.test(String(ts))) ? Number(ts) : Date.parse(ts);
  if(!Number.isFinite(n)) return String(ts);
  const d = new Date(n);
  const p = x => String(x).padStart(2,"0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
export function authToken(){
  if(window.__amToken) return window.__amToken;
  const m = (location.hash || "").match(/token=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}
export async function apiFetch(path){
  const headers = {};
  const t = authToken();
  if(t) headers["X-Auth-Token"] = t;
  const r = await fetch(path, { headers });
  if(!r.ok) throw new Error(`${path} HTTP ${r.status}`);
  return r.json().catch(() => ({}));
}

export const CLI_COLORS = {
  grok:"var(--grok,#C9A34F)", opencode:"var(--opencode,#6FA587)",
  omp:"var(--omp,#9A8EDA)", atomcode:"var(--atomcode,#5A9CD6)",
  codex:"var(--codex,#7FB5A0)", kimi:"var(--kimi,#C98A5A)",
  copilot:"var(--copilot,#8AB4F8)", pi:"var(--pi,#B48CD9)",
};
export function cliColor(cli){ return CLI_COLORS[String(cli||"").toLowerCase()] || "var(--claude,#C87A5A)"; }

export const ST_LABEL = { running:"运行中", terminated:"完成", queued:"排队", error:"失败",
  cancelled:"已取消", incomplete:"超时/失联", needs_advisor:"需决策", idle:"空闲" };
export const ST_CLS = { running:"run", terminated:"ok", error:"err", cancelled:"err",
  incomplete:"warn", needs_advisor:"warn", queued:"soft", idle:"soft" };

/* ---------- 统计卡（Hero 数字 + 标签 + 副文案 + 可选 sparkline） ---------- */

export function statCard({ k, v, sub, cls="", live=false, spark=null }){
  const sparkHtml = spark && spark.length > 1
    ? `<div class="am-spark">${sparkline(spark, 96, 26)}</div>` : "";
  return `<div class="am-dash-card ${cls}">
    <div class="am-dash-card-v ${live ? "am-live" : ""}">${esc(v)}</div>
    <div class="am-dash-card-k">${esc(k)}</div>
    ${sub ? `<div class="am-dash-card-s">${esc(sub)}</div>` : ""}
    ${sparkHtml}
  </div>`;
}

/* ---------- Sparkline（迷你折线，SVG path） ---------- */

export function sparkline(points, w=96, h=26, color="var(--accent,#D96B4F)"){
  const vals = points.map(Number);
  if(!vals.length) return "";
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = (max - min) || 1;
  const stepX = w / Math.max(vals.length - 1, 1);
  const coords = vals.map((v, i) => [
    (i * stepX).toFixed(1),
    (h - 2 - ((v - min) / range) * (h - 6)).toFixed(1),
  ]);
  const path = coords.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
  const area = `${path} L${w},${h} L0,${h} Z`;
  return `<svg class="am-spark-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${area}" fill="${color}" opacity=".12"/>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${coords[coords.length-1][0]}" cy="${coords[coords.length-1][1]}" r="2" fill="${color}"/>
  </svg>`;
}

/* ---------- 堆叠柱（输入/输出/缓存 三段） ---------- */

export function barStack({ buckets, w=100, h=40 }){
  // buckets: [{in, out, cache}]
  const max = Math.max(1, ...buckets.map(b => (b.in||0)+(b.out||0)+(b.cache||0)));
  const bw = Math.max(3, Math.floor(w / buckets.length) - 2);
  const bars = buckets.map((b, i) => {
    const hIn = Math.round((b.in||0)/max*h), hOut = Math.round((b.out||0)/max*h), hC = Math.round((b.cache||0)/max*h);
    const x = i * (bw + 2);
    return `<g class="am-bar-col" transform="translate(${x},${h - hIn - hOut - hC})">
      <rect class="am-bar-in"  x="0" y="${hIn+hOut}" width="${bw}" height="${hC}" rx="1"/>
      <rect class="am-bar-out" x="0" y="${hIn}"     width="${bw}" height="${hOut}" rx="1"/>
      <rect class="am-bar-cache" x="0" y="0"        width="${bw}" height="${hIn}" rx="1"/>
    </g>`;
  }).join("");
  return `<svg class="am-barstack" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${bars}</svg>`;
}

/* ---------- Donut 环形图（多段） ---------- */

export function donut({ slices, size=120, stroke=14 }){
  // slices: [{value, color, label}]
  const total = Math.max(1, ...slices.map(s => s.value || 0)) ;
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, cx = size/2, cy = size/2;
  let acc = 0;
  const segs = slices.map((s, i) => {
    const frac = (s.value || 0) / total;
    const dash = frac * c;
    const off = -acc * c; acc += frac;
    return `<circle class="am-donut-seg" cx="${cx}" cy="${cy}" r="${r}" fill="none"
      stroke="${s.color || "var(--accent,#D96B4F)"}" stroke-width="${stroke}"
      stroke-dasharray="${dash.toFixed(1)} ${(c-dash).toFixed(1)}"
      stroke-dashoffset="${off.toFixed(1)}"
      transform="rotate(-90 ${cx} ${cy})" data-i="${i}">
      <title>${esc(s.label||"")}: ${fmtInt(s.value)}</title>
    </circle>`;
  }).join("");
  return `<svg class="am-donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${segs}</svg>`;
}

/* ---------- 可排序表格 ---------- */

export function sortableTable({ headers, rows, onSort, sortKey, sortDir }){
  const thead = headers.map(h => `
    <th data-key="${h.key}" class="${h.align === "right" ? "num" : ""} ${sortKey === h.key ? "sorted" : ""}"
        role="button" tabindex="0" aria-sort="${sortKey === h.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}">
      ${esc(h.label)}${sortKey === h.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </th>`).join("");
  const tbody = rows.map(r => `<tr>${headers.map(h => `<td class="${h.align === "right" ? "num" : ""}">${r[h.key] ?? "—"}</td>`).join("")}</tr>`).join("");
  return { html: `<table class="am-dtable"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`,
           theadEl: null, bind: null };
}

/* ---------- 时间线 ---------- */

export function timeline(items){
  // items: [{ts, type, text, agent, color}]
  return `<div class="am-timeline">${items.map(it => `
    <div class="am-tl-item">
      <span class="am-tl-dot" style="background:${it.color || "var(--accent,#D96B4F)"}"></span>
      <span class="am-tl-time">${fmtTime(it.ts)}</span>
      <span class="am-tl-type">${esc(it.type)}</span>
      <span class="am-tl-agent">${esc(it.agent || "")}</span>
      <span class="am-tl-text">${esc(it.text || "")}</span>
    </div>`).join("")}</div>`;
}

/* ---------- 三态 ---------- */

export function emptyState(msg, icon="◌"){ return `<div class="am-state empty"><span class="am-state-ico">${icon}</span><span>${esc(msg)}</span></div>`; }
export function loadingState(msg="加载中…"){ return `<div class="am-state loading">${esc(msg)}<span class="am-shimmer"></span></div>`; }
export function errorState(msg, onRetry){
  return `<div class="am-state error"><span class="am-state-ico">⚠</span><span>${esc(msg)}</span>
    ${onRetry ? `<button class="am-btn am-btn-retry" type="button">重试</button>` : ""}</div>`;
}

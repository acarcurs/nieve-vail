"use strict";
/* ---------- utilities ---------- */
const $ = (s, r = document) => r.querySelector(s) || document.createElement("div");
const MES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const DIA = ["dom","lun","mar","mié","jue","vie","sáb"];
const d2n = s => Math.round(Date.UTC(+s.slice(0,4), +s.slice(5,7)-1, +s.slice(8,10)) / 864e5);
const n2d = n => new Date(n * 864e5).toISOString().slice(0,10);
const n2date = n => new Date(n * 864e5);
const fmtD = n => { const d = n2date(n); return d.getUTCDate() + " " + MES[d.getUTCMonth()]; };
const fmtDL = n => { const d = n2date(n); return DIA[d.getUTCDay()] + " " + d.getUTCDate() + " " + MES[d.getUTCMonth()]; };
const md = n => n2d(n).slice(5);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function el(tag, attrs, ...kids){
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)){
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const SVGNS = "http://www.w3.org/2000/svg";
function sv(tag, attrs, ...kids){
  const e = document.createElementNS(SVGNS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
let UNITS = "metric";
window.UNITS_NOW = () => UNITS;
try { UNITS = localStorage.getItem("units") || "metric"; } catch (e) {}
const len = (inch, dec) => inch == null ? "–" : (UNITS === "metric"
  ? (Math.round(inch * 2.54 * (dec ? 10 : 1)) / (dec ? 10 : 1)).toLocaleString("es-MX") + " cm"
  : (Math.round(inch * (dec ? 10 : 1)) / (dec ? 10 : 1)).toLocaleString("es-MX") + " in");
const num = inch => UNITS === "metric" ? Math.round(inch * 2.54).toLocaleString("es-MX") : (inch < 10 ? (Math.round(inch * 10) / 10).toLocaleString("es-MX") : Math.round(inch).toLocaleString("es-MX"));
const lenRange = (lo, hi) => num(lo) + "–" + num(hi) + " " + (UNITS === "metric" ? "cm" : "in");
const lenParts = inch => UNITS === "metric" ? [Math.round(inch * 2.54).toLocaleString("es-MX"), "cm"] : [Math.round(inch).toLocaleString("es-MX"), "in"];
const temp = f => f == null ? "–" : UNITS === "metric" ? Math.round((f - 32) * 5 / 9) + "°" : Math.round(f) + "°";
const tempC = c => c == null ? "–" : UNITS === "metric" ? Math.round(c) + "°" : Math.round(c * 9 / 5 + 32) + "°";
const EN_M = {January:0,February:1,March:2,April:3,May:4,June:5,July:6,August:7,September:8,October:9,November:10,December:11};
const vailUpd = t => { const m = /Updated (\w+) (\d+), (\d{4}) at (\d+):(\d+) (AM|PM) ?(\w*)/.exec(t || ""); return m ? m[2] + " " + MES[EN_M[m[1]]] + ", " + m[4] + ":" + m[5] + (m[6] === "AM" ? " a. m. " : " p. m. ") + m[7] : (t || "–"); };
const SKY = {"Sunny":"Soleado","Mostly Sunny":"Mayormente soleado","Partly Sunny":"Parcialmente soleado","Partly Cloudy":"Parcialmente nublado","Mostly Cloudy":"Mayormente nublado","Cloudy":"Nublado","Overcast":"Cubierto","Clear":"Despejado","Mostly Clear":"Mayormente despejado","Snow":"Nieve","Light Snow":"Nevada ligera","Heavy Snow":"Nevada intensa","Snow Showers":"Chubascos de nieve","Scattered Snow Showers":"Chubascos de nieve dispersos","Chance Snow Showers":"Posibles chubascos de nieve","Chance of Snow":"Posible nieve","Flurries":"Copos aislados","Rain":"Lluvia","Rain and Snow":"Lluvia y nieve","Rain/Snow":"Lluvia/nieve","Windy":"Ventoso","Fog":"Niebla","Blowing Snow":"Ventisca","Thunderstorms":"Tormentas"};
const sky = t => SKY[t] || t || "–";
const pct = p => (p < 0.005 ? "<1" : p > 0.995 ? ">99" : Math.round(p * 100)) + "%";

/* ---------- state ---------- */
let S = null, L = null, M = null;   // static, live, model results
let INS = null, SAT = null, CM = null, MAPST = null, OSMGEO = null, STATUS = null, SP = null;   // insights, satellite, trained forecast model, map status
let selTarget = null, cmpSeason = "2025";

/* ---------- model ---------- */
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function seasonPool(){
  return Object.entries(S.seasons).map(([y, s]) => {
    const n0 = d2n(s.start), inc = {}, late = [];
    for (let i = 0; i < s.swe.length - 1; i++){
      const a = s.swe[i], b = s.swe[i + 1]; const k = md(n0 + i);
      inc[k] = (a != null && b != null) ? b - a : 0;
      if (k >= "01-11" && k <= "02-09") late.push(inc[k]);
    }
    return { y, inc, late };
  });
}
function simulate(o){
  const rnd = mulberry32(o.seed || 7), N = o.n || 4000;
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const [b0, b1] = o.beta, c = o.cov;
  const l11 = Math.sqrt(c[0][0]), l21 = c[1][0] / l11, l22 = Math.sqrt(Math.max(1e-12, c[1][1] - l21 * l21));
  const pool = o.pool, slr = o.slr, sig = 0.6;
  const B0 = new Float64Array(N), B1 = new Float64Array(N), K = new Int32Array(N), FM = new Float64Array(N), FM2 = new Float64Array(N);
  for (let i = 0; i < N; i++){
    const z1 = gauss(), z2 = gauss();
    B0[i] = b0 + l11 * z1; B1[i] = b1 + l21 * z1 + l22 * z2;
    K[i] = Math.floor(rnd() * pool.length);
    FM[i] = Math.exp(-sig * sig / 2 + sig * gauss());
    FM2[i] = Math.exp(-0.03125 + 0.25 * gauss());     // shared error along a path (storms are correlated)
  }
  const surv = new Float64Array(N).fill(1), swe = new Float64Array(N).fill(o.swe0);
  const out = [];
  for (let d = o.t0 + 1; d <= o.end; d++){
    const prev = d - 1, k = md(prev), c = o.cumbre[n2d(prev)];
    const atRisk = d >= o.riskStart;
    let s = 0;
    for (let i = 0; i < N; i++){
      let g;
      if (c && c.qs && c.qs.length === 11 && (c.kind === "det" || c.kind === "ens")){ const u = rnd() * 10, j = Math.min(9, Math.floor(u)); g = (c.qs[j] + (c.qs[j + 1] - c.qs[j]) * (u - j)) * FM2[i] / slr; }   // Cumbre distribution (deciles)
      else if (c && c.kind === "det") g = c.mean * FM[i] * Math.exp(0.35 * gauss() - 0.06125) / slr;            // quantitative forecast days
      else if (c && c.kind === "prob") g = rnd() < c.p ? c.clim.wet * Math.exp(0.7 * gauss() - 0.245) / slr : 0;   // probability x typical storm
      else { const P = pool[K[i]]; g = (k in P.inc) ? P.inc[k] : P.late[Math.floor(rnd() * P.late.length)]; }
      swe[i] = Math.max(0, swe[i] + g);
      if (atRisk){
        let z = B0[i] + B1[i] * swe[i];
        if (o.news && d - o.t0 <= 10) z += 0.5 * o.news;
        let h = 1 / (1 + Math.exp(-z));
        if (o.announced != null && d === o.announced) h = Math.max(h, 0.95);
        surv[i] *= 1 - h;
      }
      s += surv[i];
    }
    out.push({ d, p: 1 - s / N });
  }
  return out;
}
const logit = p => Math.log(p / (1 - p));
const sweNeeded = (beta, pWeek) => (logit(1 - Math.pow(1 - pWeek, 1 / 7)) - beta[0]) / beta[1];

function runModel(){
  const sn = L.snotel || [];
  const last = sn.filter(r => r.swe != null).slice(-1)[0];
  const t0 = d2n(last.date), swe0 = last.swe;
  const hist = L.history_vail || [];
  const firstOpen = hist.find(h => (h.trails_open || 0) > 0);
  const bbFirst = hist.find(h => (h.bb_trails_open || 0) > 0);
  const bbNow = (L.terrain && L.terrain.bb_trails_open) || 0;
  const syear = n2date(t0).getUTCMonth() >= 6 ? n2date(t0).getUTCFullYear() : n2date(t0).getUTCFullYear() - 1;
  const end = d2n((syear + 1) + "-03-15");
  const cumbre = {};
  for (const c of ((L.cumbre || {}).days || [])) cumbre[c.date] = c;
  const news = L.news || {};
  const res = simulate({ t0, swe0, end, cumbre, pool: seasonPool(), beta: S.model.beta, cov: S.model.cov, slr: S.model.slr,
    riskStart: firstOpen ? d2n(firstOpen.date) : t0 + 1, news: +news.signal || 0,
    announced: news.announced_date ? d2n(news.announced_date) : null });
  const at = n => { const r = res.find(x => x.d === n); return r ? r.p : (n <= t0 ? 0 : 1); };
  const first = thr => { const r = res.find(x => x.p >= thr); return r ? r.d : null; };
  // climatology: share of past seasons opened by the same day of season
  const s0 = d2n(syear + "-10-01");
  const offs = S.openings.map(o => d2n(o.date) - d2n(o.season + "-10-01"));
  const clim = res.map(r => ({ d: r.d, p: offs.filter(x => x <= r.d - s0).length / offs.length }));
  return { t0, swe0, syear, end, res, at, clim, med: first(0.5), p10: first(0.1), p90: first(0.9),
    open: bbNow > 0 || !!bbFirst, bbFirst: bbFirst ? bbFirst.date : null, bbNow,
    need50: sweNeeded(S.model.beta, 0.5), need80: sweNeeded(S.model.beta, 0.8), medRow: last };
}

/* ---------- charts ---------- */
function niceTicks(max, n){ const raw = max / n, mag = Math.pow(10, Math.floor(Math.log10(raw))); const st = [1,2,2.5,5,10].map(x => x * mag).find(x => x >= raw); const t = [0]; while (t[t.length - 1] < max - 1e-9) t.push(+(t[t.length - 1] + st).toFixed(6)); if (t.length < 2) t.push(st); return t; }
function legend(host, items){ host.replaceChildren(...items.map(it => el("span", { style: "--c:" + it.c }, el("i", { class: it.box ? "box" : null }), it.n))); }
function attachTip(wrap, svg, W, H, pad, xs, xToPx, rowsAt, extra){
  const tip = el("div", { class: "tip", role: "status" }); wrap.append(tip);
  const cross = sv("line", { y1: pad.t, y2: H - pad.b, stroke: css("--axis"), "stroke-width": 1, visibility: "hidden" });
  const dots = sv("g", { visibility: "hidden" });
  svg.append(cross, dots);
  const hit = sv("rect", { x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: H - pad.t - pad.b, fill: "transparent", tabindex: 0, "aria-label": "Mover para ver valores" });
  svg.append(hit);
  let idx = -1;
  const show = x => {
    let best = 0, bd = 1e9; xs.forEach((v, i) => { const dd = Math.abs(xToPx(v) - x); if (dd < bd){ bd = dd; best = i; } });
    idx = best; const px = xToPx(xs[best]);
    cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
    const info = rowsAt(xs[best]);
    dots.replaceChildren(...info.rows.filter(r => r.py != null).map(r => sv("circle", { cx: px, cy: r.py, r: 4.5, fill: r.c, stroke: css("--card"), "stroke-width": 2 })));
    dots.setAttribute("visibility", "visible");
    tip.replaceChildren(el("div", { class: "d" }, info.title), ...info.rows.map(r => el("div", { class: "row" }, el("span", { style: "display:flex;align-items:center;gap:6px;color:var(--ink-2)" }, el("i", { style: "--c:" + r.c }), r.n), el("b", null, r.v))));
    tip.style.display = "block";
    const tw = tip.offsetWidth, ww = wrap.clientWidth;
    tip.style.left = clamp(px + 12, 0, ww - tw) + "px"; tip.style.top = (pad.t + 2) + "px";
    if (px + 12 + tw > ww) tip.style.left = Math.max(0, px - tw - 12) + "px";
  };
  const hide = () => { cross.setAttribute("visibility", "hidden"); dots.setAttribute("visibility", "hidden"); tip.style.display = "none"; };
  const pos = ev => { const r = svg.getBoundingClientRect(); return (ev.clientX - r.left) * (W / r.width); };
  let tapped = false;      // a tap also focuses the chart: keep the tapped point, not the last one
  hit.addEventListener("pointermove", ev => show(pos(ev)));
  hit.addEventListener("pointerdown", ev => { tapped = true; show(pos(ev)); });
  hit.addEventListener("pointerleave", ev => { if (ev.pointerType === "mouse") hide(); });
  hit.addEventListener("focus", () => { if (!tapped) show(xToPx(xs[xs.length - 1])); tapped = false; });
  hit.addEventListener("blur", () => { tapped = false; hide(); });
  hit.addEventListener("keydown", ev => { if (ev.key === "ArrowLeft" || ev.key === "ArrowRight"){ idx = clamp(idx + (ev.key === "ArrowRight" ? 1 : -1), 0, xs.length - 1); show(xToPx(xs[idx])); ev.preventDefault(); } });
  document.addEventListener("pointerdown", ev => { if (!wrap.contains(ev.target)) hide(); });
}
function lineChart(host, cfg){
  host.replaceChildren();
  const W = Math.max(280, host.clientWidth || 340), H = cfg.height || 210;
  const pad = { l: cfg.padL || 38, r: cfg.padR || 14, t: cfg.yUnit ? 26 : 14, b: 24 };
  const [x0, x1] = cfg.x, [y0, y1] = cfg.y;
  const X = v => pad.l + (v - x0) / (x1 - x0) * (W - pad.l - pad.r);
  const Y = v => H - pad.b - (v - y0) / (y1 - y0) * (H - pad.t - pad.b);
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": cfg.aria || "" });
  for (const t of cfg.yTicks){
    svg.append(sv("line", { x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t), stroke: t === y0 ? css("--axis") : css("--line"), "stroke-width": 1 }));
    svg.append(sv("text", { x: pad.l - 6, y: Y(t) + 4, "text-anchor": "end" }, cfg.yFmt(t)));
  }
  // month ticks
  const xt = cfg.xTicks || (() => { const t = []; for (let n = x0; n <= x1; n++){ const s = n2d(n); if (s.endsWith("-01")) t.push(n); } return t; })();
  for (const n of xt){
    svg.append(sv("line", { x1: X(n), x2: X(n), y1: H - pad.b, y2: H - pad.b + 4, stroke: css("--axis") }));
    svg.append(sv("text", { x: X(n), y: H - 6, "text-anchor": "middle" }, cfg.xFmt ? cfg.xFmt(n) : (n2d(n).endsWith("-01") ? MES[n2date(n).getUTCMonth()] : fmtD(n))));
  }
  if (cfg.band){
    const b = cfg.band.pts; let dpath = "M" + b.map(p => X(p[0]).toFixed(1) + "," + Y(p[2]).toFixed(1)).join("L");
    dpath += "L" + b.slice().reverse().map(p => X(p[0]).toFixed(1) + "," + Y(p[1]).toFixed(1)).join("L") + "Z";
    svg.append(sv("path", { d: dpath, fill: cfg.band.c, opacity: 0.16 }));
  }
  for (const v of (cfg.vlines || [])){
    svg.append(sv("line", { x1: X(v.x), x2: X(v.x), y1: pad.t, y2: H - pad.b, stroke: css("--ink-2"), "stroke-width": 1 }));
    if (v.label) svg.append(sv("text", { x: clamp(X(v.x), pad.l + 20, W - pad.r - 20), y: pad.t - 3, "text-anchor": "middle", class: "lbl" }, v.label));
  }
  for (const s of cfg.series){
    const pts = s.pts.filter(p => p[1] != null && p[0] >= x0 && p[0] <= x1);
    if (!pts.length) continue;
    const dl = "M" + pts.map(p => X(p[0]).toFixed(1) + "," + Y(p[1]).toFixed(1)).join("L");
    if (s.area) svg.append(sv("path", { d: dl + `L${X(pts[pts.length-1][0]).toFixed(1)},${Y(y0)}L${X(pts[0][0]).toFixed(1)},${Y(y0)}Z`, fill: s.c, opacity: 0.10 }));
    svg.append(sv("path", { d: dl, fill: "none", stroke: s.c, "stroke-width": s.w || 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    if (s.dots) for (const p of pts) svg.append(sv("circle", { cx: X(p[0]), cy: Y(p[1]), r: 3.2, fill: s.c, stroke: css("--card"), "stroke-width": 1.5 }));
    if (s.end){ const p = pts[pts.length - 1]; svg.append(sv("circle", { cx: X(p[0]), cy: Y(p[1]), r: 4.5, fill: s.c, stroke: css("--card"), "stroke-width": 2 })); }
  }
  for (const m of (cfg.marks || [])){
    svg.append(sv("circle", { cx: X(m.x), cy: Y(m.y), r: m.r || 5, fill: m.hollow ? css("--card") : m.c, stroke: m.hollow ? m.c : css("--card"), "stroke-width": 2 }));
    if (m.label) svg.append(sv("text", { x: clamp(X(m.x) + (m.dx || 8), pad.l, W - pad.r - 4), y: Y(m.y) + (m.dy || -8), "text-anchor": m.anchor || "start", class: "lbl" }, m.label));
  }
  if (cfg.yUnit) svg.append(sv("text", { x: pad.l - 6, y: pad.t - 12, "text-anchor": "end" }, cfg.yUnit));
  host.append(svg);
  if (cfg.tip) attachTip(host, svg, W, H, pad, cfg.tip.xs, X, x => cfg.tip.rows(x, Y));
}
function barChart(host, cfg){
  host.replaceChildren();
  const W = Math.max(280, host.clientWidth || 340), H = cfg.height || 190;
  const pad = { l: 34, r: 8, t: 22, b: cfg.sub2 ? 48 : 34 };
  const n = cfg.bars.length, slot = (W - pad.l - pad.r) / n, bw = Math.min(24, slot * 0.55);
  const ymax = Math.max(cfg.minMax || 1, ...cfg.bars.map(b => Math.max(b.v || 0, b.hi || 0)));
  const ticks = niceTicks(ymax, 3), top = ticks[ticks.length - 1];
  const Y = v => H - pad.b - v / top * (H - pad.t - pad.b);
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": cfg.aria || "" });
  for (const t of ticks){
    svg.append(sv("line", { x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t), stroke: t === 0 ? css("--axis") : css("--line") }));
    svg.append(sv("text", { x: pad.l - 6, y: Y(t) + 4, "text-anchor": "end" }, cfg.fmt(t, true)));
  }
  if (cfg.yUnit) svg.append(sv("text", { x: pad.l - 6, y: Y(top) - 9, "text-anchor": "end" }, cfg.yUnit));
  if (cfg.sub2 && cfg.sub2Label) svg.append(sv("text", { x: pad.l - 6, y: H - pad.b + 42, "text-anchor": "end", style: "font-size:9.5px" }, cfg.sub2Label));
  const tip = el("div", { class: "tip" }); host.append(tip);
  cfg.bars.forEach((b, i) => {
    const cx = pad.l + slot * (i + .5), x = cx - bw / 2;
    const g = sv("g", { tabindex: 0, "aria-label": b.label + ": " + (b.v == null ? "sin dato" : cfg.fmt(b.v)) });
    if (cfg.wash && b.hi != null && b.hi > (b.v || 0)){
      const y1 = Y(b.hi), y0 = Y(b.v || 0), rr = Math.min(4, (y0 - y1) / 2);
      g.append(sv("path", { d: `M${x},${y0}V${y1 + rr}Q${x},${y1} ${x + rr},${y1}H${x + bw - rr}Q${x + bw},${y1} ${x + bw},${y1 + rr}V${y0}Z`, fill: b.c || css("--accent"), "fill-opacity": +css("--wash-op") || 0.16 }));
    }
    if (b.v != null && b.v > 0){
      const h = Y(0) - Y(b.v), r = Math.min(4, h);
      g.append(sv("path", { d: `M${x},${Y(0)}V${Y(b.v) + r}Q${x},${Y(b.v)} ${x + r},${Y(b.v)}H${x + bw - r}Q${x + bw},${Y(b.v)} ${x + bw},${Y(b.v) + r}V${Y(0)}Z`, fill: b.c || css("--accent"), "fill-opacity": b.op == null ? 1 : b.op }));
    }
    if (!cfg.wash && b.hi != null && b.lo != null && b.hi > b.lo) g.append(sv("line", { x1: cx, x2: cx, y1: Y(b.lo), y2: Y(b.hi), stroke: css("--ink-2"), "stroke-width": 1.5 }));
    svg.append(sv("text", { x: cx, y: (cfg.wash ? Y(b.v || 0) : Y(Math.max(b.v || 0, b.hi || 0))) - 5, "text-anchor": "middle", class: "lbl" }, b.v == null ? "–" : cfg.fmt(b.v)));
    const yb = H - pad.b;
    svg.append(sv("text", { x: cx, y: yb + 15, "text-anchor": "middle" }, b.label));
    svg.append(sv("text", { x: cx, y: yb + 28, "text-anchor": "middle" }, b.sub || ""));
    if (cfg.sub2) svg.append(sv("text", { x: cx, y: yb + 42, "text-anchor": "middle", style: "font-size:9.5px" }, b.sub2 || ""));
    g.append(sv("rect", { x: cx - slot / 2, y: pad.t, width: slot, height: H - pad.t - pad.b, fill: "transparent" }));
    const show = () => { tip.replaceChildren(el("div", { class: "d" }, b.title || b.label), ...(b.tip || []).map(t => el("div", { class: "row" }, el("span", { style: "color:var(--ink-2)" }, t[0]), el("b", null, t[1])))); tip.style.display = "block"; const tw = tip.offsetWidth; tip.style.left = clamp(cx - tw / 2, 0, host.clientWidth - tw) + "px"; tip.style.top = "0px"; };
    g.addEventListener("pointerenter", show); g.addEventListener("pointerdown", show); g.addEventListener("focus", show);
    g.addEventListener("pointerleave", () => tip.style.display = "none"); g.addEventListener("blur", () => tip.style.display = "none");
    svg.append(g);
  });
  host.append(svg);
}

/* ---------- views ---------- */
function ago(iso){
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 2) return "hace un momento";
  if (m < 60) return "hace " + m + " min";
  if (m < 24 * 60) return "hace " + Math.round(m / 60) + " h";
  return "el " + new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
function renderHeader(){
  $("#updated").textContent = L.generated_at ? "Actualizado " + ago(L.generated_at) : "";
}
function renderHoy(){
  const T = L.terrain || {};
  const pill = $("#bb-pill"), sign = $("#sign");
  if (M.open){
    pill.className = "pill open"; pill.replaceChildren(el("i"), "Abiertos");
    sign.style.setProperty("--stripe", css("--good"));
    $("#sign-sub").textContent = (M.bbNow ? M.bbNow + " pistas abiertas hoy" : "Abrieron el " + fmtD(d2n(M.bbFirst)));
  } else {
    pill.className = "pill closed"; pill.replaceChildren(el("i"), "Cerrados");
    sign.style.setProperty("--stripe", "#d03b3b");
    $("#sign-sub").textContent = "0 de " + (T.bb_trails_total || 55) + " pistas · reporte del " + (L.terrain_date ? fmtD(d2n(L.terrain_date)) : "–");
  }
  // date input
  const inp = $("#target"), minN = M.t0 + 1, maxN = M.end;
  inp.min = n2d(minN); inp.max = n2d(maxN);
  if (selTarget == null){ const def = d2n(M.syear + "-12-24"); selTarget = def > M.t0 ? def : (M.med || minN + 14); }
  inp.value = n2d(selTarget);
  inp.onchange = () => { if (inp.value){ selTarget = clamp(d2n(inp.value), minN, maxN); updateProb(); } };
  const quick = [["15 dic", M.syear + "-12-15"], ["24 dic", M.syear + "-12-24"], ["1 ene", (M.syear + 1) + "-01-01"], ["15 ene", (M.syear + 1) + "-01-15"], ["1 feb", (M.syear + 1) + "-02-01"]].filter(q => d2n(q[1]) > M.t0);
  $("#quick").replaceChildren(...quick.map(([lab, iso]) => el("button", { type: "button", class: "chip", "data-n": d2n(iso), onclick: () => { selTarget = d2n(iso); inp.value = iso; updateProb(); } }, lab)));
  updateProb();
  renderDeficit();
  renderNow();
  renderNews();
  renderAnalogs();
}
function updateProb(){
  const p = M.open ? 1 : M.at(selTarget);
  $("#p-big").replaceChildren(String(M.open ? "100" : pct(p).replace("%", "")), el("span", { class: "u" }, "%"));
  $("#quick").querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", String(+c.dataset.n === selTarget)));
  if (M.open){
    $("#p-sub").textContent = "Ya están abiertos. El modelo vuelve a calcular la próxima temporada.";
  } else {
    const parts = [];
    if (M.med) parts.push("Fecha más probable: " + fmtD(M.med));
    if (M.p10 && M.p90) parts.push("casi seguro entre el " + fmtD(M.p10) + " y el " + fmtD(M.p90));
    $("#p-sub").textContent = parts.join(", ") + ".";
  }
  // chart
  const end = d2n((M.syear + 1) + "-02-28");
  const prob = M.res.filter(r => r.d <= end).map(r => [r.d, r.p * 100]);
  const clim = M.clim.filter(r => r.d <= end).map(r => [r.d, r.p * 100]);
  const A = css("--accent"), G = css("--muted");
  legend($("#lg-prob"), [{ n: "Este año", c: A }, { n: "Promedio histórico", c: G }]);
  lineChart($("#ch-prob"), {
    x: [M.t0, end], y: [0, 100], yTicks: [0, 25, 50, 75, 100], yFmt: v => v + "%", height: 200, aria: "Probabilidad acumulada de apertura por fecha",
    series: [{ pts: clim, c: G, w: 1.5 }, { pts: prob, c: A, area: true }],
    vlines: [{ x: selTarget, label: fmtD(selTarget) }],
    marks: [{ x: selTarget, y: (M.open ? 1 : M.at(selTarget)) * 100, c: A, label: pct(M.open ? 1 : M.at(selTarget)), dx: selTarget > (M.t0 + end) / 2 ? -8 : 8, anchor: selTarget > (M.t0 + end) / 2 ? "end" : "start" }],
    tip: { xs: prob.map(p => p[0]).filter((_, i) => i % 1 === 0), rows: (x, Y) => { const a = prob.find(p => p[0] === x), b = clim.find(p => p[0] === x); return { title: fmtDL(x), rows: [{ n: "Este año", v: pct(a[1] / 100), c: A, py: Y(a[1]) }, { n: "Histórico", v: pct(b[1] / 100), c: G, py: Y(b[1]) }] }; } }
  });
}
function renderDeficit(){
  const need = M.need50, need80 = M.need80, cur = M.swe0, slr = S.model.slr;
  const defSwe = Math.max(0, need - cur), def80 = Math.max(0, need80 - cur);
  const [v, u] = lenParts(defSwe * slr);
  $("#def-big").replaceChildren("≈ " + v, el("span", { class: "u" }, u));
  $("#def-sub").textContent = M.open ? "Ya abrieron." :
    "de nieve nueva para tener 50% de probabilidad de que abran en una semana (para 80%: ≈ " + len(def80 * slr) + ").";
  const max = Math.max(need80 * 1.15, cur * 1.1, 7);
  const m = $("#meter");
  m.replaceChildren(
    el("div", { class: "fill", style: "width:" + clamp(cur / max * 100, 0.8, 100) + "%" }),
    el("div", { class: "tick", style: "left:" + (need / max * 100) + "%" }, el("em", null, "50% · " + len(need, true))),
    el("div", { class: "tick b", style: "left:" + (need80 / max * 100) + "%" }, el("em", null, "80% · " + len(need80, true))),
    el("div", { class: "now", style: "left:0" }, "Hoy: " + len(cur, true) + " de agua")
  );
  const cdays = ((L.cumbre || {}).days || []);
  if (cdays.length && !M.open){ const t15 = cumbreTotals(cdays); $("#def-sub").textContent += " Claude pronostica ≈ " + len(t15.m) + " en " + cdays.length + " días."; }
}
function renderNow(){
  const R = L.report || {}, T = L.terrain || {};
  const lf = liftsLabel();
  const tiles = [
    [len(R.h24), "Nieve 24 h"], [len(R.d7), "Nieve 7 días"], [len(R.base), "Base"],
    [len(R.season_total), "Acumulada"], [(T.trails_open ?? "–") + "/" + (T.trails_total ?? "–"), "Pistas abiertas"],
    [lf[0], lf[1].replace(" abiertas hoy", "").replace("Telesillas (cerradas por horario)", "Telesillas · de noche")],
  ];
  $("#now-kv").replaceChildren(...tiles.map(([b, t]) => el("div", null, el("b", null, b), el("span", null, t))));
  $("#now-src").textContent = "Reporte de Vail: " + vailUpd(R.updated_text) + ".";
}
function mergeInsights(){
  const I = INS || {};
  const ck = x => (x && x.checked) || "";
  if (I.news && ck(I.news) >= ck(L.news)) L.news = I.news;
  if (I.discussion) L.discussion = I.discussion;
  const hrs = (a, b) => (new Date(a) - new Date(b)) / 36e5;
  if (I.nws && I.nws.issued && L.nws && L.nws.issued && Math.abs(hrs(L.nws.issued, I.nws.issued)) <= 12) L.nws_es = I.nws;
  if (I.afd) L.afd_es = I.afd;
  const today = d2n(L.today || (L.generated_at || "").slice(0, 10) || n2d(d2n("2026-11-22")));
  const age = L.news && L.news.checked ? today - d2n(L.news.checked) : 99;
  const raw = (L.news_raw || {}).items || [];
  if (age > 4 && raw.length){
    L.news = { signal: 0, label: "Sin señales", checked: L.news_raw.checked, announced_date: null, raw: true,
      summary: "Titulares recientes en inglés. La señal de noticias para el modelo se revisa dos veces al día.", items: raw.slice(0, 5) };
  }
}
function renderNews(){
  const N = L.news || {}, D = L.discussion;
  const sig = +N.signal || 0;
  const lab = N.label || (sig > 0 ? "Señales a favor" : sig < 0 ? "Señales en contra" : "Sin señales");
  const col = sig >= 1 ? css("--good") : sig < 0 ? css("--crit") : css("--muted");
  const icon = sig > 0 ? "▲" : sig < 0 ? "▼" : "●";
  $("#news").replaceChildren(
    el("div", { class: "card" },
      el("p", { style: "margin:0 0 6px" }, el("span", { class: "sig", style: "border-color:" + col }, el("span", { style: "color:" + col }, icon), lab + (N.announced_date ? " · abren el " + fmtD(d2n(N.announced_date)) : ""))),
      N.summary ? el("p", { class: "small ink2", style: "margin:0 0 4px" }, N.summary) : null,
      el("ul", { class: "list" }, ...(N.items || []).slice(0, 3).map(it => el("li", null, el("div", { class: "l small" }, el("a", { href: it.url, target: "_blank", rel: "noopener" }, it.title), el("div", { class: "tiny muted" }, (it.source || "") + (it.date ? " · " + fmtD(d2n(it.date)) : "")))))),
      D && D.headline && !(N.items || []).slice(0, 3).some(it => /opensnow/i.test(it.source || "")) ? el("p", { class: "small", style: "margin:8px 0 0" }, el("b", null, "OpenSnow: "), el("a", { href: D.url, target: "_blank", rel: "noopener" }, D.headline)) : null));
}
function renderAnalogs(){
  const k = md(M.t0);
  const rows = S.openings.map(o => {
    const s = S.seasons[String(o.season)];
    const yr = k < "07-01" ? o.season + 1 : o.season; const idx = d2n(yr + "-" + k) - d2n(s.start);
    const sw = (idx >= 0 && idx < s.swe.length) ? s.swe[idx] : null;
    return { o, sw, gap: d2n(o.date) - d2n(yr + "-" + k) };
  }).filter(r => r.sw != null).sort((a, b) => Math.abs(a.sw - M.swe0) - Math.abs(b.sw - M.swe0)).slice(0, 4);
  $("#analogs").replaceChildren(...rows.map(r => el("li", null,
    el("div", { class: "l" }, el("b", null, r.o.season + "-" + String(r.o.season + 1).slice(2)), el("div", { class: "tiny muted" }, len(r.sw, true) + " de agua ese día · " + r.o.what)),
    el("div", { class: "r" }, el("b", null, fmtD(d2n(r.o.date))), el("div", { class: "tiny muted" }, r.gap > 0 ? r.gap + " días después" : "ya estaban abiertos")))));
}
const CARD = ["del norte", "del noreste", "del este", "del sureste", "del sur", "del suroeste", "del oeste", "del noroeste"];
const card = d => d == null ? "–" : CARD[Math.round(d / 45) % 8];
function cumbreTotals(days){
  const m = days.reduce((a, d) => a + d.mean, 0);
  const up = Math.sqrt(days.reduce((a, d) => a + Math.pow(d.hi - d.mean, 2), 0));
  const dn = Math.sqrt(days.reduce((a, d) => a + Math.pow(d.mean - d.lo, 2), 0));
  return { m, lo: Math.max(0, m - dn), hi: m + up };
}
const DIA2 = ["Do","Lu","Ma","Mi","Ju","Vi","Sá"];
const spanTxt = (a, b) => { const A = n2date(d2n(a)), B = n2date(d2n(b)); if (a === b) return fmtDL(d2n(a)); return DIA[A.getUTCDay()] + " " + A.getUTCDate() + (A.getUTCMonth() !== B.getUTCMonth() ? " " + MES[A.getUTCMonth()] : "") + " – " + fmtDL(d2n(b)); };
function cumbreStory(days){
  const runs = []; let cur = null;
  for (const d of days){ if (d.kind === "det" && d.mean >= 1.0){ if (!cur){ cur = []; runs.push(cur); } cur.push(d); } else cur = null; }
  const order = { alta: 0, media: 1, baja: 2 };
  const tot = runs.map(r => cumbreTotals(r).m), best = tot.length ? tot.indexOf(Math.max(...tot)) : -1;
  const items = runs.map((r, i) => {
    const t = cumbreTotals(r), cm = t.m * 2.54;
    const kind = cm < 5 ? "Nevada ligera" : cm < 15 ? "Nevada moderada" : cm < 30 ? "Buena nevada" : "Tormenta fuerte";
    const conf = r.map(d => d.conf).sort((a, b) => order[b] - order[a])[0];
    return [spanTxt(r[0].date, r[r.length - 1].date), kind + (runs.length > 1 && i === best ? ", la más fuerte" : "") + ": ≈ " + len(t.m) + " (" + lenRange(t.lo, t.hi) + ") · confianza " + conf];
  });
  if (!items.length){
    const detN = days.filter(d => d.kind === "det").length;
    items.push(["Próximos " + detN + " días", "Sin nevadas de más de " + (UNITS === "metric" ? "2 cm" : "1 in") + " en un día."]);
  }
  const pr = days.filter(d => d.kind !== "det");
  if (pr.length){
    const ps = pr.map(d => Math.round(d.p * 100)), lo = Math.min(...ps), hi = Math.max(...ps);
    items.push([spanTxt(pr[0].date, pr[pr.length - 1].date), "Probabilidad de nevada de " + (lo === hi ? lo : lo + " a " + hi) + "% por día según los ensambles. Todavía no hay cantidades confiables: la barra es el promedio de sus escenarios."]);
  }
  return items;
}
const SRC_ORDER = ["Vail", "NWS", "ECMWF", "AIFS", "GFS", "HRRR", "NBM", "ICON", "GEM", "UKMO", "JMA"];
const SRC_LABEL = { Vail: "Vail", NWS: "NWS", ECMWF: "ECMWF", AIFS: "AIFS", GFS: "GFS", HRRR: "HRRR", NBM: "NBM", ICON: "ICON", GEM: "GEM", UKMO: "UKMO", JMA: "JMA", Cumbre: "Claude" };
const SRC_DESC = { Vail: "pronóstico de Vail para la cima", NWS: "Servicio Meteorológico de EE. UU.", ECMWF: "modelo europeo", AIFS: "inteligencia artificial de ECMWF", GFS: "modelo global de EE. UU.", HRRR: "alta resolución de EE. UU. (2 días)", NBM: "mezcla oficial de EE. UU.", ICON: "modelo alemán", GEM: "modelo canadiense", UKMO: "modelo británico", JMA: "modelo japonés" };
function heatCell(v, maxV){
  if (v == null) return el("td", { class: "c", style: "color:var(--muted)" }, "·");
  if ((UNITS === "metric" ? Math.round(v * 2.54) : Math.round(v * 10)) === 0) return el("td", { class: "c", style: "color:var(--muted)" }, "0");
  const a = Math.min(0.75, 0.08 + v / maxV * 0.9);
  return el("td", { class: "c", style: "background:color-mix(in srgb, var(--accent) " + Math.round(a * 100) + "%, transparent)" }, UNITS === "metric" ? String(Math.round(v * 2.54)) : (Math.round(v * 10) / 10).toLocaleString("es-MX"));
}
function dayIcon(kind){
  const P = { snow: ["M12 3v18", "M4.2 7.5l15.6 9", "M4.2 16.5l15.6-9", "M9.5 4.5 12 7l2.5-2.5", "M9.5 19.5 12 17l2.5 2.5"],
    cloud: ["M6.5 17.5a4 4 0 0 1 .3-8 5.5 5.5 0 0 1 10.6 1.4 3.3 3.3 0 0 1 .2 6.6Z"],
    sun: ["M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z", "M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"] };
  return sv("svg", { viewBox: "0 0 24 24", class: "ic " + kind, "aria-hidden": "true", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round" },
    ...P[kind].map(d => sv("path", { d })));
}
function renderPronostico(){
  const C = L.cumbre || { days: [] };
  const days = C.days || [];
  const A = css("--accent");
  $("#fc-tot").replaceChildren(...[[5, "5 días"], [10, "10 días"], [days.length, days.length + " días"]].map(([n, lab]) => {
    const t = cumbreTotals(days.slice(0, n));
    return el("div", null, el("b", null, len(t.m)), el("span", null, lab), el("span", null, lenRange(t.lo, t.hi)));
  }));
  const cv = v => v == null ? null : (UNITS === "metric" ? v * 2.54 : v);
  barChart($("#ch-fc"), {
    aria: "Nieve pronosticada por día, " + days.length + " días", minMax: UNITS === "metric" ? 10 : 4, sub2: true, sub2Label: "%", wash: true, yUnit: UNITS === "metric" ? "cm" : "in", height: 230,
    bars: days.map(d => { const n = d2n(d.date); const op = d.kind !== "det" ? (+css("--prob-op") || 0.35) : d.conf === "alta" ? 1 : d.conf === "media" ? 0.72 : 0.55;
      return { label: DIA2[n2date(n).getUTCDay()], sub: String(n2date(n).getUTCDate()), sub2: String(Math.round(d.p * 100)), v: cv(d.mean), lo: cv(d.lo), hi: cv(d.hi), op,
        title: fmtDL(n) + (d.k === 0 ? " (hoy)" : ""),
        tip: [["Claude", len(d.mean, true)], ["Rango", lenRange(d.lo, d.hi)], ["Prob. de nevada", Math.round(d.p * 100) + "%"], ...(d.tmin != null ? [["Temp. cima", tempC(d.tmin) + " a " + tempC(d.tmax)]] : [])] }; }),
    fmt: (v, axis) => axis ? String(v) : (v < 0.05 ? "0" : UNITS === "metric" ? String(Math.round(v)) : (v < 10 ? (Math.round(v * 10) / 10).toLocaleString("es-MX") : String(Math.round(v))))
  });
  legend($("#lg-fc"), [{ n: "Pronóstico", c: A, box: true }, { n: "Lejano (aprox.)", c: "color-mix(in srgb, " + A + " " + Math.round((+css("--prob-op") || 0.35) * 100) + "%, transparent)", box: true }, { n: "Escenario alto", c: "color-mix(in srgb, " + A + " " + Math.round((+css("--wash-op") || 0.16) * 100) + "%, transparent)", box: true }]);
  $("#fc-story").replaceChildren(...cumbreStory(days).map(([a, b]) => el("li", null, el("div", { class: "l" }, el("b", null, a), el("div", { class: "small ink2" }, b)))));
  // day by day
  $("#fc-days").replaceChildren(...days.map(d => {
    const n = d2n(d.date), dt = n2date(n);
    const name = d.k === 0 ? "Hoy" : d.k === 1 ? "Mañana" : DIA[dt.getUTCDay()].replace(/^./, c => c.toUpperCase());
    const kind = d.mean >= 1 || d.p >= 0.5 ? "snow" : (d.p >= 0.15 || d.mean >= 0.3) ? "cloud" : "sun";
    const dry = d.mean < 0.1 && d.hi < 0.4;
    const srcs = SRC_ORDER.filter(k => d.srcs && d.srcs[k]).map(k => el("span", null, SRC_LABEL[k] + " ", el("b", null, len(d.srcs[k][0], true))));
    const more = [];
    if (srcs.length) more.push(el("div", null, "Cada fuente:"), el("div", { class: "srcs" }, ...srcs));
    if (d.twet != null && d.twet > 0.5) more.push(el("p", { class: "warn" }, "Puede caer como lluvia"));
    if (d.ens) more.push(el("p", { style: "margin:8px 0 0" }, "Escenarios con nieve: " + Math.round(d.ens.p_any * 100) + "% · con " + (UNITS === "metric" ? "15 cm" : "6 in") + " o más: " + Math.round(d.ens.p_6 * 100) + "%"));
    if (d.wdir != null && d.mean >= 0.5) more.push(el("p", { style: "margin:4px 0 0" }, "Viento al nevar: " + card(d.wdir)));
    if (d.kind !== "det") more.push(el("p", { style: "margin:4px 0 0" }, "Día lejano: cantidad aproximada."));
    return el("details", { class: "day" + (d.k === 0 ? " today" : "") },
      el("summary", null,
        el("div", { class: "dn" }, name, el("small", null, dt.getUTCDate() + " " + MES[dt.getUTCMonth()])),
        dayIcon(kind),
        el("div", { class: "amt" }, dry ? "Seco" : len(d.mean), el("small", null, dry ? "sin nieve" : lenRange(d.lo, d.hi))),
        el("div", { class: "pr" }, el("b", null, Math.round(d.p * 100) + "%"), d.tmin != null ? tempC(d.tmin) + " / " + tempC(d.tmax) : "")),
      el("div", { class: "more" }, ...more));
  }));
  // accuracy
  const T = CM, b1 = ((T || {}).blend || {})["1"];
  if (b1 && b1.mae != null){
    const full = Object.entries(b1.singles || {}).filter(([, v]) => v.n >= 0.8 * (b1.n || 0)).sort((a, b) => a[1].mae - b[1].mae);
    const best = full[0], gain = best ? 1 - best[1].blend / best[1].mae : null;
    $("#fc-acc").replaceChildren(el("b", null, "Qué tan bien le atina Claude"), el("br"),
      "Para mañana se equivoca en promedio " + len(b1.mae, true) + (gain > 0.005 ? ", " + Math.round(gain * 100) + "% menos que el mejor modelo por sí solo (" + best[0] + ")" : "") + ". Aprendió de " + T.n_days + " días de temporadas pasadas y se reentrena cada lunes.");
    $("#fc-acc").style.display = "";
  } else $("#fc-acc").style.display = "none";
  // NWS
  const N = L.nws || {}, NE = L.nws_es;
  const periods = (NE && NE.periods && NE.periods.length) ? NE.periods : (N.periods || []).map(p => {
    const t = window.NwsEs ? NwsEs.translate(p.text) : null;
    return { name: window.NwsEs ? NwsEs.periodName(p.name) : p.name, text: t || p.text };
  });
  $("#nws").replaceChildren(...periods.slice(0, 8).map(p => el("li", null, el("div", { class: "l" }, el("b", null, p.name), el("div", { class: "small ink2" }, p.text)))));
  $("#nws-meta").replaceChildren("NWS Grand Junction" + (N.issued ? " · " + ago(N.issued) : "") + " · ", el("a", { href: N.url || "https://forecast.weather.gov", target: "_blank", rel: "noopener" }, "weather.gov"));
  const AF = L.afd || {}, AE = L.afd_es;
  if (AE && AE.bullets && AE.bullets.length) $("#afd").replaceChildren(...AE.bullets.map(x => el("li", null, el("div", { class: "l small" }, x))));
  else { const sec = AF.sections || {}; const k = ["Key Messages", "Short Term", "Synopsis"].find(x => sec[x]);
    $("#afd").replaceChildren(k ? el("li", null, el("div", { class: "l small ink2", style: "white-space:pre-line" }, sec[k].slice(0, 900) + (sec[k].length > 900 ? "…" : ""))) : el("li", null, "–")); }
  $("#afd-meta").replaceChildren("NWS Grand Junction" + (AF.issued ? " · " + ago(AF.issued) : "") + (AE ? "" : " · en inglés") + " · ", el("a", { href: AF.url || "https://forecast.weather.gov", target: "_blank", rel: "noopener" }, "texto completo"));
  const D = L.discussion;
  $("#opensnow-row").style.display = D && D.headline ? "" : "none";
  if (D && D.headline) $("#opensnow").replaceChildren(el("a", { href: D.url, target: "_blank", rel: "noopener" }, D.headline), el("span", { class: "muted" }, " · " + (D.author || "") + (D.date ? ", " + fmtD(d2n(D.date)) : "")));
}

let mapReady = false;
function denverHour(){ try { return +new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", hour12: false }).format(new Date()) % 24; } catch (e) { return 12; } }
function liftsLabel(){
  const T = L.terrain || {}, n = liftsToday().size, h = denverHour();
  if (n === 0 && (h >= 16 || h < 9)) return ["–/" + (T.lifts_total ?? "–"), "Telesillas (cerradas por horario)", "telesillas cerradas por horario"];
  return [n + "/" + (T.lifts_total ?? "–"), "Telesillas abiertas hoy", n + " de " + (T.lifts_total ?? "–") + " telesillas abiertas hoy"];
}
function liftsToday(){
  const T = L.terrain || {}, lt = L.lifts_today;
  const set = new Set(lt && lt.date === L.terrain_date ? lt.names : []);
  for (const l of T.lifts || []) if ((l.s || "").toLowerCase() === "open") set.add(l.n);
  return set;
}
function renderMapa(){
  const T = L.terrain || { areas: [], lifts: [] };
  const LT = liftsToday();
  $("#map-sum").textContent = (T.trails_open ?? "–") + " de " + (T.trails_total ?? "–") + " pistas abiertas · " + liftsLabel()[2] + " · Back Bowls " + (T.bb_trails_open ?? 0) + "/" + (T.bb_trails_total ?? "–");
  legend($("#lg-map"), [{ n: "Pista abierta", c: "#35e05f" }, { n: "Cerrada", c: css("--closed") }, { n: "Telesilla abierta", c: "#ffd23f" }]);
  const ov = SAT && SAT.overlay;
  renderZoneDetail();
  if (mapReady){ if (window.Map3D){ Map3D.resize(); if (OSMGEO){ const st = liveMapStatus(); Map3D.update(Map3D.prepare(OSMGEO, st), ((st || {}).areas || {}).features || []); } } return; }
  const msg = $("#mapmsg");
  const fallback = err => { $("#map-layers").replaceChildren(); msg.textContent = "No pude cargar el mapa 3D (" + (err && err.message || err) + "). Te muestro el esquema."; setTimeout(() => msg.remove(), 4000); $("#map3d").replaceChildren(); renderMapaSchematic(); };
  const go = geo => {
    if (!window.Map3D) return fallback("falta map3d.js");
    const st = liveMapStatus();
    const areas = ((st || {}).areas || {}).features || [];
    Map3D.init($("#map3d"), { runs: Map3D.prepare(geo, st), areas, sat: ov ? { true: ov.true, snow: ov.snow, coordinates: ov.coordinates, date: fmtD(d2n(ov.date)) } : null,
      onNoTerrain: () => { const b = document.querySelector('#map-layers .chip[data-id="terrain"]'); if (b) { b.setAttribute("aria-pressed", "false"); b.disabled = true; b.textContent = "Relieve 3D no disponible"; } },
      onArea: name => { selZone = name; renderZoneDetail(); const f = areas.find(x => x.properties.name === name); if (f) Map3D.flyToArea(f.center); $("#zone-detail").scrollIntoView({ behavior: "smooth", block: "nearest" }); } })
      .then(() => { mapReady = true; if (msg.isConnected) msg.remove(); })
      .catch(fallback);
  };
  if (OSMGEO) go(OSMGEO);
  else fetch("data/map/vail_osm.geojson").then(r => r.json()).then(g => { OSMGEO = g; go(g); }).catch(fallback);
  document.querySelectorAll(".mapviews .chip").forEach(b => b.onclick = () => {
    document.querySelectorAll(".mapviews .chip").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    Map3D.setView(b.dataset.view);
  });
  const layers = [["s2", ov ? "Satélite · " + fmtD(d2n(ov.date)) : null, true], ["snow", ov ? "Nieve detectada" : null, false], ["aerial", "Foto aérea (verano)", false], ["terrain", "Relieve 3D", true]].filter(x => x[1]);
  const state = Object.fromEntries(layers.map(x => [x[0], x[2]]));
  $("#map-layers").replaceChildren(...layers.map(([id, lab]) => el("button", { type: "button", class: "chip", "aria-pressed": String(state[id]), onclick: e => {
    state[id] = !state[id]; e.currentTarget.setAttribute("aria-pressed", String(state[id]));
    if (id === "aerial" && state.aerial && state.s2){ state.s2 = false; Map3D.setLayer("s2", false); const b = document.querySelector('#map-layers .chip[data-id="s2"]'); if (b) b.setAttribute("aria-pressed", "false"); }
    Map3D.setLayer(id, state[id]); }, "data-id": id }, lab)));
}
function renderZoneDetail(){
  const T = L.terrain || { areas: [], lifts: [] };
  const z = (S.map.zones || []).find(x => x.name === selZone), a = (T.areas || []).find(x => x.name === selZone) || { trails: [], open: 0, total: 0 };
  const LT = liftsToday();
  const lifts = (T.lifts || []).filter(x => x.area === selZone).map(l => (l.s !== "Open" && LT.has(l.n)) ? Object.assign({}, l, { s: "Open", today: true }) : l);
  const trails = a.trails.slice().sort((p, q) => (q.o - p.o) || p.n.localeCompare(q.n));
  const order = ["Sun Down Bowl", "Sun Up Bowl", "Tea Cup Bowl", "China Bowl", "Siberia Bowl", "Mongolia Bowl", "Blue Sky Basin", "Mid-Vail", "Lionshead", "Vail Village", "Golden Peak", "Game Creek Bowl", "North East Bowl"];
  const allA = (T.areas || []).slice().sort((p, q) => (order.indexOf(p.name) + 99) % 99 - (order.indexOf(q.name) + 99) % 99);
  const ST = { Open: "Abierta", Closed: "Cerrada", Scheduled: "Programada" };
  $("#zone-detail").replaceChildren(
    el("div", { class: "chips areapick", role: "group", "aria-label": "Zona" }, ...allA.map(x => el("button", { type: "button", class: "chip", "aria-pressed": String(x.name === selZone), onclick: () => { selZone = x.name; renderZoneDetail(); const f = (((MAPST || {}).areas || {}).features || []).find(q => q.properties.name === x.name); if (mapReady && f) Map3D.flyToArea(f.center); } }, x.name.replace(" Bowl", "").replace("Blue Sky Basin", "Blue Sky") + " " + x.open + "/" + x.total))),
    el("div", { style: "display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-top:10px" }, el("h3", { style: "margin:0;font-family:var(--display);font-size:22px;letter-spacing:.03em;text-transform:uppercase" }, z ? z.label : selZone), el("span", { class: "small ink2" }, a.open + " de " + a.total + " pistas")),
    lifts.length ? el("ul", { class: "list", style: "margin-top:6px" }, ...lifts.map(l => el("li", null, el("div", { class: "l" }, l.n), el("span", { class: "st " + l.s }, l.s === "Open" ? "● " : "", l.today ? "Abrió hoy" : (ST[l.s] || l.s))))) : el("p", { class: "small muted" }, "Sin telesillas propias (se llega desde zonas vecinas)."),
    el("ul", { class: "list", style: "margin-top:8px" }, ...trails.map(t => el("li", null, el("div", { class: "l", style: "display:flex;gap:8px" }, el("span", { class: "diff " + t.d, title: t.d }), el("span", null, t.n)), el("span", { class: "st " + (t.o ? "Open" : "Closed") }, t.o ? "Abierta" : "Cerrada"))))
  );
  const Lk = S.links;
  $("#map-links").replaceChildren(
    el("a", { class: "btn", href: Lk.google_earth, target: "_blank", rel: "noopener" }, "Google Earth 3D"),
    el("a", { class: "btn", href: Lk.openskimap, target: "_blank", rel: "noopener" }, "OpenSkiMap"),
    el("a", { class: "btn", href: Lk.vail_trailmap, target: "_blank", rel: "noopener" }, "Mapa oficial"),
    el("a", { class: "btn", href: Lk.vail_terrain, target: "_blank", rel: "noopener" }, "Estado oficial"));
}
let selZone = "Sun Up Bowl", tilted = false;
const LABEL_AT = { "Lionshead": [118, 74], "Vail Village": [204, 70], "Golden Peak": [262, 84], "Mid-Vail": [208, 172], "North East Bowl": [298, 168], "Game Creek Bowl": [70, 182], "Sun Down Bowl": [38, 262], "Sun Up Bowl": [118, 262], "Blue Sky Basin": [236, 372] };
function zoneColor(z){
  const a = (L.terrain && L.terrain.areas || []).find(x => x.name === z.name);
  if (!a || !a.total) return { fill: css("--closed"), op: .35, a };
  const r = a.open / a.total;
  return r === 0 ? { fill: css("--closed"), op: .38, a } : { fill: css("--accent"), op: .35 + .55 * r, a };
}
function smooth(pts){
  const n = pts.length; let d = "";
  for (let i = 0; i < n; i++){
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    if (i === 0) d += "M" + p1[0] + "," + p1[1];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += "C" + c1.map(v => v.toFixed(1)).join(",") + " " + c2.map(v => v.toFixed(1)).join(",") + " " + p2.join(",");
  }
  return d + "Z";
}
function renderMapaSchematic(){
  const T = L.terrain || { areas: [], lifts: [] };
  const mp = S.map, box = $("#map3d");
  box.classList.add("mapbox"); $("#mapwrap").classList.add("schematic");
  const svg = sv("svg", { viewBox: "0 0 360 430", role: "img", "aria-label": "Mapa esquemático de Vail con zonas abiertas y cerradas" });
  svg.append(sv("line", { x1: 8, x2: 352, y1: 16, y2: 16, stroke: css("--axis"), "stroke-width": 3 }), sv("text", { x: 350, y: 12, "text-anchor": "end", style: "font:10px var(--body);fill:var(--muted)" }, "I-70"));
  svg.append(sv("text", { x: 346, y: 50, "text-anchor": "middle", style: "font:700 12px var(--body);fill:var(--ink-2)" }, "N"), sv("path", { d: "M346,54 l-5,12 h10z", fill: css("--ink-2") }));
  const labels = [];
  for (const z of mp.zones){
    const c = zoneColor(z);
    const cx = z.pts.reduce((s, p) => s + p[0], 0) / z.pts.length, cy = z.pts.reduce((s, p) => s + p[1], 0) / z.pts.length;
    const g = sv("g", { class: "zone" + (z.name === selZone ? " sel" : ""), tabindex: 0, role: "button", "aria-label": z.label + ": " + (c.a ? c.a.open + " de " + c.a.total + " pistas abiertas" : "sin datos") });
    g.append(sv("path", { d: smooth(z.pts), fill: c.fill, "fill-opacity": c.op }));
    const lp = LABEL_AT[z.name] || [cx, cy];
    labels.push(sv("text", { x: lp[0], y: lp[1] - 2, "text-anchor": "middle", class: "zl" }, z.label), sv("text", { x: lp[0], y: lp[1] + 10, "text-anchor": "middle", class: "zl c" }, c.a ? c.a.open + "/" + c.a.total : ""));
    const pick = () => { selZone = z.name; renderMapaSchematic(); renderZoneDetail(); };
    g.addEventListener("click", pick); g.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " "){ e.preventDefault(); pick(); } });
    svg.append(g);
  }
  svg.append(sv("path", { d: "M" + mp.ridge.map(p => p.join(",")).join("L"), fill: "none", stroke: css("--ink"), "stroke-width": 2.5, "stroke-linejoin": "round", opacity: .75 }));
  svg.append(sv("text", { x: 20, y: 236, style: "font:700 9px var(--body);fill:var(--ink-2);letter-spacing:.08em" }, "CRESTA"));
  svg.append(sv("text", { x: 180, y: 330, "text-anchor": "middle", style: "font:700 10px var(--body);fill:var(--ink-2);letter-spacing:.12em" }, "BACK BOWLS ↑ · BLUE SKY ↓"));
  const stCol = s => s === "Open" ? css("--good") : s === "Scheduled" ? css("--warn") : css("--closed");
  for (const l of mp.lifts){
    const info = (T.lifts || []).find(x => x.n === l.name);
    const c = stCol(info && info.s);
    svg.append(sv("line", { x1: l.a[0], y1: l.a[1], x2: l.b[0], y2: l.b[1], stroke: css("--card"), "stroke-width": 4.5, "stroke-linecap": "round" }));
    svg.append(sv("line", { x1: l.a[0], y1: l.a[1], x2: l.b[0], y2: l.b[1], stroke: c, "stroke-width": 2.2, "stroke-linecap": "round" }));
    svg.append(sv("circle", { cx: l.b[0], cy: l.b[1], r: 3.2, fill: c, stroke: css("--card"), "stroke-width": 1.5 }));
    const num = (l.name.match(/#(\d+)/) || [])[1] || (l.name.startsWith("Gondola One") ? "G1" : "");
    if (num) svg.append(sv("text", { x: l.b[0] + 5, y: l.b[1] - 3, class: "ln" }, num));
  }
  for (const p of mp.pois) svg.append(sv("circle", { cx: p.p[0], cy: p.p[1], r: 2, fill: css("--ink") }));
  svg.append(sv("g", { style: "pointer-events:none" }, labels));
  for (const b of mp.bases) svg.append(sv("text", { x: b.p[0], y: b.p[1], "text-anchor": "middle", style: "font:600 9px var(--body);fill:var(--ink-2)" }, b.n));
  box.replaceChildren(svg);
  box.classList.toggle("tilt", tilted);

  legend($("#lg-map"), [{ n: "Zona abierta (más intenso = más pistas)", c: css("--accent"), box: true }, { n: "Cerrada", c: css("--closed"), box: true }, { n: "Telesilla abierta", c: css("--good") }, { n: "Programada", c: css("--warn") }, { n: "Cerrada", c: css("--closed") }]);
  $("#map-sum").textContent = (T.trails_open ?? "–") + " de " + (T.trails_total ?? "–") + " pistas y " + (T.lifts_open ?? "–") + " de " + (T.lifts_total ?? "–") + " telesillas abiertas · Back Bowls " + (T.bb_trails_open ?? 0) + "/" + (T.bb_trails_total ?? "–") + " · reporte del " + (L.terrain_date ? fmtD(d2n(L.terrain_date)) : "–");
}

function renderCamaras(){
  const host = $("#cams");
  const cards = S.cams.map((c, i) => {
    const box = el("div", { class: "camframe" });
    const play = el("button", { type: "button", class: "camplay" }, el("span", { class: "tri", "aria-hidden": "true" }), el("span", null, "Ver en vivo"));
    play.onclick = () => {
      document.querySelectorAll(".camframe iframe").forEach(f => { const b = f.parentElement; f.remove(); b.classList.remove("live"); });
      box.classList.add("live");
      box.append(el("iframe", { src: c.url, title: "Cámara " + c.name, allow: "autoplay; fullscreen; picture-in-picture", allowfullscreen: "", loading: "lazy", referrerpolicy: "no-referrer-when-downgrade" }));
    };
    box.append(play);
    return el("div", { class: "card cam" + (c.bowls ? " bowls" : "") },
      el("div", { class: "camhead" }, el("div", null, el("div", { class: "nm" }, c.name), el("div", { class: "small ink2" }, c.note)), c.bowls ? el("span", { class: "tag" }, "Back Bowls") : null),
      box,
      el("div", { class: "tiny muted" }, el("a", { href: c.url, target: "_blank", rel: "noopener" }, "Abrir en otra pestaña")));
  });
  host.replaceChildren(el("div", { class: "camgrid" }, ...cards),
    el("p", { class: "small" }, el("a", { href: S.links.vail_cams, target: "_blank", rel: "noopener" }, "Todas las cámaras en vail.com")),
    el("p", { class: "tiny muted" }, "Transmisiones de Vail Resorts vía Brownrice. Si alguna no carga aquí, ábrela en otra pestaña."));
}
function renderSatelite(){
  const X = SAT || { passes: [] }, ov = X.overlay;
  const passes = (X.passes || []).slice().sort((a, b) => b.datetime.localeCompare(a.datetime));
  const cop = d => S.links.copernicus_tpl.replaceAll("{d}", d);
  const pc = v => v == null ? "–" : Math.round(v * 100) + "%";
  if (ov){
    $("#sat-intro").textContent = "Foto de Sentinel-2 del " + fmtDL(d2n(ov.date)) + " (la más reciente sin nubes). Norte arriba.";
    const img = el("img", { src: ov.true + "?v=" + ov.id, alt: "Imagen satelital de Vail del " + fmtD(d2n(ov.date)), loading: "lazy" });
    const snow = el("img", { src: ov.snow + "?v=" + ov.id, alt: "", class: "ovl", loading: "lazy" });
    const lab = (t, x, y) => el("span", { class: "satlab", style: "left:" + x + "%;top:" + y + "%" }, t);
    // label positions from lon/lat inside the image bounds
    const [[W, N], [E], , [, Sth]] = ov.coordinates;
    const at = (lon, lat) => [((lon - W) / (E - W) * 100).toFixed(1), ((N - lat) / (N - Sth) * 100).toFixed(1)];
    const labs = [["Vail Village", -106.374, 39.641], ["Lionshead", -106.392, 39.637], ["Back Bowls", -106.352, 39.598], ["Blue Sky Basin", -106.312, 39.578], ["I-70", -106.30, 39.651]].map(([t, lo, la]) => { const [x, y] = at(lo, la); return lab(t, x, y); });
    const box = $("#satbox");
    box.replaceChildren(img, snow, ...labs);
    box.classList.remove("snowon");
    const layers = [["true", "Color real", true], ["snow", "Nieve detectada", false]];
    $("#sat-layers").replaceChildren(...layers.map(([id, t, on]) => el("button", { type: "button", class: "chip", "aria-pressed": String(on), onclick: e => {
      const turnOn = id === "snow" ? !box.classList.contains("snowon") : box.classList.contains("snowon") ? false : true;
      box.classList.toggle("snowon", id === "snow" ? turnOn : false);
      document.querySelectorAll("#sat-layers .chip").forEach((b, i) => b.setAttribute("aria-pressed", String(i === 0 ? !box.classList.contains("snowon") : box.classList.contains("snowon"))));
    } }, t)));
    $("#sat-kv").replaceChildren(
      el("div", null, el("b", null, pc(ov.snow_bb)), el("span", null, "Nieve en Back Bowls")),
      el("div", null, el("b", null, pc(ov.snow_front)), el("span", null, "Nieve en el frente")),
      el("div", null, el("b", null, pc(ov.cloud)), el("span", null, "Nubes")));
  } else {
    $("#sat-intro").textContent = "Todavía no hay una pasada despejada procesada.";
    $("#satbox").replaceChildren(); $("#sat-layers").replaceChildren(); $("#sat-kv").replaceChildren();
  }
  // season chart
  const ok = passes.filter(p => p.snow_bb != null && (p.clear_bb == null || p.clear_bb >= 0.5)).slice().reverse();
  const okF = passes.filter(p => p.snow_front != null && (p.clear_front == null || p.clear_front >= 0.5)).slice().reverse();
  const sy = M.syear, s0 = d2n(sy + "-10-01");
  const cur = ok.filter(p => d2n(p.date) >= s0), curF = okF.filter(p => d2n(p.date) >= s0);
  const prev = ok.filter(p => d2n(p.date) < s0 && d2n(p.date) >= d2n((sy - 1) + "-10-01"));
  const shift = s0 - d2n((sy - 1) + "-10-01");
  $("#sat-chart-intro").textContent = "Porcentaje de cada zona cubierto de nieve en cada pasada despejada (se descartan las que tienen más de la mitad de la zona bajo nubes)." + (prev.length ? " La línea naranja es la temporada pasada." : "");
  const A = css("--accent"), O = css("--accent-2"), G = css("--muted");
  legend($("#lg-sat"), [{ n: "Back Bowls", c: A }, { n: "Frente", c: G }, ...(prev.length ? [{ n: "Back Bowls " + (sy - 1) + "-" + String(sy).slice(2), c: O }] : [])]);
  const x0 = d2n(sy + "-10-01"), x1 = Math.max(d2n(sy + "-12-31"), ...cur.map(p => d2n(p.date) + 7));
  if (cur.length || prev.length){
    lineChart($("#ch-sat"), { x: [x0, x1], y: [0, 100], yTicks: [0, 25, 50, 75, 100], yFmt: v => v + "%", height: 200, aria: "Nieve en los Back Bowls y el frente por pasada",
      series: [...(prev.length ? [{ pts: prev.map(p => [d2n(p.date) + shift, p.snow_bb * 100]).filter(p => p[0] <= x1), c: O, w: 1.5 }] : []), { pts: curF.map(p => [d2n(p.date), p.snow_front * 100]), c: G, w: 1.5, dots: true }, { pts: cur.map(p => [d2n(p.date), p.snow_bb * 100]), c: A, end: true, dots: true }],
      tip: { xs: cur.map(p => d2n(p.date)), rows: (x, Y) => { const p = cur.find(q => d2n(q.date) === x), f = curF.find(q => d2n(q.date) === x); return { title: fmtD(x), rows: [p ? { n: "Back Bowls", v: pc(p.snow_bb), c: A, py: Y(p.snow_bb * 100) } : null, f ? { n: "Frente", v: pc(f.snow_front), c: G, py: Y(f.snow_front * 100) } : null].filter(Boolean) }; } } });
  } else $("#ch-sat").replaceChildren(el("p", { class: "small muted" }, "Sin pasadas despejadas todavía."));
  // pass list
  $("#sat-list").replaceChildren(...passes.slice(0, 14).map(p => el("li", null,
    el("div", { class: "l" }, el("a", { href: cop(p.date), target: "_blank", rel: "noopener" }, fmtDL(d2n(p.date))), el("div", { class: "tiny muted" }, p.cloud >= 0.5 ? "Mayormente nublado" : p.cloud >= 0.15 ? "Algunas nubes" : "Despejado")),
    el("div", { class: "r small" }, el("div", null, "Bowls " + (p.snow_bb != null && (p.clear_bb == null || p.clear_bb >= 0.5) ? pc(p.snow_bb) : "–") + " · Frente " + (p.snow_front != null && (p.clear_front == null || p.clear_front >= 0.5) ? pc(p.snow_front) : "–")), el("div", { class: "tiny muted" }, pc(p.cloud) + " nubes")))));
  $("#sat-note").textContent = "Sentinel-2 (ESA Copernicus) vía Element 84 Earth Search. Se revisa cada 3 horas" + (X.updated ? "; última revisión: " + new Date(X.updated).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");
  const wv = d => S.links.worldview_tpl.replaceAll("{d}", d);
  $("#sat-links").replaceChildren(
    el("a", { class: "btn", href: cop(ov ? ov.date : n2d(M.t0 - 1)), target: "_blank", rel: "noopener" }, "Copernicus Browser"),
    el("a", { class: "btn", href: wv(n2d(M.t0 - 1)), target: "_blank", rel: "noopener" }, "NASA Worldview · ayer"),
    el("a", { class: "btn", href: S.links.google_earth, target: "_blank", rel: "noopener" }, "Google Earth 3D"));
}
// ---------- Agua en la nieve: esta temporada contra los últimos inviernos (SNOTEL #842) ----------
const SP_CAT = [["Entre los inviernos con menos nieve", "Muy bajo"], ["Debajo de lo normal", "Bajo"], ["Normal para la fecha", "Normal"], ["Arriba de lo normal", "Alto"], ["Entre los inviernos más nevados", "Muy alto"]];
const SP_KEYS = ["min", "p10", "p30", "p70", "p90", "max"];
const sLab = y => y + "-" + String(+y + 1).slice(2);
const swe1 = x => (UNITS === "metric" ? x * 2.54 : x).toLocaleString("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const sweFmt = x => x == null ? "–" : swe1(x) + (UNITS === "metric" ? " cm" : " in");
let spWin = null;
function spSeries(){
  const days = SP.days, N = days.length, sy = M.syear, base = SP.seasons[String(sy)] || [];
  const idx = {}; days.forEach((k, i) => { idx[k] = i; });
  const cur = Array.from({ length: N }, (_, i) => base[i] != null ? base[i] : null);
  for (const r of (L.snotel || [])){
    if (r.swe == null) continue;
    const y = +r.date.slice(0, 4), m = +r.date.slice(5, 7);
    if ((m >= 8 ? y : y - 1) !== sy) continue;
    const i = idx[r.date.slice(5)];
    if (i != null) cur[i] = r.swe;
  }
  let ti = -1; cur.forEach((v, i) => { if (v != null) ti = i; });
  const dateN = i => d2n((days[i] >= "08" ? sy : sy + 1) + "-" + days[i]);
  return { days, N, sy, cur, ti, dateN, idx };
}
function renderSnowpack(){
  const card = $("#sp-card");
  if (!SP || !SP.days || !SP.bands || !SP.seasons){ card.hidden = true; return; }
  const { days, N, sy, cur, ti, dateN, idx } = spSeries();
  if (ti < 0){ card.hidden = true; return; }
  card.hidden = false;
  const B = SP.bands, ref = SP.ref;
  if (!SP.seasons[cmpSeason] || +cmpSeason >= sy) cmpSeason = SP.seasons[String(sy - 1)] ? String(sy - 1) : Object.keys(SP.seasons).filter(y => +y < sy).sort().pop();
  const cmp = SP.seasons[cmpSeason] || [];
  const v = cur[ti], med = B.p50[ti], vc = cmp[ti];
  const cat = v < B.p10[ti] ? 0 : v < B.p30[ti] ? 1 : v <= B.p70[ti] ? 2 : v <= B.p90[ti] ? 3 : 4;
  const vals = [];
  for (let y = ref.first; y <= ref.last; y++){ const a = SP.seasons[y]; if (a && a[ti] != null) vals.push(a[ti]); }
  const n = vals.length, below = vals.filter(x => x < v - 1e-9).length;
  const rank = B.max[ti] - B.min[ti] < 0.05 ? "A esta fecha casi ningún invierno tiene nieve todavía."
    : below === 0 ? `La más baja de los últimos ${n} inviernos a esta fecha.`
    : below === n ? `La más alta de los últimos ${n} inviernos a esta fecha.`
    : `Más agua que en ${below} de los últimos ${n} inviernos a esta fecha.`;
  $("#sp-date").textContent = fmtD(dateN(ti));
  $("#sp-status").replaceChildren(el("i", { style: `background:var(--sp${cat + 1})` }), el("b", null, SP_CAT[cat][0]), el("span", null, rank));
  $("#sp-kv").replaceChildren(
    el("div", null, el("b", null, sweFmt(v)), el("span", null, "Esta temporada")),
    el("div", { class: "hl" }, el("b", null, med > 0.05 ? Math.round(v / med * 100) + "%" : "–"), el("span", null, "de la mediana")),
    el("div", null, el("b", null, sweFmt(vc)), el("span", null, sLab(cmpSeason))),
    el("div", null, el("b", null, sweFmt(med)), el("span", null, "Mediana")));
  // period: start of season (Oct to Jan, or 5 weeks past today) or the whole season
  const early1 = Math.min(N - 1, Math.max(days.indexOf("01-01"), ti + 35));
  if (spWin == null) spWin = early1 < days.indexOf("03-01") ? "early" : "full";
  $("#sp-win").replaceChildren(...[["early", "Oct–" + MES[+days[early1].slice(0, 2) - 1]], ["full", "Oct–jul"]].map(([k, t]) =>
    el("button", { type: "button", class: "chip", "aria-pressed": String(spWin === k), onclick: () => { spWin = k; renderSnowpack(); } }, t)));
  const sel = $("#sp-cmp");
  sel.replaceChildren(...Object.keys(SP.seasons).filter(y => +y < sy).sort((a, b) => b - a).map(y => el("option", { value: y }, sLab(y))));
  sel.value = cmpSeason;
  sel.onchange = () => { cmpSeason = sel.value; renderSnowpack(); };
  const op = S.openings.find(o => String(o.season) === cmpSeason);
  spChart($("#ch-sp"), { days, B, cur, cmp, ti, dateN, x0: 0, x1: spWin === "early" ? early1 : N - 1, cmpLabel: sLab(cmpSeason),
    openIdx: op ? idx[op.date.slice(5)] : null });
  $("#lg-sp").replaceChildren(
    el("span", { style: "--c:" + css("--ink") }, el("i", { class: "thick" }), "Esta temporada"),
    el("span", { style: "--c:" + css("--accent-2") }, el("i"), sLab(cmpSeason)),
    el("span", { style: "--c:" + css("--ink-2") }, el("i", { class: "dash" }), "Mediana"));
  $("#sp-scale").replaceChildren(...SP_CAT.map((c, k) => el("div", null, el("i", { style: `background:var(--sp${k + 1})` }), el("span", null, c[1]))));
  $("#sp-note").textContent = `Cada fecha se compara con el mismo día de los últimos ${ref.n} inviernos (${sLab(ref.first)} a ${sLab(ref.last)}). Normal es el 40% de en medio; muy bajo y muy alto, el 10% de cada extremo.`;
}
function spChart(host, o){
  host.replaceChildren();
  const { days, B, cur, cmp, ti, dateN, x0, x1 } = o;
  const W = Math.max(280, host.clientWidth || 340), H = 250, pad = { l: 34, r: 12, t: 26, b: 24 };
  const toU = x => UNITS === "metric" ? x * 2.54 : x;
  let top = 0;
  for (let i = x0; i <= x1; i++) top = Math.max(top, B.max[i] || 0, cur[i] || 0, cmp[i] || 0);
  const yT = niceTicks(Math.max(toU(top) * 1.03, UNITS === "metric" ? 5 : 2), 4), ymax = yT[yT.length - 1];
  const X = i => pad.l + (i - x0) / (x1 - x0) * (W - pad.l - pad.r);
  const Y = v => H - pad.b - v / ymax * (H - pad.t - pad.b);
  const path = (arr, upto) => {
    let d = "", pen = false;
    for (let i = x0; i <= Math.min(x1, upto == null ? x1 : upto); i++){
      if (arr[i] == null){ pen = false; continue; }
      d += (pen ? "L" : "M") + X(i).toFixed(1) + "," + Y(toU(arr[i])).toFixed(1); pen = true;
    }
    return d;
  };
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Agua en la nieve: esta temporada comparada con los últimos inviernos" });
  for (let k = 0; k < 5; k++){                       // percentile bands
    const lo = B[SP_KEYS[k]], hi = B[SP_KEYS[k + 1]], up = [], dn = [];
    for (let i = x0; i <= x1; i++) if (lo[i] != null && hi[i] != null){
      up.push(X(i).toFixed(1) + "," + Y(toU(hi[i])).toFixed(1)); dn.push(X(i).toFixed(1) + "," + Y(toU(lo[i])).toFixed(1));
    }
    if (up.length > 1) svg.append(sv("path", { d: "M" + up.join("L") + "L" + dn.reverse().join("L") + "Z", fill: css("--sp" + (k + 1)) }));
  }
  for (const t of yT){
    svg.append(sv("line", { x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t), stroke: t === 0 ? css("--axis") : css("--grid-on") }));
    svg.append(sv("text", { x: pad.l - 6, y: Y(t) + 4, "text-anchor": "end" }, String(t)));
  }
  svg.append(sv("text", { x: pad.l - 6, y: pad.t - 12, "text-anchor": "end" }, UNITS === "metric" ? "cm" : "in"));
  for (let i = x0; i <= x1; i++) if (days[i].endsWith("-01")){
    svg.append(sv("line", { x1: X(i), x2: X(i), y1: H - pad.b, y2: H - pad.b + 4, stroke: css("--axis") }));
    svg.append(sv("text", { x: X(i), y: H - 6, "text-anchor": i === x0 ? "start" : "middle" }, MES[+days[i].slice(0, 2) - 1]));
  }
  const stroke = (d, c, w, extra) => {
    if (!d) return;
    if (!(extra && extra["stroke-dasharray"])) svg.append(sv("path", { d, fill: "none", stroke: css("--card"), "stroke-width": w + 3, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: .85 }));
    svg.append(sv("path", { d, fill: "none", stroke: c, "stroke-width": w, "stroke-linejoin": "round", "stroke-linecap": "round", ...(extra || {}) }));
  };
  stroke(path(B.p50), css("--ink-2"), 1.4, { "stroke-dasharray": "4 3" });
  stroke(path(cmp), css("--accent-2"), 2);
  if (o.openIdx != null && o.openIdx >= x0 && o.openIdx <= x1 && cmp[o.openIdx] != null){
    const cx = X(o.openIdx), cy = Y(toU(cmp[o.openIdx]));
    svg.append(sv("circle", { cx, cy, r: 4, fill: css("--card"), stroke: css("--accent-2"), "stroke-width": 2 }));
    svg.append(sv("text", { x: clamp(cx, pad.l + 4, W - pad.r - 4), y: cy + 16, "text-anchor": cx > W - 60 ? "end" : cx < pad.l + 40 ? "start" : "middle", class: "lbl" }, "Bowls " + fmtD(dateN(o.openIdx))));
  }
  if (ti >= x0 && ti <= x1){
    svg.append(sv("line", { x1: X(ti), x2: X(ti), y1: pad.t - 4, y2: H - pad.b, stroke: css("--ink-2"), "stroke-width": 1, "stroke-dasharray": "2 3" }));
    svg.append(sv("text", { x: clamp(X(ti), pad.l + 16, W - pad.r - 16), y: pad.t - 8, "text-anchor": "middle", class: "lbl" }, "hoy"));
  }
  stroke(path(cur, ti), css("--ink"), 2.6);
  if (ti >= x0 && ti <= x1) svg.append(sv("circle", { cx: X(ti), cy: Y(toU(cur[ti])), r: 4.5, fill: css("--ink"), stroke: css("--card"), "stroke-width": 2 }));
  host.append(svg);
  const xs = []; for (let i = x0; i <= x1; i++) xs.push(i);
  attachTip(host, svg, W, H, pad, xs, X, i => ({
    title: fmtD(dateN(i)),
    rows: [cur[i] != null && i <= ti ? { n: "Esta temporada", v: sweFmt(cur[i]), c: css("--ink"), py: Y(toU(cur[i])) } : null,
      cmp[i] != null ? { n: o.cmpLabel, v: sweFmt(cmp[i]), c: css("--accent-2"), py: Y(toU(cmp[i])) } : null,
      B.p50[i] != null ? { n: "Mediana", v: sweFmt(B.p50[i]), c: css("--ink-2") } : null,
      B.p30[i] != null ? { n: "Normal", v: swe1(B.p30[i]) + "–" + sweFmt(B.p70[i]), c: css("--muted") } : null].filter(Boolean) }));
}
function renderHistorial(){
  const A = css("--ink"), O = css("--accent-2"), G = css("--muted");
  const sy = M.syear;
  const toU = v => UNITS === "metric" ? v * 2.54 : v;
  renderSnowpack();
  renderOpenPlot();
  // Vail reported totals
  const hist = L.history_vail || [], last = S.last_season || [];
  const shift = d2n(sy + "-10-01") - d2n((sy - 1) + "-10-01");
  const tx0 = d2n(sy + "-11-01"), tx1 = d2n((sy + 1) + "-04-30");
  const curT = hist.filter(h => h.season_total != null).map(h => [d2n(h.date), toU(h.season_total)]);
  const lastT = last.filter(h => h.season_total != null).map(h => [d2n(h.date) + shift, toU(h.season_total)]);
  legend($("#lg-tot"), [{ n: "Esta temporada", c: A }, { n: "2025-26", c: O }]);
  const tmax = Math.max(10, ...curT.map(p => p[1]), ...lastT.map(p => p[1]));
  const tt = niceTicks(tmax, 4);
  lineChart($("#ch-tot"), { x: [tx0, tx1], y: [0, tt[tt.length - 1]], yTicks: tt, yFmt: v => String(Math.round(v)), yUnit: UNITS === "metric" ? "cm" : "in", height: 190, aria: "Nevada acumulada",
    series: [{ pts: lastT, c: O }, { pts: curT, c: A, end: true }],
    tip: { xs: lastT.map(p => p[0]), rows: (x, Y) => { const a = curT.find(p => p[0] === x), b = lastT.find(p => p[0] === x); return { title: fmtD(x), rows: [a ? { n: "Esta temporada", v: len(UNITS === "metric" ? a[1] / 2.54 : a[1]), c: A, py: Y(a[1]) } : null, b ? { n: "2025-26", v: len(UNITS === "metric" ? b[1] / 2.54 : b[1]), c: O, py: Y(b[1]) } : null].filter(Boolean) }; } } });
  const curP = hist.filter(h => h.trails_open != null).map(h => [d2n(h.date), h.trails_open]);
  const lastP = last.map(h => [d2n(h.date) + shift, h.trails_open]);
  const curB = hist.filter(h => h.bb_trails_open != null).map(h => [d2n(h.date), h.bb_trails_open]);
  const lastB = last.map(h => [d2n(h.date) + shift, h.bb_trails_open]);
  legend($("#lg-trails"), [{ n: "Esta temporada", c: A }, { n: "2025-26", c: O }, { n: "Back Bowls 2025-26", c: G }]);
  lineChart($("#ch-trails"), { x: [tx0, tx1], y: [0, 280], yTicks: [0, 70, 140, 210, 280], yFmt: v => String(v), height: 190, aria: "Pistas abiertas por día",
    series: [{ pts: lastB, c: G, w: 1.5 }, { pts: lastP, c: O }, { pts: curB, c: G, w: 1.5 }, { pts: curP, c: A, end: true }],
    tip: { xs: lastP.map(p => p[0]), rows: (x, Y) => { const a = curP.find(p => p[0] === x), b = lastP.find(p => p[0] === x), c = lastB.find(p => p[0] === x); return { title: fmtD(x), rows: [a ? { n: "Esta temporada", v: String(a[1]), c: A, py: Y(a[1]) } : null, b ? { n: "2025-26", v: String(b[1]), c: O, py: Y(b[1]) } : null, c ? { n: "Back Bowls 25-26", v: String(c[1]), c: G, py: Y(c[1]) } : null].filter(Boolean) }; } } });
  // table
  const t = $("#t-open");
  t.replaceChildren(el("tr", null, el("th", null, "Temporada"), el("th", null, "Abrieron"), el("th", { class: "n" }, "Agua"), el("th", null, "Qué abrió · fuente")));
  S.openings.slice().sort((a, b) => b.season - a.season).forEach(o => t.append(el("tr", null, el("td", { style: "white-space:nowrap" }, o.season + "-" + String(o.season + 1).slice(2)), el("td", { style: "white-space:nowrap" }, fmtD(d2n(o.date)) + " " + o.date.slice(2, 4)), el("td", { class: "n", style: "white-space:nowrap" }, len(o.swe, true)), el("td", { class: "small" }, o.what, el("div", { class: "tiny muted" }, o.source)))));
}
function renderOpenPlot(){
  const host = $("#ch-open"); host.replaceChildren();
  const rows = S.openings.slice().sort((a, b) => b.season - a.season);
  const W = Math.max(280, host.clientWidth || 340), rh = 18, pad = { l: 58, r: 16, t: 34, b: 24 };
  const H = pad.t + rh * rows.length + pad.b;
  const off = o => d2n(o.date) - d2n(o.season + "-10-01");
  const x0 = 40, x1 = 135;   // days after Oct 1 (Nov 10 .. Feb 13)
  const X = v => pad.l + (clamp(v, x0, x1) - x0) / (x1 - x0) * (W - pad.l - pad.r);
  const svg = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Fecha de apertura por temporada" });
  const ticks = [[61, "1 dic"], [92, "1 ene"], [123, "1 feb"], [45, "15 nov"], [76, "16 dic"], [107, "16 ene"]];
  for (const [v, lab] of ticks){ svg.append(sv("line", { x1: X(v), x2: X(v), y1: pad.t - 6, y2: H - pad.b, stroke: css("--line") })); svg.append(sv("text", { x: X(v), y: H - 6, "text-anchor": "middle" }, lab)); }
  const s0 = d2n(M.syear + "-10-01");
  if (!M.open && M.p10 && M.p90){
    svg.append(sv("rect", { x: X(M.p10 - s0), y: 8, width: Math.max(2, X(M.p90 - s0) - X(M.p10 - s0)), height: 14, rx: 7, fill: css("--accent"), opacity: .18 }));
    if (M.med) svg.append(sv("circle", { cx: X(M.med - s0), cy: 15, r: 5, fill: css("--card"), stroke: css("--accent"), "stroke-width": 2 }));
    svg.append(sv("text", { x: 4, y: 19, class: "lbl" }, M.syear + "-" + String(M.syear + 1).slice(2)));
  }
  const tip = el("div", { class: "tip" }); host.append(tip);
  rows.forEach((o, i) => {
    const y = pad.t + rh * i + rh / 2, v = off(o);
    svg.append(sv("text", { x: 4, y: y + 4 }, o.season + "-" + String(o.season + 1).slice(2)));
    svg.append(sv("line", { x1: pad.l, x2: W - pad.r, y1: y, y2: y, stroke: css("--line") }));
    const g = sv("g", { tabindex: 0, "aria-label": o.season + ": " + o.date });
    g.append(sv("circle", { cx: X(v), cy: y, r: 4.5, fill: v > x1 ? css("--accent-2") : css("--ink-2"), stroke: css("--card"), "stroke-width": 2 }));
    if (v > x1) svg.append(sv("text", { x: X(x1) - 8, y: y + 4, "text-anchor": "end", class: "lbl" }, fmtD(d2n(o.date)) + " →"));
    g.append(sv("rect", { x: X(v) - 12, y: y - 9, width: 24, height: 18, fill: "transparent" }));
    const show = () => { tip.replaceChildren(el("div", { class: "d" }, o.season + "-" + String(o.season + 1).slice(2)), el("div", { class: "row" }, el("span", { style: "color:var(--ink-2)" }, "Abrieron"), el("b", null, fmtD(d2n(o.date)))), el("div", { class: "row" }, el("span", { style: "color:var(--ink-2)" }, "Agua en la nieve"), el("b", null, len(o.swe, true)))); tip.style.display = "block"; tip.style.left = clamp(X(v) - tip.offsetWidth / 2, 0, W - tip.offsetWidth) + "px"; tip.style.top = Math.max(0, y - 64) + "px"; };
    g.addEventListener("pointerenter", show); g.addEventListener("pointerdown", show); g.addEventListener("focus", show);
    g.addEventListener("pointerleave", () => tip.style.display = "none"); g.addEventListener("blur", () => tip.style.display = "none");
    svg.append(g);
  });
  host.append(svg);
}
function renderFooter(){
  const st = (STATUS && STATUS.steps) || {};
  const bad = Object.entries(st).filter(([k, v]) => !v.ok && !v.skipped).map(([k]) => k);
  $("#foot").replaceChildren(
    el("p", null, "Uso personal. Se actualiza sola en ", el("a", { href: "https://github.com/acarcurs/nieve-vail", target: "_blank", rel: "noopener" }, "GitHub"), ". Vail decide la apertura según patrulla y avalanchas."),
    el("p", null, "Datos: Vail Resorts, NRCS SNOTEL, NWS, Open-Meteo (CC BY 4.0), © OpenStreetMap, Copernicus Sentinel-2."),
    ...(bad.length ? [el("p", null, "Sin actualizar ahora: " + bad.join(", ") + ".")] : []));
}
/* ---------- router & boot ---------- */
const VIEWS = ["hoy", "pronostico", "mapa", "camaras", "satelite", "historial"];
const rendered = {};
const RENDER = { hoy: renderHoy, pronostico: renderPronostico, mapa: renderMapa, camaras: renderCamaras, satelite: renderSatelite, historial: renderHistorial };
function route(){
  const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "hoy";
  for (const k of VIEWS){ $("#v-" + k).classList.toggle("on", k === v); }
  document.querySelectorAll("nav.tabbar a").forEach(a => { if (a.dataset.v === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  if (route.last && route.last !== v) window.scrollTo(0, 0);
  route.last = v;
  if (S && L && !rendered[v]){ RENDER[v](); rendered[v] = true; }
}
function rerenderAll(){ for (const k of Object.keys(rendered)) delete rendered[k]; route(); }
function setUnits(u){
  UNITS = u; try { localStorage.setItem("units", u); } catch (e) {}
  $("#u-metric").setAttribute("aria-pressed", String(u === "metric")); $("#u-imp").setAttribute("aria-pressed", String(u !== "metric"));
  if (S && L) rerenderAll();
}
$("#u-metric").onclick = () => setUnits("metric");
$("#u-imp").onclick = () => setUnits("imperial");
window.addEventListener("hashchange", route);
let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (S && L) rerenderAll(); }, 200); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (S && L) rerenderAll(); });
new MutationObserver(() => { if (S && L) rerenderAll(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
setUnits(UNITS);
/* Vail's snow report and lift/trail status change in the morning; GitHub's scheduler can lag, so the page
   also reads them directly from the public ski-run-scraper archive when it opens. */
const SCRAPER = "https://raw.githubusercontent.com/jacobschulman/ski-run-scraper/main/data/vail/";
const BB_AREAS = ["Sun Down Bowl", "Sun Up Bowl", "Tea Cup Bowl", "China Bowl", "Siberia Bowl", "Mongolia Bowl"];
function denverDate(){ try { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); } catch (e) { return n2d(d2n(new Date().toISOString().slice(0, 10))); } }
function summarizeTerrain(t){
  const areas = [];
  for (const a of t.GroomingAreas || []){
    if (!(a.Trails || []).length && !(a.Lifts || []).length) continue;
    const trails = (a.Trails || []).map(x => ({ n: x.Name, d: x.Difficulty, o: !!x.IsOpen, g: !!x.IsGroomed }));
    areas.push({ name: a.Name, trails, open: trails.filter(x => x.o).length, total: trails.length });
  }
  const lifts = (t.Lifts || []).map(l => ({ n: l.Name, s: l.Status, area: l.Mountain, type: l.Type, open_time: l.OpenTime, close_time: l.CloseTime }));
  const bb = areas.filter(a => BB_AREAS.includes(a.name));
  return { areas, lifts, trails_open: areas.reduce((x, a) => x + a.open, 0), trails_total: areas.reduce((x, a) => x + a.total, 0),
    lifts_open: lifts.filter(l => (l.s || "").toLowerCase() === "open").length, lifts_total: lifts.length,
    bb_trails_open: bb.reduce((x, a) => x + a.open, 0), bb_trails_total: bb.reduce((x, a) => x + a.total, 0),
    bb_open_list: bb.flatMap(a => a.trails.filter(x => x.o).map(x => a.name + ": " + x.n)), source_updated: t.sourceLastUpdated || t.Date };
}
function summarizeSnow(s){
  const sf = s.snowfall || {}, names = ["Vail base", "Vail cima", "Lionshead base", "Lionshead cima"];
  const fc = ((s.forecast || {}).locations || []).map((loc, i) => ({ name: names[i] || "Ubicación " + (i + 1),
    days: (loc.forecast_days || []).map(d => ({ date: (d.date || "").slice(0, 10), hi: d.high_f, lo: d.low_f, desc: d.description, snow_day: d.snowfall_day_inches, snow_night: d.snowfall_night_inches })) }));
  return { updated_text: s.lastUpdated, conditions: s.conditions, overnight: sf.overnight_inches, h24: sf["24hour_inches"], h48: sf["48hour_inches"], d7: sf["7day_inches"],
    season_total: sf.season_total_inches, base: (s.baseDepth || {}).inches, forecast: fc };
}
async function liveVail(){
  const day = denverDate();
  const get = u => fetch(u, { cache: "no-cache" }).then(r => r.ok ? r.json() : null).catch(() => null);
  const [sn, te] = await Promise.all([get(SCRAPER + "snow/" + day + ".json"), get(SCRAPER + "terrain/" + day + ".json")]);
  let changed = false;
  const stamp = x => { const m = /([A-Z][a-z]+ \d{1,2}, \d{4}) at (\d{1,2}):(\d{2}) ([AP]M)/.exec(x || ""); if (!m) return 0; const h = (+m[2] % 12) + (m[4] === "PM" ? 12 : 0); return Date.parse(m[1] + " " + h + ":" + m[3]) || 0; };
  if (sn && sn.lastUpdated && stamp(sn.lastUpdated) > stamp((L.report || {}).updated_text)){
    L.report = summarizeSnow(sn); changed = true;
    const hv = L.history_vail || (L.history_vail = []);
    let row = hv.find(h => h.date === day); if (!row){ row = { date: day }; hv.push(row); }
    Object.assign(row, { base: L.report.base, season_total: L.report.season_total, h24: L.report.h24 });
  }
  if (te && (te.GroomingAreas || []).length){
    const T = summarizeTerrain(te);
    if (L.terrain_date !== day || JSON.stringify(T.areas) !== JSON.stringify((L.terrain || {}).areas) || T.lifts_open > 0){
      L.terrain = T; L.terrain_date = day; changed = true;
      const lt = L.lifts_today && L.lifts_today.date === day ? L.lifts_today : (L.lifts_today = { date: day, names: [] });
      for (const l of T.lifts) if ((l.s || "").toLowerCase() === "open" && !lt.names.includes(l.n)) lt.names.push(l.n);
      const hv = L.history_vail || (L.history_vail = []);
      let row = hv.find(h => h.date === day); if (!row){ row = { date: day }; hv.push(row); }
      Object.assign(row, { trails_open: T.trails_open, lifts_open: T.lifts_open, bb_trails_open: T.bb_trails_open });
    }
  }
  if (changed) L.live_vail = new Date().toISOString();
  return changed;
}
/* map status follows the live terrain too (names were matched to OpenStreetMap by the pipeline) */
function liveMapStatus(){
  if (!MAPST) return MAPST;
  const T = L.terrain || {}, tr = {};
  for (const a of T.areas || []) for (const t of a.trails) tr[t.n] = t.o ? 1 : 0;
  const names = Object.keys(tr), LT = liftsToday(), ls = {};
  for (const l of T.lifts || []) ls[l.n] = LT.has(l.n) ? "open" : (l.s || "").toLowerCase();
  const P = {}, Lf = {};
  for (const [id, v] of Object.entries(MAPST.pistes || {})){
    let o = tr[v[1]];
    if (o == null){ const segs = names.filter(n => n.startsWith(v[1] + " - ")); if (segs.length) o = segs.some(n => tr[n]) ? 1 : 0; }
    P[id] = [o == null ? v[0] : o, v[1], v[2], v[3]];
  }
  for (const [id, v] of Object.entries(MAPST.lifts || {})) Lf[id] = [ls[v[1]] != null ? ls[v[1]] : v[0], v[1], v[2]];
  const feats = ((MAPST.areas || {}).features || []).map(f => { const a = (T.areas || []).find(x => x.name === f.properties.name);
    return a ? Object.assign({}, f, { properties: Object.assign({}, f.properties, { open: a.open, total: a.total }) }) : f; });
  return Object.assign({}, MAPST, { pistes: P, lifts: Lf, areas: { type: "FeatureCollection", features: feats } });
}
/* "Actualizar" button: reload every data file (skipping caches), Vail's live report, then redraw */
let refreshing = false, lastRefresh = Date.now();
// si se publicó una versión nueva de la página, recargarla (una vez por versión)
const APP_V = ((document.querySelector('script[src*="assets/app.js"]') || {}).src || "").split("v=")[1] || "dev";
async function newVersion(){
  if (APP_V === "dev") return null;
  try {
    const h = await fetch("index.html?t=" + Date.now(), { cache: "no-store" }).then(r => r.text());
    const m = h.match(/assets\/app\.js\?v=([\w-]+)/);
    if (!m || m[1] === APP_V) return null;
    let tried = null; try { tried = sessionStorage.getItem("reloadFor"); sessionStorage.setItem("reloadFor", m[1]); } catch (e) {}
    return tried === m[1] ? null : m[1];
  } catch (e) { return null; }
}
async function refreshAll(){
  if (refreshing || !S) return;
  refreshing = true;
  const btn = $("#refresh"), lab = $("#refresh-label"), msg = $("#refresh-msg");
  btn.disabled = true; btn.classList.remove("ok", "err"); btn.classList.add("busy"); lab.textContent = "Actualizando…";
  if (await newVersion()){ lab.textContent = "Versión nueva…"; location.reload(); return; }
  const prev = [L && L.generated_at, L && (L.report || {}).updated_text, SAT && SAT.overlay && SAT.overlay.id, INS && INS.updated].join("|");
  const t = "t=" + Date.now();
  const getN = (u, must) => fetch(u + "?" + t, { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }).catch(e => { if (must) throw e; return null; });
  let text, cls;
  try {
    const [l, ins, sat, cm, ms, st, sp] = await Promise.all([getN("data/live.json", true), getN("data/insights.json"), getN("data/sat/index.json"), getN("data/cumbre_model.json"), getN("data/map/status.json"), getN("data/status.json"), getN("data/snowpack.json")]);
    L = l; INS = ins || INS; SAT = sat || SAT; CM = cm || CM; MAPST = ms || MAPST; STATUS = st || STATUS; SP = sp || SP;
    mergeInsights();
    await liveVail();
    M = runModel(); renderHeader(); renderFooter(); rerenderAll();
    const now = [L.generated_at, (L.report || {}).updated_text, SAT && SAT.overlay && SAT.overlay.id, INS && INS.updated].join("|");
    text = now !== prev ? "Datos nuevos" : "Al día"; cls = "ok";
    msg.textContent = (now !== prev ? "Llegaron datos nuevos. " : "Ya tenías lo más reciente. ") + $("#updated").textContent;
  } catch (e) {
    text = "Sin conexión"; cls = "err"; msg.textContent = "No pude actualizar: revisa tu conexión.";
  }
  lastRefresh = Date.now();
  btn.classList.remove("busy"); btn.classList.add(cls); lab.textContent = text; btn.disabled = false;
  setTimeout(() => { btn.classList.remove("ok", "err"); lab.textContent = "Actualizar"; }, 2600);
  refreshing = false;
}
document.addEventListener("click", e => { if (e.target.closest && e.target.closest("#refresh")) refreshAll(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && S && Date.now() - lastRefresh > 10 * 60 * 1000) refreshAll(); });
const bust = "t=" + Math.floor(Date.now() / 60000);
const getJ = (u, must) => fetch(u + "?" + bust).then(r => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }).catch(e => { if (must) throw e; return null; });
Promise.all([getJ("data/static.json", true), getJ("data/live.json", true), getJ("data/insights.json"), getJ("data/sat/index.json"), getJ("data/cumbre_model.json"), getJ("data/map/status.json"), getJ("data/status.json"), getJ("data/snowpack.json")])
  .then(([s, l, ins, sat, cm, ms, st, sp]) => { S = s; L = l; INS = ins; SAT = sat; CM = cm; MAPST = ms; STATUS = st; SP = sp; mergeInsights(); M = runModel(); renderHeader(); renderFooter(); route(); liveVail().then(ch => { if (ch){ M = runModel(); renderHeader(); rerenderAll(); } }); })
  .catch(err => { $("#fatal").replaceChildren(el("div", { class: "err" }, "No pude cargar los datos (" + err.message + "). Vuelve a abrir la página en un momento.")); route(); });

setInterval(() => { if (L) renderHeader(); }, 60000);

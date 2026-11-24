"use strict";
/* ---------- utilities ---------- */
const $ = (s, r = document) => r.querySelector(s);
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
let INS = null, SAT = null, CM = null, MAPST = null, OSMGEO = null, STATUS = null;   // insights, satellite, trained Cumbre, map status
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
  hit.addEventListener("pointermove", ev => show(pos(ev)));
  hit.addEventListener("pointerdown", ev => show(pos(ev)));
  hit.addEventListener("pointerleave", ev => { if (ev.pointerType === "mouse") hide(); });
  hit.addEventListener("focus", () => show(xToPx(xs[xs.length - 1])));
  hit.addEventListener("blur", hide);
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
function renderHeader(){
  const g = L.generated_at ? new Date(L.generated_at) : null;
  $("#updated").textContent = g ? "Actualizado " + g.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) + (L.live_vail ? " · reporte de Vail al momento" : "") : "";
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
  renderHowto();
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
    if (M.p10 && M.p90) parts.push("80% de probabilidad entre el " + fmtD(M.p10) + " y el " + fmtD(M.p90));
    $("#p-sub").textContent = parts.join(". ") + ".";
  }
  // chart
  const end = d2n((M.syear + 1) + "-02-28");
  const prob = M.res.filter(r => r.d <= end).map(r => [r.d, r.p * 100]);
  const clim = M.clim.filter(r => r.d <= end).map(r => [r.d, r.p * 100]);
  const A = css("--accent"), G = css("--muted");
  legend($("#lg-prob"), [{ n: "Este año (modelo)", c: A }, { n: "Histórico 2002–2025", c: G }]);
  lineChart($("#ch-prob"), {
    x: [M.t0, end], y: [0, 100], yTicks: [0, 25, 50, 75, 100], yFmt: v => v + "%", height: 200, aria: "Probabilidad acumulada de apertura por fecha",
    series: [{ pts: clim, c: G, w: 1.5 }, { pts: prob, c: A, area: true }],
    vlines: [{ x: selTarget, label: fmtD(selTarget) }],
    marks: [{ x: selTarget, y: (M.open ? 1 : M.at(selTarget)) * 100, c: A, label: pct(M.open ? 1 : M.at(selTarget)), dx: selTarget > (M.t0 + end) / 2 ? -8 : 8, anchor: selTarget > (M.t0 + end) / 2 ? "end" : "start" }],
    tip: { xs: prob.map(p => p[0]).filter((_, i) => i % 1 === 0), rows: (x, Y) => { const a = prob.find(p => p[0] === x), b = clim.find(p => p[0] === x); return { title: fmtDL(x), rows: [{ n: "Este año", v: pct(a[1] / 100), c: A, py: Y(a[1]) }, { n: "Histórico", v: pct(b[1] / 100), c: G, py: Y(b[1]) }] }; } }
  });
  $("#p-note").textContent = "Probabilidad de que algún Back Bowl abra en o antes de cada fecha. Se recalcula con cada actualización de nieve, pronóstico y noticias.";
}
function renderDeficit(){
  const need = M.need50, need80 = M.need80, cur = M.swe0, slr = S.model.slr;
  const defSwe = Math.max(0, need - cur), def80 = Math.max(0, need80 - cur);
  const [v, u] = lenParts(defSwe * slr);
  $("#def-big").replaceChildren("≈ " + v, el("span", { class: "u" }, u));
  $("#def-sub").textContent = M.open ? "Ya abrieron; referencia de cuánta nieve hacía falta." :
    "de nieve nueva (" + len(defSwe, true) + " de agua) para que la probabilidad de abrir en una semana llegue a 50%. Para 80%: ≈ " + len(def80 * slr) + ".";
  const max = Math.max(need80 * 1.15, cur * 1.1, 7);
  const m = $("#meter");
  m.replaceChildren(
    el("div", { class: "fill", style: "width:" + clamp(cur / max * 100, 0.8, 100) + "%" }),
    el("div", { class: "tick", style: "left:" + (need / max * 100) + "%" }, el("em", null, "50% · " + len(need, true))),
    el("div", { class: "tick b", style: "left:" + (need80 / max * 100) + "%" }, el("em", null, "80% · " + len(need80, true))),
    el("div", { class: "now", style: "left:0" }, "Hoy: " + len(cur, true) + " de agua en la nieve")
  );
  const cdays = ((L.cumbre || {}).days || []);
  if (cdays.length && !M.open){ const t15 = cumbreTotals(cdays); $("#def-sub").textContent += " El pronóstico Cumbre trae ≈ " + len(t15.m) + " en los próximos " + cdays.length + " días (" + lenRange(t15.lo, t15.hi) + ")."; }
  const tot = (L.report || {}).season_total;
  const ref = S.model.season_total_at_open.map(r => r.season + ": " + len(r.inches)).join(" · ");
  $("#def-ref").textContent = "Referencia de Vail: los Back Bowls abrieron con " + ref + " de nevada acumulada en la temporada" + (tot != null ? "; hoy van " + len(tot) + "." : ".") +
    " El agua en la nieve se mide en la estación SNOTEL de Vail Mountain; 1 de agua ≈ " + slr + " de nieve reportada por Vail.";
}
function renderNow(){
  const R = L.report || {}, T = L.terrain || {}, sn = M.medRow;
  const pctMed = sn.med ? Math.round(sn.swe / sn.med * 100) : null;
  const tiles = [
    [len(R.h24), "Nieve 24 h"], [len(R.h48), "Nieve 48 h"], [len(R.d7), "Nieve 7 días"],
    [len(R.season_total), "Acumulada temporada"], [len(R.base), "Base (con nieve artificial)"],
    liftsLabel().slice(0, 2), [(T.trails_open ?? "–") + "/" + (T.trails_total ?? "–"), "Pistas abiertas"],
    [len(sn.swe, true), "Agua en la nieve (SNOTEL)" + (pctMed != null ? " · " + pctMed + "% de lo normal" : "")],
    [len(sn.depth), "Profundidad natural (SNOTEL)"],
  ];
  const cd = ((L.cumbre || {}).days || []);
  if (cd.length) for (const n of [5, 10, 16]) tiles.push([len(cumbreTotals(cd.slice(0, n)).m), "Pronóstico " + n + " días"]);
  $("#now-kv").replaceChildren(...tiles.map(([b, s]) => el("div", null, el("b", null, b), el("span", null, s))));
  $("#now-src").textContent = "Reporte de Vail: " + vailUpd(R.updated_text) + ". SNOTEL Vail Mountain (3,139 m): " + fmtD(d2n(sn.date)) + "." + (cd.length ? " Pronóstico: Cumbre, parte alta." : "");
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
    el("p", null, el("span", { class: "sig", style: "border-color:" + col }, el("span", { style: "color:" + col }, icon), lab + (N.announced_date ? " · anuncio para el " + fmtD(d2n(N.announced_date)) : "")), " ", el("span", { class: "tiny muted" }, N.checked ? "revisado " + fmtD(d2n(N.checked)) : "")),
    N.summary ? el("p", { class: "small" }, N.summary) : null,
    el("ul", { class: "list" }, ...(N.items || []).map(it => el("li", null, el("div", { class: "l" }, el("a", { href: it.url, target: "_blank", rel: "noopener" }, it.title), el("div", { class: "tiny muted" }, (it.source || "") + (it.date ? " · " + fmtD(d2n(it.date)) : "")))))),
    D && D.headline ? el("p", { class: "small" }, "Discusión del día: ", el("a", { href: D.url, target: "_blank", rel: "noopener" }, D.headline), el("span", { class: "muted" }, " · " + (D.source || "OpenSnow") + (D.date ? ", " + fmtD(d2n(D.date)) : ""))) : null,
    el("p", { class: "tiny muted" }, "Las noticias mueven la probabilidad de los próximos 10 días: un anuncio oficial con fecha la sube a 95% para ese día.")
  );
}
function renderAnalogs(){
  const k = md(M.t0);
  const rows = S.openings.map(o => {
    const s = S.seasons[String(o.season)];
    const yr = k < "07-01" ? o.season + 1 : o.season; const idx = d2n(yr + "-" + k) - d2n(s.start);
    const sw = (idx >= 0 && idx < s.swe.length) ? s.swe[idx] : null;
    return { o, sw, gap: d2n(o.date) - d2n(yr + "-" + k) };
  }).filter(r => r.sw != null).sort((a, b) => Math.abs(a.sw - M.swe0) - Math.abs(b.sw - M.swe0)).slice(0, 4);
  $("#analog-intro").textContent = "Temporadas con agua en la nieve parecida a hoy (" + len(M.swe0, true) + ") el " + fmtD(M.t0) + ", y cuándo abrieron:";
  $("#analogs").replaceChildren(...rows.map(r => el("li", null,
    el("div", { class: "l" }, el("b", null, r.o.season + "-" + String(r.o.season + 1).slice(2)), el("div", { class: "tiny muted" }, len(r.sw, true) + " de agua ese día · " + r.o.what)),
    el("div", { class: "r" }, el("b", null, fmtD(d2n(r.o.date))), el("div", { class: "tiny muted" }, r.gap > 0 ? r.gap + " días después" : "ya estaban abiertos")))));
}
function renderHowto(){
  const m = S.model, b = m.brier;
  const host = $("#howto");
  host.replaceChildren(
    el("details", null, el("summary", null, "El modelo en 4 pasos"),
      el("p", { class: "small ink2" }, "1. Junté la fecha en que abrieron los Back Bowls en " + m.n_seasons + " temporadas (2002-03 a 2025-26) de comunicados de Vail Resorts y prensa local, y el agua acumulada en la nieve (SWE) de la estación SNOTEL de Vail Mountain cada día."),
      el("p", { class: "small ink2" }, "2. Ajusté un modelo de riesgo diario: la probabilidad de que abran cualquier día sube con el agua en la nieve. Con 4.9 in de agua hay ~9% por día; con 6 in, ~27%."),
      el("p", { class: "small ink2" }, "3. Simulo 4,000 temporadas posibles desde hoy: los primeros 16 días usan la distribución del pronóstico Cumbre y después la secuencia real de nevadas de alguna de las 22 temporadas guardadas. También sorteo la incertidumbre del propio modelo."),
      el("p", { class: "small ink2" }, "4. Las noticias ajustan los próximos 10 días: un anuncio oficial con fecha fija esa fecha en 95%; reportes de trabajos de patrulla la suben; avisos de retraso la bajan.")),
    el("details", null, el("summary", null, "Qué tan bien funciona"),
      el("p", { class: "small ink2" }, "Probé cada temporada dejándola fuera del ajuste. Con la nieve real conocida, el modelo ubica la fecha con un error mediano de " + m.perfect_knowledge.median_abs_err_days + " días (promedio " + m.perfect_knowledge.mae_days + ")."),
      el("p", { class: "small ink2" }, "Como pronóstico sin saber la nieve futura, acierta más que el promedio histórico (puntaje Brier, menor es mejor): " + b.map(x => "desde el " + x.asof + " para el " + x.target + ": " + x.model.toFixed(2) + " vs " + x.clim.toFixed(2)).join("; ") + "."),
      el("p", { class: "small ink2" }, "Límite conocido: en años muy secos (2011-12 y 2025-26) Vail abrió 3 a 5 semanas después de lo que la nieve sola sugería, por nieve débil y laderas al sur derretidas. Este año arrancó seco, así que toma las fechas tempranas con cautela.")),
    el("details", null, el("summary", null, "Fuentes"),
      el("ul", { class: "small ink2", style: "padding-left:18px;margin:6px 0" },
        el("li", null, "Estado de pistas, reporte y pronóstico de Vail: ", el("a", { href: "https://github.com/jacobschulman/ski-run-scraper", target: "_blank", rel: "noopener" }, "ski-run-scraper"), " (copia pública diaria de vail.com)."),
        el("li", null, "Nieve: ", el("a", { href: S.links.snotel, target: "_blank", rel: "noopener" }, "NRCS SNOTEL #842 Vail Mountain"), "."),
        el("li", null, "Pronóstico: Vail, NWS, 9 modelos y 3 ensambles vía ", el("a", { href: "https://open-meteo.com", target: "_blank", rel: "noopener" }, "Open-Meteo"), " (CC BY 4.0)."),
        el("li", null, "Satélite: Sentinel-2 (Copernicus, vía Element 84). Mapa: OpenStreetMap, AWS Terrain Tiles."),
        el("li", null, "Fechas históricas: comunicados de Vail Resorts, Vail Daily, RealVail, SnowBrains."))),
  );
}
const CARD = ["N","NE","E","SE","S","SO","O","NO"];
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
const SRC_LABEL = { Vail: "Vail", NWS: "NWS", ECMWF: "ECMWF", AIFS: "AIFS", GFS: "GFS", HRRR: "HRRR", NBM: "NBM", ICON: "ICON", GEM: "GEM", UKMO: "UKMO", JMA: "JMA", Cumbre: "Cumbre" };
const SRC_DESC = { Vail: "pronóstico de Vail para la cima", NWS: "Servicio Meteorológico de EE. UU.", ECMWF: "modelo europeo", AIFS: "inteligencia artificial de ECMWF", GFS: "modelo global de EE. UU.", HRRR: "alta resolución de EE. UU. (2 días)", NBM: "mezcla oficial de EE. UU.", ICON: "modelo alemán", GEM: "modelo canadiense", UKMO: "modelo británico", JMA: "modelo japonés" };
function heatCell(v, maxV){
  if (v == null) return el("td", { class: "c", style: "color:var(--muted)" }, "·");
  if ((UNITS === "metric" ? Math.round(v * 2.54) : Math.round(v * 10)) === 0) return el("td", { class: "c", style: "color:var(--muted)" }, "0");
  const a = Math.min(0.75, 0.08 + v / maxV * 0.9);
  return el("td", { class: "c", style: "background:color-mix(in srgb, var(--accent) " + Math.round(a * 100) + "%, transparent)" }, UNITS === "metric" ? String(Math.round(v * 2.54)) : (Math.round(v * 10) / 10).toLocaleString("es-MX"));
}
function renderPronostico(){
  const C = L.cumbre || { days: [] };
  const days = C.days || [];
  const A = css("--accent");
  const nsrc = Object.keys(C.sources || {}).length;
  const nens = Object.values(C.ensembles || {}).reduce((a, e) => a + (e.members || 0), 0);
  $("#fc-intro").textContent = "Nuestro motor estilo PEAKS para la parte alta de Vail (3,390 m): junta " + nsrc + " fuentes, corrige cada una con lo que de verdad nevó en temporadas pasadas y usa " + nens + " escenarios de ensambles para el rango.";
  const tiles = [[5, "Próximos 5 días"], [10, "10 días"], [days.length, days.length + " días"]].map(([n, lab]) => {
    const t = cumbreTotals(days.slice(0, n));
    return el("div", null, el("b", null, len(t.m)), el("span", null, lab), el("span", null, lenRange(t.lo, t.hi)));
  });
  $("#fc-tot").replaceChildren(...tiles);
  $("#fc-story").replaceChildren(...cumbreStory(days).map(([a, b]) => el("li", null, el("div", { class: "l" }, el("b", null, a), el("div", { class: "small ink2" }, b)))));
  legend($("#lg-fc"), [{ n: "Pronóstico (más intenso = más confianza)", c: A, box: true }, { n: "Solo ensambles (días 11–16)", c: "color-mix(in srgb, " + A + " " + Math.round((+css("--prob-op") || 0.35) * 100) + "%, transparent)", box: true }, { n: "Escenario alto (90%)", c: "color-mix(in srgb, " + A + " " + Math.round((+css("--wash-op") || 0.16) * 100) + "%, transparent)", box: true }]);
  const cv = v => v == null ? null : (UNITS === "metric" ? v * 2.54 : v);
  barChart($("#ch-fc"), {
    aria: "Nieve pronosticada por día, " + days.length + " días", minMax: UNITS === "metric" ? 10 : 4, sub2: true, sub2Label: "%", wash: true, yUnit: UNITS === "metric" ? "cm" : "in", height: 250,
    bars: days.map(d => { const n = d2n(d.date); const op = d.kind !== "det" ? (+css("--prob-op") || 0.35) : d.conf === "alta" ? 1 : d.conf === "media" ? 0.72 : 0.55;
      const srcRows = SRC_ORDER.filter(k => d.srcs && d.srcs[k]).map(k => { const v = d.srcs[k]; return [SRC_LABEL[k], len(v[0], true) + (Math.abs(v[1] - v[0]) > 0.05 ? " → " + len(v[1], true) : "")]; });
      return { label: DIA2[n2date(n).getUTCDay()], sub: String(n2date(n).getUTCDate()), sub2: String(Math.round(d.p * 100)), v: cv(d.mean), lo: cv(d.lo), hi: cv(d.hi), op,
        title: fmtDL(n) + (d.k === 0 ? " (hoy)" : ""),
        tip: [["Cumbre", len(d.mean, true)], ["Rango 10–90%", lenRange(d.lo, d.hi)], ["Prob. de nevada", Math.round(d.p * 100) + "%"], ["Confianza", d.conf],
          ...(d.ens ? [["Ensambles (" + d.ens.n + ")", len(d.ens.mean, true)]] : []), ...srcRows.slice(0, 7),
          ...(d.extra > 0.05 ? [["+ ligera no anunciada", len(d.extra, true)]] : []),
          ...(d.tmin != null ? [["Temp. cima", tempC(d.tmin) + " a " + tempC(d.tmax)]] : []),
          ...(d.twet != null && d.twet > 0.5 ? [["Ojo", "puede caer como lluvia"]] : []),
          ...(d.wdir != null ? [["Viento al nevar", card(d.wdir)]] : [])] }; }),
    fmt: (v, axis) => axis ? String(v) : (v < 0.05 ? "0" : UNITS === "metric" ? String(Math.round(v)) : (v < 10 ? (Math.round(v * 10) / 10).toLocaleString("es-MX") : String(Math.round(v))))
  });
  $("#fc-note").textContent = "Nieve nueva en la parte alta, en " + (UNITS === "metric" ? "cm" : "pulgadas") + ". La fila % es la probabilidad de nevada del día. Toca una barra para ver cada fuente. Calculado " + (C.issued ? new Date(C.issued).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "–");
  // comparison table
  const srcNames = SRC_ORDER.filter(k => C.sources && C.sources[k]);
  const maxV = Math.max(4, ...days.map(d => d.hi));
  $("#t-cmp").replaceChildren(el("tr", null, el("td", { class: "src" }, UNITS === "metric" ? "cm" : "in"), ...days.map(d => el("th", null, DIA2[n2date(d2n(d.date)).getUTCDay()] + " " + n2date(d2n(d.date)).getUTCDate()))),
    el("tr", { class: "cum" }, el("td", { class: "src" }, "Cumbre"), ...days.map(d => heatCell(d.mean, maxV))),
    ...srcNames.map(nm => { const ser = C.sources[nm] || {}; return el("tr", null, el("td", { class: "src", title: SRC_DESC[nm] || "" }, SRC_LABEL[nm] || nm), ...days.map(d => heatCell(ser[d.date] == null || (nm === "Vail" && d.k === 0) ? null : ser[d.date], maxV))); }),
    el("tr", null, el("td", { class: "src" }, "Ensambles %"), ...days.map(d => el("td", { class: "c", style: d.ens ? "background:color-mix(in srgb, var(--accent-2) " + Math.round(Math.min(0.6, d.ens.p_any * 0.6) * 100) + "%, transparent)" : "color:var(--muted)" }, d.ens ? String(Math.round(d.ens.p_any * 100)) : "·"))));
  renderLearning(C);
  // Vail's own table
  const locs = ((L.report || {}).forecast || []);
  const base = locs.find(l => l.name === "Vail base"), cima = locs.find(l => l.name === "Vail cima");
  const tv = $("#t-vail");
  tv.replaceChildren(el("tr", null, el("th", null, "Día"), el("th", null, "Cielo (cima)"), el("th", { class: "n" }, "Base"), el("th", { class: "n" }, "Cima"), el("th", { class: "n" }, "Nieve día · noche")));
  (cima || base || { days: [] }).days.forEach((d, i) => {
    const b = base ? base.days[i] : null; const nd = d2n(d.date);
    tv.append(el("tr", null, el("td", { style: "white-space:nowrap" }, DIA[n2date(nd).getUTCDay()] + " " + n2date(nd).getUTCDate()), el("td", { class: "small" }, sky(d.desc)),
      el("td", { class: "n", style: "white-space:nowrap" }, b ? temp(b.hi) + "/" + temp(b.lo) : "–"), el("td", { class: "n", style: "white-space:nowrap" }, temp(d.hi) + "/" + temp(d.lo)),
      el("td", { class: "n", style: "white-space:nowrap" }, len(d.snow_day) + " · " + len(d.snow_night))));
  });
  $("#vail-fc-src").textContent = "Publicado por Vail en su reporte de nieve (" + vailUpd((L.report || {}).updated_text) + ").";
  // NWS
  const N = L.nws || {}, NE = L.nws_es;
  let auto = false;
  const periods = (NE && NE.periods && NE.periods.length) ? NE.periods : (N.periods || []).map(p => {
    const t = window.NwsEs ? NwsEs.translate(p.text) : null; if (t) auto = true;
    return { name: window.NwsEs ? NwsEs.periodName(p.name) : p.name, text: t || p.text };
  });
  $("#nws-meta").replaceChildren((N.office ? "NWS " + N.office : "NWS") + " · punto a " + (N.elevation_m ? Math.round(N.elevation_m).toLocaleString("es-MX") + " m" : "3,390 m") + (N.issued ? " · emitido " + new Date(N.issued).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "") + (NE ? "" : auto ? " · traducido automáticamente" : " · en inglés") + " · ", el("a", { href: N.url || "https://forecast.weather.gov", target: "_blank", rel: "noopener" }, "weather.gov"));
  $("#nws").replaceChildren(...periods.map(p => el("li", null, el("div", { class: "l" }, el("b", null, p.name), el("div", { class: "small ink2" }, p.text)))));
  // AFD
  const AF = L.afd || {}, AE = L.afd_es;
  if (AE && AE.bullets && AE.bullets.length) $("#afd").replaceChildren(...AE.bullets.map(x => el("li", null, el("div", { class: "l small" }, x))));
  else { const sec = AF.sections || {}; const keys = ["Key Messages", "Short Term", "Long Term", "Synopsis", "Discussion"].filter(k => sec[k]);
    $("#afd").replaceChildren(...keys.slice(0, 3).map(k => el("li", null, el("div", { class: "l" }, el("b", null, k), el("div", { class: "small ink2", style: "white-space:pre-line" }, sec[k].slice(0, 1200) + (sec[k].length > 1200 ? "…" : "")))))); }
  $("#afd-meta").replaceChildren("NWS Grand Junction" + (AF.issued ? " · emitida " + new Date(AF.issued).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "") + (AE ? " · resumen en español" : " · en inglés") + " · ", el("a", { href: AF.url || "https://forecast.weather.gov", target: "_blank", rel: "noopener" }, "texto completo"));
  // ensembles table
  const te = $("#t-ens");
  te.replaceChildren(el("tr", null, el("th", null, "Día"), el("th", { class: "n" }, "Nieve"), el("th", { class: "n" }, "≥ " + (UNITS === "metric" ? "2.5 cm" : "1 in")), el("th", { class: "n" }, "≥ " + (UNITS === "metric" ? "15 cm" : "6 in")), el("th", { class: "n" }, "Promedio")),
    ...days.filter(d => d.ens).map(d => el("tr", null, el("td", { style: "white-space:nowrap" }, DIA[n2date(d2n(d.date)).getUTCDay()] + " " + n2date(d2n(d.date)).getUTCDate()),
      el("td", { class: "n" }, Math.round(d.ens.p_any * 100) + "%"), el("td", { class: "n" }, Math.round(d.ens.p_1 * 100) + "%"), el("td", { class: "n" }, Math.round(d.ens.p_6 * 100) + "%"), el("td", { class: "n" }, len(d.ens.mean, true)))));
  const ensNames = Object.entries(C.ensembles || {}).map(([k, e]) => k + " (" + e.members + ")").join(", ");
  $("#ens-meta").textContent = "Porcentaje de escenarios con nieve en la parte alta. " + ensNames + ", vía Open-Meteo. Ya incluyen la corrección de Cumbre.";
  const D = L.discussion;
  $("#opensnow-row").style.display = D && D.headline ? "" : "none";
  if (D && D.headline) $("#opensnow").replaceChildren(el("a", { href: D.url, target: "_blank", rel: "noopener" }, D.headline), el("span", { class: "muted" }, " · " + (D.author || "") + (D.date ? ", " + fmtD(d2n(D.date)) : "")));
}
function renderLearning(C){
  const T = CM, st = C.stats || {};
  const vOn = ((st.Vail || {}).online) || {};
  const pct = x => Math.round(x * 100) + "%";
  if (T && T.models){
    const w = T.window || [];
    const nSeas = new Set(Object.keys(T.models).length ? [] : []).size;
    const yrs = w.length ? (n2date(d2n(w[0])).getUTCFullYear() + "–" + String(n2date(d2n(w[1])).getUTCFullYear()).slice(2)) : "";
    $("#learn-intro").textContent = "Entrené a Cumbre con " + T.n_days + " días de nieve (" + yrs + "): comparé lo que cada modelo pronosticó de 1 a 7 días antes con lo que de verdad cayó en Vail, y aprendí cuánto corregir a cada uno y cuánto confiar en él.";
    const b1 = (T.blend || {})["1"] || {}, b5 = (T.blend || {})["5"] || {};
    const full1 = Object.entries(b1.singles || {}).filter(([, v]) => v.n >= 0.8 * (b1.n || 0)).sort((a, b) => a[1].mae - b[1].mae);
    const best1 = full1.length ? full1[0][0] : b1.best;
    const gain1 = full1.length ? 1 - full1[0][1].blend / full1[0][1].mae : b1.gain;
    $("#learn-kv").replaceChildren(
      el("div", null, el("b", null, b1.mae != null ? len(b1.mae, true) : "–"), el("span", null, "Error típico de Cumbre para mañana")),
      el("div", null, el("b", null, gain1 != null ? (gain1 > 0.005 ? "−" + pct(gain1) : "≈") : "–"), el("span", null, "de error vs el mejor modelo solo" + (best1 ? " (" + best1 + ")" : ""))),
      el("div", null, el("b", null, b5.mae != null ? len(b5.mae, true) : "–"), el("span", null, "Error típico a 5 días")));
    const rows = Object.entries(T.models).map(([nm, ms]) => {
      const s1 = ms["1"] || {}, s5 = ms["5"] || {};
      const f1 = (b1.singles || {})[nm] || {};
      return { nm, b: s1.b, e1: f1.mae != null ? f1.mae : s1.mae, c1: f1.blend, pod: s1.pod, n: s1.n };
    }).sort((a, b) => (a.e1 ?? 9) - (b.e1 ?? 9));
    const t = $("#t-learn");
    t.replaceChildren(el("tr", null, el("th", null, "Fuente"), el("th", { class: "n" }, "Corrección"), el("th", { class: "n" }, "Su error"), el("th", { class: "n" }, "Cumbre"), el("th", { class: "n" }, "Ve la nieve")),
      ...rows.map(r => el("tr", null, el("td", { title: SRC_DESC[r.nm] || "" }, SRC_LABEL[r.nm] || r.nm), el("td", { class: "n" }, r.b != null ? "×" + r.b.toFixed(2) : "–"), el("td", { class: "n" }, r.e1 != null ? len(r.e1, true) : "–"), el("td", { class: "n" }, r.c1 != null ? el("b", null, len(r.c1, true)) : "–"), el("td", { class: "n" }, r.pod != null ? pct(r.pod) : "–"))),
      el("tr", null, el("td", null, "Vail"), el("td", { class: "n" }, vOn.b != null ? "×" + vOn.b.toFixed(2) : "–"), el("td", { class: "n" }, vOn.mae != null ? len(vOn.mae, true) : "–"), el("td", { class: "n" }, "–"), el("td", { class: "n" }, "")));
    $("#learn-note").textContent = "Pronósticos para el día siguiente. Corrección: por cuánto multiplica Cumbre la nieve que anuncia cada fuente (×1.30 = se queda corta 30%). Su error: diferencia promedio por día de esa fuente ya corregida; Cumbre: el error de la mezcla en esos mismos días (algunos modelos solo tienen archivo desde 2025). Se mide en temporadas que el ajuste no vio. Ve la nieve: de los días con 2.5 cm o más, cuántos anticipó. Reentrenado " + (T.trained_at ? fmtD(d2n(T.trained_at.slice(0, 10))) : "–") + ".";
  } else {
    $("#learn-intro").textContent = "Cumbre compara cada pronóstico con la nieve que Vail reporta después. Con " + (vOn.n || 0) + " pronósticos de Vail aprendió que cuando Vail anuncia nieve cae ≈ " + (vOn.b || 1).toFixed(1) + " veces lo anunciado.";
    $("#learn-kv").replaceChildren(); $("#t-learn").replaceChildren(); $("#learn-note").textContent = "";
  }
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
  $("#map-sum").textContent = (T.trails_open ?? "–") + " de " + (T.trails_total ?? "–") + " pistas y " + liftsLabel()[2] + " · Back Bowls " + (T.bb_trails_open ?? 0) + "/" + (T.bb_trails_total ?? "–") + " · reporte del " + (L.terrain_date ? fmtD(d2n(L.terrain_date)) : "–") + ".";
  legend($("#lg-map"), [{ n: "Pista abierta", c: "#35e05f" }, { n: "Cerrada", c: css("--closed") }, { n: "Telesilla abierta", c: "#ffd23f" }, { n: "Telesilla cerrada (punteada)", c: css("--ink-2") }]);
  const ov = SAT && SAT.overlay;
  $("#map-note").textContent = "Relieve 3D real (exagerado 1.35×). Pistas y telesillas de OpenStreetMap con el estado del reporte de Vail" + (MAPST && MAPST.terrain_date ? " del " + fmtD(d2n(MAPST.terrain_date)) : "") + "." + (ov ? " Imagen de fondo: Sentinel-2 del " + fmtD(d2n(ov.date)) + ", la pasada despejada más reciente." : "") + " Toca una pista para ver su nombre.";
  renderZoneDetail();
  const Lk = S.links;
  $("#map-links").replaceChildren(
    el("a", { class: "btn", href: Lk.google_earth, target: "_blank", rel: "noopener" }, "Google Earth 3D"),
    el("a", { class: "btn", href: Lk.openskimap, target: "_blank", rel: "noopener" }, "OpenSkiMap"),
    el("a", { class: "btn", href: Lk.vail_trailmap, target: "_blank", rel: "noopener" }, "Mapa oficial"),
    el("a", { class: "btn", href: Lk.vail_terrain, target: "_blank", rel: "noopener" }, "Estado oficial"));
  if (mapReady){ window.Map3D && Map3D.resize(); return; }
  const msg = $("#mapmsg");
  const fallback = err => { $("#map-layers").replaceChildren(); msg.textContent = "No pude cargar el mapa 3D (" + (err && err.message || err) + "). Te muestro el esquema."; setTimeout(() => msg.remove(), 4000); $("#map3d").replaceChildren(); renderMapaSchematic(); };
  const go = geo => {
    if (!window.Map3D) return fallback("falta map3d.js");
    const areas = ((MAPST || {}).areas || {}).features || [];
    Map3D.init($("#map3d"), { runs: Map3D.prepare(geo, MAPST), areas, sat: ov ? { true: ov.true, snow: ov.snow, coordinates: ov.coordinates, date: fmtD(d2n(ov.date)) } : null,
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
    $("#sat-intro").textContent = "Última pasada despejada de Sentinel-2: " + fmtDL(d2n(ov.date)) + ". Con 10 m por pixel se distingue cada pista. Norte arriba: el frente mira al pueblo y los Back Bowls son la ladera al sur de la cresta.";
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
      el("div", null, el("b", null, pc(ov.snow_bb)), el("span", null, "Back Bowls con nieve")),
      el("div", null, el("b", null, pc(ov.snow_front)), el("span", null, "Frente con nieve")),
      el("div", null, el("b", null, pc(ov.cloud)), el("span", null, "Nubes en la zona")));
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
function renderHistorial(){
  const A = css("--accent"), O = css("--accent-2"), G = css("--muted");
  const sy = M.syear, x0 = d2n(sy + "-10-20"), x1 = d2n((sy + 1) + "-03-31");
  const mdToN = k => d2n((k >= "07-01" ? sy : sy + 1) + "-" + k);
  const med = S.median.map(([k, v]) => [mdToN(k), v]).filter(p => p[0] >= x0 && p[0] <= x1);
  const band = S.band.map(([k, lo, mid, hi]) => [mdToN(k), lo, hi]);
  const cur = (L.snotel || []).filter(r => r.swe != null).map(r => [d2n(r.date), r.swe]);
  const seasons = Object.keys(S.seasons).sort().reverse();
  const cs = S.seasons[cmpSeason];
  const cmp = cs ? cs.swe.map((v, i) => [d2n(cs.start) + i - (d2n(cs.start.slice(0, 4) + "-10-01") - d2n(sy + "-10-01")), v]) : [];
  const op = S.openings.find(o => String(o.season) === cmpSeason);
  const opN = op ? d2n(op.date) - (d2n(op.season + "-10-01") - d2n(sy + "-10-01")) : null;
  const toU = v => UNITS === "metric" ? v * 2.54 : v;
  const vis = [...med.map(p => p[1]), ...band.filter(p => p[0] <= x1).map(p => p[2]), ...cur.map(p => p[1])].filter(v => v != null);
  const yT = niceTicks(toU(Math.max(...vis)) * 1.04, 4), ymax = yT[yT.length - 1];
  $("#swe-intro").textContent = "Agua acumulada en la nieve en la estación SNOTEL de Vail Mountain (3,139 m). Es la mejor medida de base natural: los Back Bowls no tienen nieve artificial.";
  $("#cmp-chips").replaceChildren(...["2025", "2024", "2023", "2021", "2017", "2011", "2010"].filter(y => S.seasons[y]).map(y => el("button", { type: "button", class: "chip", "aria-pressed": String(y === cmpSeason), onclick: () => { cmpSeason = y; renderHistorial(); } }, y + "-" + String(+y + 1).slice(2))));
  legend($("#lg-swe"), [{ n: "Esta temporada", c: A }, { n: (+cmpSeason) + "-" + String(+cmpSeason + 1).slice(2), c: O }, { n: "Mediana 1991–2020", c: G }, { n: "Rango 10–90% (2002–2025)", c: G, box: true }]);
  lineChart($("#ch-swe"), {
    x: [x0, x1], y: [0, ymax], yTicks: yT, yFmt: v => String(v), yUnit: UNITS === "metric" ? "cm" : "in", height: 230, aria: "Agua en la nieve por fecha",
    band: { pts: band.map(p => [p[0], toU(p[1]), toU(p[2])]), c: G },
    series: [{ pts: med.map(p => [p[0], toU(p[1])]), c: G, w: 1.5 }, { pts: cmp.map(p => [p[0], p[1] == null ? null : toU(p[1])]), c: O }, { pts: cur.map(p => [p[0], toU(p[1])]), c: A, end: true }],
    marks: (op && opN >= x0 && opN <= x1) ? [{ x: opN, y: toU(op.swe), c: O, label: "abrió " + fmtD(d2n(op.date)) }] : [],
    tip: { xs: med.map(p => p[0]), rows: (x, Y) => { const m = med.find(p => p[0] === x), c = cur.find(p => p[0] === x), k = cmp.find(p => p[0] === x); return { title: fmtD(x), rows: [c ? { n: "Esta temporada", v: len(c[1], true), c: A, py: Y(toU(c[1])) } : null, k && k[1] != null ? { n: (+cmpSeason) + "-" + String(+cmpSeason + 1).slice(2), v: len(k[1], true), c: O, py: Y(toU(k[1])) } : null, { n: "Mediana", v: len(m[1], true), c: G, py: Y(toU(m[1])) }].filter(Boolean) }; } }
  });
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
    el("p", null, "Hecho para uso personal. Se actualiza solo cada 3 horas en ", el("a", { href: "https://github.com/acarcurs/nieve-vail", target: "_blank", rel: "noopener" }, "GitHub"), ". El modelo es una estimación: Vail decide la apertura según patrulla, avalanchas y operación."),
    el("p", { class: "tiny" }, "Datos: Vail Resorts (vía ski-run-scraper), NRCS SNOTEL, NWS, modelos y ensambles de ECMWF, NOAA, DWD, ECCC, UKMO y JMA vía Open-Meteo (CC BY 4.0), © colaboradores de OpenStreetMap, relieve AWS Terrain Tiles, Sentinel-2 de Copernicus (ESA), Google News."),
    bad.length ? el("p", { class: "tiny" }, "Fuentes con problema en la última actualización: " + bad.join(", ") + ". Se muestran sus datos anteriores.") : null);
}
/* ---------- router & boot ---------- */
const VIEWS = ["hoy", "pronostico", "mapa", "camaras", "satelite", "historial"];
const rendered = {};
const RENDER = { hoy: renderHoy, pronostico: renderPronostico, mapa: renderMapa, camaras: renderCamaras, satelite: renderSatelite, historial: renderHistorial };
function route(){
  const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "hoy";
  for (const k of VIEWS){ $("#v-" + k).classList.toggle("on", k === v); }
  document.querySelectorAll("nav.tabs a").forEach(a => { if (a.dataset.v === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
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
{ const nw = $("nav.tabs .wrap"), nv = $("nav.tabs"); const f = () => nv.classList.toggle("end", nw.scrollLeft + nw.clientWidth >= nw.scrollWidth - 4); nw.addEventListener("scroll", f, { passive: true }); window.addEventListener("resize", f); setTimeout(f, 50); }
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
  if (changed){ L.live_vail = new Date().toISOString(); M = runModel(); renderHeader(); rerenderAll(); }
}
const bust = "t=" + Math.floor(Date.now() / 60000);
const getJ = (u, must) => fetch(u + "?" + bust).then(r => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }).catch(e => { if (must) throw e; return null; });
Promise.all([getJ("data/static.json", true), getJ("data/live.json", true), getJ("data/insights.json"), getJ("data/sat/index.json"), getJ("data/cumbre_model.json"), getJ("data/map/status.json"), getJ("data/status.json")])
  .then(([s, l, ins, sat, cm, ms, st]) => { S = s; L = l; INS = ins; SAT = sat; CM = cm; MAPST = ms; STATUS = st; mergeInsights(); M = runModel(); renderHeader(); renderFooter(); route(); liveVail(); })
  .catch(err => { $("#fatal").replaceChildren(el("div", { class: "err" }, "No pude cargar los datos (" + err.message + "). Vuelve a abrir la página en un momento.")); route(); });

import re
p = "/home/claude/nieve-vail/assets/app.js"
s = open(p).read()

def replace_fn(src, name, code):
    i = src.index("\nfunction " + name + "(") + 1
    m = re.compile(r"\n(?=(function |const |let |/\* |async function ))").search(src, i + 10)
    return src[:i] + code.strip() + "\n" + src[m.start() + 1:]

def rep(a, b):
    global s
    assert a in s, ("MISSING", a[:120])
    s = s.replace(a, b, 1)

# ---------------------------------------------------------------- news
s = replace_fn(s, "renderNews", r'''
function mergeInsights(){
  const I = INS || {};
  const ck = x => (x && x.checked) || "";
  if (I.news && ck(I.news) >= ck(L.news)) L.news = I.news;
  if (I.discussion) L.discussion = I.discussion;
  if (I.nws) L.nws_es = I.nws;
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
''')

# ---------------------------------------------------------------- forecast
a0 = s.index("const SRC_LABEL = {")
s = s[:a0] + s[s.index("\n", a0) + 1:]          # drop the v1 SRC_LABEL line
s = replace_fn(s, "renderPronostico", r'''
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
  const periods = (NE && NE.periods && NE.periods.length) ? NE.periods : (N.periods || []);
  $("#nws-meta").replaceChildren((N.office ? "NWS " + N.office : "NWS") + " · punto a " + (N.elevation_m ? Math.round(N.elevation_m).toLocaleString("es-MX") + " m" : "3,390 m") + (N.issued ? " · emitido " + new Date(N.issued).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "") + (NE ? "" : " · en inglés") + " · ", el("a", { href: N.url || "https://forecast.weather.gov", target: "_blank", rel: "noopener" }, "weather.gov"));
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
    const best1 = b1.best;
    $("#learn-kv").replaceChildren(
      el("div", null, el("b", null, b1.mae != null ? len(b1.mae, true) : "–"), el("span", null, "Error típico de Cumbre para mañana")),
      el("div", null, el("b", null, b1.gain != null ? (b1.gain > 0 ? "−" + pct(b1.gain) : "≈") : "–"), el("span", null, "de error vs el mejor modelo solo" + (best1 ? " (" + best1 + ")" : ""))),
      el("div", null, el("b", null, b5.mae != null ? len(b5.mae, true) : "–"), el("span", null, "Error típico a 5 días")));
    const rows = Object.entries(T.models).map(([nm, ms]) => {
      const s1 = ms["1"] || {}, s5 = ms["5"] || {};
      const fair1 = ((b1.singles || {})[nm] || {}).mae, fair5 = ((b5.singles || {})[nm] || {}).mae;
      return { nm, b: s1.b, e1: fair1 != null ? fair1 : s1.mae, e5: fair5 != null ? fair5 : s5.mae, pod: s1.pod, n: s1.n };
    }).sort((a, b) => (a.e1 ?? 9) - (b.e1 ?? 9));
    const t = $("#t-learn");
    t.replaceChildren(el("tr", null, el("th", null, "Fuente"), el("th", { class: "n" }, "Corrección"), el("th", { class: "n" }, "Error 1 día"), el("th", { class: "n" }, "Error 5 días"), el("th", { class: "n" }, "Ve los días de nieve")),
      el("tr", { class: "cum" }, el("td", null, el("b", null, "Cumbre")), el("td", { class: "n" }, "mezcla"), el("td", { class: "n" }, el("b", null, b1.mae != null ? len(b1.mae, true) : "–")), el("td", { class: "n" }, el("b", null, b5.mae != null ? len(b5.mae, true) : "–")), el("td", { class: "n" }, "")),
      ...rows.map(r => el("tr", null, el("td", { title: SRC_DESC[r.nm] || "" }, SRC_LABEL[r.nm] || r.nm), el("td", { class: "n" }, r.b != null ? "×" + r.b.toFixed(2) : "–"), el("td", { class: "n" }, r.e1 != null ? len(r.e1, true) : "–"), el("td", { class: "n" }, r.e5 != null ? len(r.e5, true) : "–"), el("td", { class: "n" }, r.pod != null ? pct(r.pod) : "–"))),
      el("tr", null, el("td", null, "Vail"), el("td", { class: "n" }, vOn.b != null ? "×" + vOn.b.toFixed(2) : "–"), el("td", { class: "n" }, vOn.mae != null ? len(vOn.mae, true) : "–"), el("td", { class: "n" }, "–"), el("td", { class: "n" }, "")));
    $("#learn-note").textContent = "Corrección: por cuánto multiplica Cumbre la nieve que anuncia cada fuente (×1.30 = se queda corta 30%). Error típico: diferencia promedio por día, medida en temporadas que el ajuste no vio. «Ve los días de nieve»: de los días con 2.5 cm o más, cuántos anticipó. La fila Vail se aprende con cada reporte de 24 h. Reentrenado " + (T.trained_at ? fmtD(d2n(T.trained_at.slice(0, 10))) : "–") + ".";
  } else {
    $("#learn-intro").textContent = "Cumbre compara cada pronóstico con la nieve que Vail reporta después. Con " + (vOn.n || 0) + " pronósticos de Vail aprendió que cuando Vail anuncia nieve cae ≈ " + (vOn.b || 1).toFixed(1) + " veces lo anunciado.";
    $("#learn-kv").replaceChildren(); $("#t-learn").replaceChildren(); $("#learn-note").textContent = "";
  }
}
''')

# ---------------------------------------------------------------- map
s = s.replace("\nfunction renderMapa(){", "\nfunction renderMapaSchematic(){", 1)
s = s.replace('const T = L.terrain || { areas: [], lifts: [] };\n  const mp = S.map, box = $("#mapbox");',
              'const T = L.terrain || { areas: [], lifts: [] };\n  const mp = S.map, box = $("#map3d");\n  box.classList.add("mapbox"); $("#mapwrap").classList.add("schematic");', 1)
s = s.replace('''  const tb = $("#tilt"); tb.setAttribute("aria-pressed", String(tilted)); tb.onclick = () => { tilted = !tilted; box.classList.toggle("tilt", tilted); tb.setAttribute("aria-pressed", String(tilted)); };''', "", 1)
s = s.replace('''    const pick = () => { selZone = z.name; renderMapa(); };''', '''    const pick = () => { selZone = z.name; renderMapaSchematic(); renderZoneDetail(); };''', 1)
# cut the detail + links part out of the schematic into renderZoneDetail
i0 = s.index("  // detail\n  const z = mp.zones.find(x => x.name === selZone)")
i1 = s.index("\nfunction renderCamaras(")
detail = s[i0:i1]
s = s[:i0] + "}\n" + s[i1:]
detail = detail.replace("  // detail\n  const z = mp.zones.find(x => x.name === selZone), a =", "  const T = L.terrain || { areas: [], lifts: [] };\n  const z = (S.map.zones || []).find(x => x.name === selZone), a =")
detail = detail.rstrip()
assert detail.endswith("}")
zone_fn = "function renderZoneDetail(){\n" + detail + "\n"
new_map = r'''
let mapReady = false;
function renderMapa(){
  const T = L.terrain || { areas: [], lifts: [] };
  $("#map-sum").textContent = (T.trails_open ?? "–") + " de " + (T.trails_total ?? "–") + " pistas y " + (T.lifts_open ?? "–") + " de " + (T.lifts_total ?? "–") + " telesillas abiertas · Back Bowls " + (T.bb_trails_open ?? 0) + "/" + (T.bb_trails_total ?? "–") + " · reporte del " + (L.terrain_date ? fmtD(d2n(L.terrain_date)) : "–") + ".";
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
  const fallback = err => { msg.textContent = "No pude cargar el mapa 3D (" + (err && err.message || err) + "). Te muestro el esquema."; setTimeout(() => msg.remove(), 4000); $("#map3d").replaceChildren(); renderMapaSchematic(); };
  const go = geo => {
    if (!window.Map3D) return fallback("falta map3d.js");
    const areas = ((MAPST || {}).areas || {}).features || [];
    Map3D.init($("#map3d"), { runs: Map3D.prepare(geo, MAPST), areas, sat: ov ? { true: ov.true, snow: ov.snow, coordinates: ov.coordinates, date: fmtD(d2n(ov.date)) } : null,
      onArea: name => { selZone = name; renderZoneDetail(); const f = areas.find(x => x.properties.name === name); if (f) Map3D.flyToArea(f.center); $("#zone-detail").scrollIntoView({ behavior: "smooth", block: "nearest" }); } })
      .then(() => { mapReady = true; msg.remove(); })
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
'''
s = s.replace("\nlet selZone =", "\n" + new_map.strip() + "\n" + zone_fn + "let selZone =", 1)

# zone detail: area picker chips
s = s.replace('''  const trails = a.trails.slice().sort((p, q) => (q.o - p.o) || p.n.localeCompare(q.n));''', '''  const trails = a.trails.slice().sort((p, q) => (q.o - p.o) || p.n.localeCompare(q.n));
  const order = ["Sun Down Bowl", "Sun Up Bowl", "Tea Cup Bowl", "China Bowl", "Siberia Bowl", "Mongolia Bowl", "Blue Sky Basin", "Mid-Vail", "Lionshead", "Vail Village", "Golden Peak", "Game Creek Bowl", "North East Bowl"];
  const allA = (T.areas || []).slice().sort((p, q) => (order.indexOf(p.name) + 99) % 99 - (order.indexOf(q.name) + 99) % 99);''', 1)

# ---------------------------------------------------------------- cams
s = replace_fn(s, "renderCamaras", r'''
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
''')

# ---------------------------------------------------------------- satellite
s = replace_fn(s, "renderSatelite", r'''
function renderSatelite(){
  const X = SAT || { passes: [] }, ov = X.overlay;
  const passes = (X.passes || []).slice().sort((a, b) => b.datetime.localeCompare(a.datetime));
  const cop = d => S.links.copernicus_tpl.replaceAll("{d}", d);
  const pc = v => v == null ? "–" : Math.round(v * 100) + "%";
  if (ov){
    $("#sat-intro").textContent = "Última pasada despejada de Sentinel-2: " + fmtDL(d2n(ov.date)) + ", " + new Date(ov.datetime).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" }) + ". 10 m por pixel: se distingue cada pista. Norte arriba; los Back Bowls son la ladera café al sur de la cresta.";
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
  $("#sat-note").textContent = "Sentinel-2 (ESA Copernicus) vía Element 84 Earth Search. Se revisa cada 3 horas; " + (X.updated ? "última revisión " + new Date(X.updated).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "") + ".";
  const wv = d => S.links.worldview_tpl.replaceAll("{d}", d);
  $("#sat-links").replaceChildren(
    el("a", { class: "btn", href: cop(ov ? ov.date : n2d(M.t0 - 1)), target: "_blank", rel: "noopener" }, "Copernicus Browser"),
    el("a", { class: "btn", href: wv(n2d(M.t0 - 1)), target: "_blank", rel: "noopener" }, "NASA Worldview · ayer"),
    el("a", { class: "btn", href: S.links.google_earth, target: "_blank", rel: "noopener" }, "Google Earth 3D"));
}
''')

# ---------------------------------------------------------------- footer
s = replace_fn(s, "renderFooter", r'''
function renderFooter(){
  const st = (STATUS && STATUS.steps) || {};
  const bad = Object.entries(st).filter(([k, v]) => !v.ok && !v.skipped).map(([k]) => k);
  $("#foot").replaceChildren(
    el("p", null, "Hecho para uso personal. Se actualiza solo cada 3 horas en ", el("a", { href: "https://github.com/acarcurs/nieve-vail", target: "_blank", rel: "noopener" }, "GitHub"), ". El modelo es una estimación: Vail decide la apertura según patrulla, avalanchas y operación."),
    el("p", { class: "tiny" }, "Datos: Vail Resorts (vía ski-run-scraper), NRCS SNOTEL, NWS, modelos y ensambles de ECMWF, NOAA, DWD, ECCC, UKMO y JMA vía Open-Meteo (CC BY 4.0), © colaboradores de OpenStreetMap, relieve AWS Terrain Tiles, Sentinel-2 de Copernicus (ESA), Google News."),
    bad.length ? el("p", { class: "tiny" }, "Fuentes con problema en la última actualización: " + bad.join(", ") + ". Se muestran sus datos anteriores.") : null);
}
''')

# ---------------------------------------------------------------- boot
i0 = s.index('Promise.all([fetch("data/static.json")')
s = s[:i0] + r'''const bust = "t=" + Math.floor(Date.now() / 60000);
const getJ = (u, must) => fetch(u + "?" + bust).then(r => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }).catch(e => { if (must) throw e; return null; });
Promise.all([getJ("data/static.json", true), getJ("data/live.json", true), getJ("data/insights.json"), getJ("data/sat/index.json"), getJ("data/cumbre_model.json"), getJ("data/map/status.json"), getJ("data/status.json")])
  .then(([s, l, ins, sat, cm, ms, st]) => { S = s; L = l; INS = ins; SAT = sat; CM = cm; MAPST = ms; STATUS = st; mergeInsights(); M = runModel(); renderHeader(); renderFooter(); route(); })
  .catch(err => { $("#fatal").replaceChildren(el("div", { class: "err" }, "No pude cargar los datos (" + err.message + "). Vuelve a abrir la página en un momento.")); route(); });
'''
open(p, "w").write(s)
print("stage2 ok", len(s))

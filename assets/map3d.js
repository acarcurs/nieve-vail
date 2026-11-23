/* Nieve Vail · real 3D map (MapLibre GL JS).
   Terrain: AWS Terrain Tiles (Mapzen terrarium). Runs and lifts: OpenStreetMap, colored with
   Vail's open/closed status. Imagery: newest clear Sentinel-2 pass draped over the relief. */
(function () {
  "use strict";
  const LIB = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl";
  const VIEWS = {
    bowls: { center: [-106.343, 39.5990], zoom: 12.12, pitch: 60, bearing: -6 },
    front: { center: [-106.372, 39.6325], zoom: 12.55, pitch: 60, bearing: 174 },
    all: { center: [-106.350, 39.6060], zoom: 11.75, pitch: 45, bearing: -18 },
  };
  const BB = ["Sun Down Bowl", "Sun Up Bowl", "Tea Cup Bowl", "China Bowl", "Siberia Bowl", "Mongolia Bowl"];
  let map = null, opts = null, markers = [], loaded = false;

  function loadLib() {
    return new Promise((res, rej) => {
      if (window.maplibregl) return res();
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = LIB + ".css"; document.head.append(l);
      const s = document.createElement("script");
      s.src = LIB + ".js"; s.onload = () => res(); s.onerror = () => rej(new Error("No se pudo cargar la librería del mapa"));
      document.head.append(s);
    });
  }
  function webgl() {
    try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; }
  }
  function dark() {
    const t = document.documentElement.getAttribute("data-theme");
    return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  }

  /* Image sources do not drape well over 3D terrain, so the Sentinel-2 pictures are served to the map
     as raster tiles cut on the fly from the single image ("s2img://<name>/{z}/{x}/{y}"). */
  const IMGS = {};
  let protocolOn = false;
  function loadImg(url) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("imagen " + url)); im.src = url; });
  }
  function tileBounds(z, x, y) {
    const n = Math.pow(2, z);
    const lon = (v) => v / n * 360 - 180;
    const lat = (v) => Math.atan(Math.sinh(Math.PI * (1 - 2 * v / n))) * 180 / Math.PI;
    return [lon(x), lat(y + 1), lon(x + 1), lat(y)];     // W S E N
  }
  function addProtocol() {
    if (protocolOn) return;
    protocolOn = true;
    maplibregl.addProtocol("s2img", async (params) => {
      const m = /^s2img:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
      const R = m && IMGS[m[1]];
      const size = 256;
      const cv = document.createElement("canvas"); cv.width = size; cv.height = size;
      if (R) {
        const im = await R.img;
        const [w, s, e, n] = tileBounds(+m[2], +m[3], +m[4]);
        const [W, S, E, N] = R.bounds;
        const iw = im.naturalWidth, ih = im.naturalHeight;
        const px = (lon) => (lon - W) / (E - W) * iw, py = (lat) => (N - lat) / (N - S) * ih;
        let sx0 = px(w), sx1 = px(e), sy0 = py(n), sy1 = py(s);
        const dx = (v) => (v - px(w)) / (px(e) - px(w)) * size, dy = (v) => (v - py(n)) / (py(s) - py(n)) * size;
        const cx0 = Math.max(0, sx0), cx1 = Math.min(iw, sx1), cy0 = Math.max(0, sy0), cy1 = Math.min(ih, sy1);
        if (cx1 > cx0 && cy1 > cy0) {
          const ctx = cv.getContext("2d");
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(im, cx0, cy0, cx1 - cx0, cy1 - cy0, dx(cx0), dy(cy0), dx(cx1) - dx(cx0), dy(cy1) - dy(cy0));
        }
      }
      const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
      return { data: await blob.arrayBuffer() };
    });
  }

  function prepare(geo, st) {
    const P = (st && st.pistes) || {}, Lf = (st && st.lifts) || {};
    const feats = [];
    for (const f of geo.features || []) {
      const p = Object.assign({}, f.properties);
      if (p.kind === "piste") {
        const s = P[p.id];
        p.st = s ? s[0] : -1; p.vn = s ? s[1] : p.name; p.area = s ? s[2] : "";
        p.poly = f.geometry.type.indexOf("Polygon") >= 0 ? 1 : 0;
      } else if (p.kind === "lift") {
        const s = Lf[p.id];
        p.ls = s ? s[0] : "unknown"; p.vn = s ? s[1] : p.name; p.area = s ? s[2] : "";
      } else continue;
      feats.push({ type: "Feature", properties: p, geometry: f.geometry });
    }
    return { type: "FeatureCollection", features: feats };
  }

  function style(o) {
    const d = dark();
    const sources = {
      dem: { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], encoding: "terrarium", tileSize: 256, maxzoom: 14, attribution: "Relieve: AWS Terrain Tiles" },
      hs: { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], encoding: "terrarium", tileSize: 256, maxzoom: 14 },
      aerial: { type: "raster", tiles: ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 16, attribution: "Foto aérea: USGS" },
      runs: { type: "geojson", data: o.runs, attribution: "© colaboradores de OpenStreetMap" },
    };
    const layers = [
      { id: "bg", type: "background", paint: { "background-color": d ? "#0d151f" : "#e8edf3" } },
      { id: "hillshade", type: "hillshade", source: "hs", paint: { "hillshade-exaggeration": 0.55, "hillshade-shadow-color": d ? "#000000" : "#5d6b7e", "hillshade-highlight-color": d ? "#3a4a5e" : "#ffffff", "hillshade-accent-color": d ? "#1b2735" : "#93a1b3" } },
      { id: "aerial", type: "raster", source: "aerial", layout: { visibility: "none" }, paint: { "raster-opacity": 0.95 } },
    ];
    if (o.sat) {
      const c = o.sat.coordinates, bounds = [c[0][0], c[2][1], c[1][0], c[0][1]];
      IMGS.true = { img: loadImg(o.sat.true), bounds };
      IMGS.snow = { img: loadImg(o.sat.snow), bounds };
      sources.s2 = { type: "raster", tiles: ["s2img://true/{z}/{x}/{y}"], tileSize: 256, bounds, minzoom: 8, maxzoom: 16 };
      sources.snow = { type: "raster", tiles: ["s2img://snow/{z}/{x}/{y}"], tileSize: 256, bounds, minzoom: 8, maxzoom: 15 };
      layers.push({ id: "s2", type: "raster", source: "s2", paint: { "raster-opacity": 1, "raster-fade-duration": 0 } });
      layers.push({ id: "snow", type: "raster", source: "snow", layout: { visibility: "none" }, paint: { "raster-opacity": 0.9, "raster-fade-duration": 0 } });
    }
    const runFilter = (st) => ["all", ["==", ["get", "kind"], "piste"], ["==", ["get", "poly"], 0], st];
    layers.push(
      { id: "piste-area", type: "fill", source: "runs", filter: ["all", ["==", ["get", "kind"], "piste"], ["==", ["get", "poly"], 1]],
        paint: { "fill-color": ["case", ["==", ["get", "st"], 1], "#2fd65a", "#ffffff"], "fill-opacity": ["case", ["==", ["get", "st"], 1], 0.28, 0.07] } },
      { id: "runs-closed", type: "line", source: "runs", filter: runFilter(["!=", ["get", "st"], 1]), layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": d ? "rgba(225,232,240,.55)" : "rgba(255,255,255,.75)", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 14, 1.6], "line-dasharray": [2, 1.5] } },
      { id: "runs-open-casing", type: "line", source: "runs", filter: runFilter(["==", ["get", "st"], 1]), layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#06310f", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 3, 14, 6.5], "line-opacity": 0.75 } },
      { id: "runs-open", type: "line", source: "runs", filter: runFilter(["==", ["get", "st"], 1]), layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#35e05f", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.6, 14, 3.6] } },
      { id: "lifts-closed", type: "line", source: "runs", filter: ["all", ["==", ["get", "kind"], "lift"], ["!=", ["get", "ls"], "open"]],
        paint: { "line-color": d ? "#9aa7b8" : "#3b4656", "line-width": 1.4, "line-dasharray": [3, 2] } },
      { id: "lifts-open-casing", type: "line", source: "runs", filter: ["all", ["==", ["get", "kind"], "lift"], ["==", ["get", "ls"], "open"]],
        paint: { "line-color": "#1a1200", "line-width": 4.6, "line-opacity": 0.8 } },
      { id: "lifts-open", type: "line", source: "runs", filter: ["all", ["==", ["get", "kind"], "lift"], ["==", ["get", "ls"], "open"]],
        paint: { "line-color": "#ffd23f", "line-width": 2.4 } }
    );
    return { version: 8, sources, layers };
  }

  function addMarkers() {
    markers.forEach((m) => m.remove()); markers = [];
    for (const a of opts.areas || []) {
      const p = a.properties, c = a.center;
      if (!c) continue;
      const el = document.createElement("button");
      el.type = "button";
      el.className = "mlabel" + (BB.indexOf(p.name) >= 0 ? " bb" : "") + (p.open > 0 ? " open" : "");
      el.innerHTML = "<b></b><span></span>";
      el.querySelector("b").textContent = p.name.replace(" Bowl", "").replace("Blue Sky Basin", "Blue Sky");
      el.querySelector("span").textContent = p.open + "/" + p.total;
      el.setAttribute("aria-label", p.name + ": " + p.open + " de " + p.total + " pistas abiertas");
      el.addEventListener("click", (e) => { e.stopPropagation(); opts.onArea && opts.onArea(p.name); });
      markers.push(new maplibregl.Marker({ element: el, anchor: "center", opacity: "1", opacityWhenCovered: "0.85" }).setLngLat(c).addTo(map));
    }
  }

  function popupFor(f) {
    const p = f.properties;
    const box = document.createElement("div");
    box.className = "mpop";
    const t = document.createElement("b"); t.textContent = p.vn || p.name || "Sin nombre"; box.append(t);
    const s = document.createElement("div");
    if (p.kind === "lift") s.textContent = (p.ls === "open" ? "● Abierta" : p.ls === "unknown" ? "Sin dato" : "Cerrada") + (p.area ? " · " + p.area : "");
    else s.textContent = (p.st === 1 ? "● Abierta" : p.st === 0 ? "Cerrada" : "Sin dato de Vail") + (p.area ? " · " + p.area : "");
    if (p.kind === "lift" ? p.ls === "open" : p.st === 1) s.className = "ok";
    box.append(s);
    return box;
  }

  async function init(host, o) {
    opts = o;
    if (!webgl()) throw new Error("Este dispositivo no tiene WebGL");
    await loadLib();
    addProtocol();
    if (map) { map.remove(); map = null; }
    loaded = false;
    map = new maplibregl.Map({
      container: host, style: style(o), center: VIEWS.bowls.center, zoom: VIEWS.bowls.zoom, pitch: VIEWS.bowls.pitch, bearing: VIEWS.bowls.bearing,
      maxPitch: 78, attributionControl: false, cooperativeGestures: true, fadeDuration: 0,
      maxBounds: [[-106.62, 39.47], [-106.08, 39.76]],
      locale: { "CooperativeGesturesHandler.MobileHelpText": "Usa dos dedos para mover el mapa",
                "CooperativeGesturesHandler.WindowsHelpText": "Usa Ctrl + rueda para acercar", "CooperativeGesturesHandler.MacHelpText": "Usa ⌘ + rueda para acercar" },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: o.sat ? "Imagen: Sentinel-2, Copernicus (" + o.sat.date + ")" : "" }), "bottom-right");
    map.once("render", () => { const m = document.getElementById("mapmsg"); if (m) m.remove(); });
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error("El mapa tardó demasiado en cargar")), 25000);
      let done = false;
      const ready = () => {
        if (done) return;
        done = true;
        clearTimeout(to);
        try { map.setTerrain({ source: "dem", exaggeration: 1.35 }); } catch (e) { /* 2D fallback */ }
        try { if (map.setSky) map.setSky({ "sky-color": dark() ? "#0b1622" : "#b9d4ef", "horizon-color": dark() ? "#1c2b3c" : "#eef4fa", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.7, "fog-color": dark() ? "#0d151f" : "#e8edf3", "fog-ground-blend": 0.25 }); } catch (e) { /* older lib */ }
        addMarkers();
        const at = host.querySelector(".maplibregl-ctrl-attrib");
        if (at) at.classList.remove("maplibregl-compact-show");
        const layersHit = ["runs-open", "runs-closed", "lifts-open", "lifts-closed", "piste-area"];
        map.on("click", (e) => {
          const pad = 12, b = [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]];
          const fs = map.queryRenderedFeatures(b, { layers: layersHit.filter((l) => map.getLayer(l)) });
          if (!fs.length) return;
          const best = fs.find((f) => f.layer.id.indexOf("open") >= 0) || fs[0];
          new maplibregl.Popup({ closeButton: false, maxWidth: "240px", offset: 8 }).setLngLat(e.lngLat).setDOMContent(popupFor(best)).addTo(map);
        });
        loaded = true;
        res(map);
      };
      if (map.isStyleLoaded()) ready(); else map.once("style.load", ready);
      map.once("load", ready);
      let demErr = 0;
      map.on("error", (e) => {
        if (e && (e.sourceId === "dem" || e.sourceId === "hs")) {          // relief tiles unreachable: go flat instead of a broken 3D view
          demErr++;
          if (demErr === 4) {
            try { map.setTerrain(null); } catch (x) { /* ignore */ }
            if (map.getLayer("hillshade")) map.setLayoutProperty("hillshade", "visibility", "none");
            opts.onNoTerrain && opts.onNoTerrain();
          }
          return;
        }
        if (!loaded && e && e.error && /style|WebGL/i.test(String(e.error.message))) { clearTimeout(to); rej(e.error); }
      });
    });
  }

  function setView(name) {
    if (!map) return;
    const v = VIEWS[name] || VIEWS.bowls;
    map.flyTo(Object.assign({ duration: 1600, essential: true }, v));
  }
  function flyToArea(center) {
    if (!map || !center) return;
    map.flyTo({ center, zoom: 13.9, pitch: 62, duration: 1400, essential: true });
  }
  function setLayer(id, on) {
    if (!map) return;
    if (id === "terrain") {
      try { map.setTerrain(on ? { source: "dem", exaggeration: 1.35 } : null); } catch (e) { /* ignore */ }
      map.easeTo({ pitch: on ? 60 : 0, duration: 800 });
      return;
    }
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  }
  function resize() { if (map) map.resize(); }

  window.Map3D = { init, setView, setLayer, flyToArea, resize, prepare, VIEWS };
})();

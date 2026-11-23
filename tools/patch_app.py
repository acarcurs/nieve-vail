import re, sys
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

# ---------- globals ----------
rep('let S = null, L = null, M = null;   // static, live, model results',
    'let S = null, L = null, M = null;   // static, live, model results\nlet INS = null, SAT = null, CM = null, MAPST = null, OSMGEO = null, STATUS = null;   // insights, satellite, trained Cumbre, map status')

# ---------- simulate: use Cumbre deciles ----------
rep('const B0 = new Float64Array(N), B1 = new Float64Array(N), K = new Int32Array(N), FM = new Float64Array(N);',
    'const B0 = new Float64Array(N), B1 = new Float64Array(N), K = new Int32Array(N), FM = new Float64Array(N), FM2 = new Float64Array(N);')
rep('    FM[i] = Math.exp(-sig * sig / 2 + sig * gauss());\n',
    '    FM[i] = Math.exp(-sig * sig / 2 + sig * gauss());\n    FM2[i] = Math.exp(-0.03125 + 0.25 * gauss());     // shared error along a path (storms are correlated)\n')
rep('      if (c && c.kind === "det") g = c.mean * FM[i]',
    '      if (c && c.qs && c.qs.length === 11 && (c.kind === "det" || c.kind === "ens")){ const u = rnd() * 10, j = Math.min(9, Math.floor(u)); g = (c.qs[j] + (c.qs[j + 1] - c.qs[j]) * (u - j)) * FM2[i] / slr; }   // Cumbre distribution (deciles)\n      else if (c && c.kind === "det") g = c.mean * FM[i]')

# ---------- texts ----------
rep('" El pronóstico Cumbre trae ≈ " + len(t15.m) + " en los próximos 15 días ("', '" El pronóstico Cumbre trae ≈ " + len(t15.m) + " en los próximos " + cdays.length + " días ("')
rep('los primeros 15 días usan el pronóstico Cumbre con su rango de error', 'los primeros 16 días usan la distribución del pronóstico Cumbre')
rep('el("li", null, "Pronóstico: NWS Grand Junction, snow-forecast.com, OpenSnow."),',
    'el("li", null, "Pronóstico: Vail, NWS, 9 modelos y 3 ensambles vía ", el("a", { href: "https://open-meteo.com", target: "_blank", rel: "noopener" }, "Open-Meteo"), " (CC BY 4.0)."),')
rep('el("li", null, "Satélite: Sentinel-2 (Copernicus / Element 84), NASA Worldview."),',
    'el("li", null, "Satélite: Sentinel-2 (Copernicus, vía Element 84). Mapa: OpenStreetMap, AWS Terrain Tiles."),')
rep('if (cd.length) for (const n of [5, 10, 15]) tiles.push', 'if (cd.length) for (const n of [5, 10, 16]) tiles.push')
rep('"Probabilidad de nevada de " + (lo === hi ? lo : lo + " a " + hi) + "% por día. Las cantidades todavía no se pueden pronosticar; la barra usa la nevada típica de esas fechas."',
    '"Probabilidad de nevada de " + (lo === hi ? lo : lo + " a " + hi) + "% por día según los ensambles. Todavía no hay cantidades confiables: la barra es el promedio de sus escenarios."')

open(p, "w").write(s)
print("stage1 ok")

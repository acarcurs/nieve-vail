/* Spanish rendering of NWS point-forecast text (templated phrases), with unit conversion. */
(function () {
  "use strict";
  const DIRS = { N: "norte", NNE: "norte-noreste", NE: "noreste", ENE: "este-noreste", E: "este", ESE: "este-sureste", SE: "sureste", SSE: "sur-sureste",
    S: "sur", SSW: "sur-suroeste", SW: "suroeste", WSW: "oeste-suroeste", W: "oeste", WNW: "oeste-noroeste", NW: "noroeste", NNW: "norte-noroeste" };
  const WORD_DIR = { "north": "N", "north northeast": "NNE", "northeast": "NE", "east northeast": "ENE", "east": "E", "east southeast": "ESE", "southeast": "SE", "south southeast": "SSE",
    "south": "S", "south southwest": "SSW", "southwest": "SW", "west southwest": "WSW", "west": "W", "west northwest": "WNW", "northwest": "NW", "north northwest": "NNW" };
  const DAYS = { Monday: "Lunes", Tuesday: "Martes", Wednesday: "Miércoles", Thursday: "Jueves", Friday: "Viernes", Saturday: "Sábado", Sunday: "Domingo" };
  const SKY = [
    [/^Mostly sunny/i, "Mayormente soleado"], [/^Partly sunny/i, "Parcialmente soleado"], [/^Sunny/i, "Soleado"], [/^Mostly clear/i, "Mayormente despejado"],
    [/^Partly cloudy/i, "Parcialmente nublado"], [/^Mostly cloudy/i, "Mayormente nublado"], [/^Cloudy/i, "Nublado"], [/^Clear/i, "Despejado"],
    [/^Increasing clouds/i, "Nubosidad en aumento"], [/^Decreasing clouds/i, "Nubosidad en disminución"], [/^Becoming sunny/i, "Volviéndose soleado"],
    [/^Becoming mostly cloudy/i, "Volviéndose mayormente nublado"], [/^Becoming mostly sunny/i, "Volviéndose mayormente soleado"], [/^Becoming partly cloudy/i, "Volviéndose parcialmente nublado"],
    [/^Patchy fog/i, "Niebla en partes"], [/^Areas of fog/i, "Áreas de niebla"], [/^Breezy/i, "Con brisa"], [/^Windy/i, "Ventoso"], [/^Blustery/i, "Ventoso y frío"],
  ];
  const WX = { "snow showers": "chubascos de nieve", "snow": "nieve", "rain and snow showers": "chubascos de lluvia y nieve", "rain and snow": "lluvia y nieve", "rain showers": "chubascos de lluvia",
    "rain": "lluvia", "flurries": "copos aislados", "freezing drizzle": "llovizna helada", "drizzle": "llovizna", "thunderstorms": "tormentas eléctricas", "blowing snow": "ventisca",
    "showers and thunderstorms": "chubascos y tormentas", "snow showers and blowing snow": "chubascos de nieve y ventisca" };
  const metric = () => (window.UNITS_NOW ? window.UNITS_NOW() : "metric") === "metric";
  const tF = (f) => metric() ? Math.round((f - 32) * 5 / 9) + " °C" : f + " °F";
  const mph = (v) => metric() ? Math.round(v * 1.609) + " km/h" : v + " mph";
  const inch = (v) => metric() ? (Math.round(v * 2.54 * 10) / 10).toLocaleString("es-MX") + " cm" : v + (v === 1 ? " pulgada" : " pulgadas");
  const hour = (h) => {
    const m = /^(\d{1,2})(am|pm)$/i.exec(h); if (!m) return h;
    const n = +m[1]; return (n === 1 ? "la " : "las ") + n + " " + m[2].toLowerCase().replace("am", "a. m.").replace("pm", "p. m.");
  };
  const NUMW = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5 };
  function wx(phrase) {
    const k = phrase.toLowerCase().trim();
    return WX[k] || null;
  }
  function sentence(s) {
    s = s.trim().replace(/\.$/, "");
    let m;
    const SKYL = { "sunny": "soleado", "mostly sunny": "mayormente soleado", "partly sunny": "parcialmente soleado", "mostly clear": "mayormente despejado", "clear": "despejado",
      "partly cloudy": "parcialmente nublado", "mostly cloudy": "mayormente nublado", "cloudy": "nublado" };
    for (const [re, es] of SKY) if (re.test(s)) {
      let rest = s.replace(re, "");
      rest = rest.replace(/,?\s*then (?:gradually )?becoming ([a-z ]+?)(?=,|$)/i, (_, x) => ", luego " + (SKYL[x.toLowerCase().trim()] || x))
        .replace(/,?\s*with a high near (-?\d+)/i, (_, t) => ", máxima cerca de " + tF(+t))
        .replace(/,?\s*with a low around (-?\d+)/i, (_, t) => ", mínima cerca de " + tF(+t))
        .replace(/,?\s*with a steady temperature around (-?\d+)/i, (_, t) => ", temperatura estable cerca de " + tF(+t))
        .replace(/,?\s*with an? (\w+(?: \w+)?) wind (\d+) to (\d+) mph(?:, with gusts as high as (\d+) mph)?/i, (_, d, a1, a2, g) => { const k = WORD_DIR[d.toLowerCase()]; return ", viento del " + (k ? DIRS[k] : d) + " de " + mph(+a1).replace(/ (km\/h|mph)$/, "") + " a " + mph(+a2) + (g ? ", rachas de hasta " + mph(+g) : ""); });
      if (!/[a-z]{3,}/i.test(rest.replace(/máxima|mínima|cerca|luego|viento|rachas|hasta|temperatura|estable|soleado|nublado|despejado|mayormente|parcialmente|del|norte|sur|este|oeste|noreste|noroeste|sureste|suroeste|°C|°F|km\/h|mph/g, ""))) return es + rest;
    }
    if ((m = /^High near (-?\d+)$/i.exec(s))) return "Máxima cerca de " + tF(+m[1]);
    if ((m = /^Low around (-?\d+)$/i.exec(s))) return "Mínima cerca de " + tF(+m[1]);
    if ((m = /^(\w+(?: \w+)?) wind (?:around (\d+)|(\d+) to (\d+)) mph(?:, with gusts as high as (\d+) mph)?$/i.exec(s))) {
      const d = WORD_DIR[m[1].toLowerCase()], dir = d ? "del " + DIRS[d] : m[1];
      return "Viento " + dir + " " + (m[2] ? "de unos " + mph(+m[2]) : "de " + mph(+m[3]).replace(/ (km\/h|mph)$/, "") + " a " + mph(+m[4])) + (m[5] ? ", rachas de hasta " + mph(+m[5]) : "");
    }
    if ((m = /^Calm wind becoming (\w+(?: \w+)?) (?:around (\d+)|(\d+) to (\d+)) mph/i.exec(s))) {
      const d = WORD_DIR[m[1].toLowerCase()];
      return "Viento en calma, luego del " + (d ? DIRS[d] : m[1]) + " " + (m[2] ? "de unos " + mph(+m[2]) : "de " + mph(+m[3]).replace(/ (km\/h|mph)$/, "") + " a " + mph(+m[4]));
    }
    if ((m = /^Chance of precipitation is (\d+)%$/i.exec(s))) return "Probabilidad de precipitación: " + m[1] + "%";
    if ((m = /^New snow accumulation of (less than (?:one|a half) inch|around (?:one|an) inch|(\d+) to (\d+) inches|around (\d+) inches)(?: possible)?$/i.exec(s))) {
      let a;
      if (/less than a half/i.test(m[1])) a = "menos de " + inch(0.5);
      else if (/less than one/i.test(m[1])) a = "menos de " + inch(1);
      else if (/around (one|an) inch/i.test(m[1])) a = "cerca de " + inch(1);
      else if (m[2]) a = metric() ? Math.round(m[2] * 2.54) + " a " + Math.round(m[3] * 2.54) + " cm" : m[2] + " a " + m[3] + " pulgadas";
      else a = "cerca de " + inch(+m[4]);
      return "Nieve nueva posible: " + a;
    }
    if ((m = /^Total daytime snow accumulation of (.+?) possible$/i.exec(s)) || (m = /^Total nighttime snow accumulation of (.+?) possible$/i.exec(s))) return "Acumulación total posible: " + m[1].replace(/(\d+) to (\d+) inches/, (_, a, b) => metric() ? Math.round(a * 2.54) + " a " + Math.round(b * 2.54) + " cm" : a + " a " + b + " pulgadas");
    // "Snow showers likely after 1pm", "A chance of snow showers before 5am", "A slight chance of snow"
    if ((m = /^(?:(A slight chance of|A chance of|Chance)\s+)?(.+?)(?:\s+(likely))?(?:\s+(after|before|mainly after|mainly before)\s+(\d{1,2}(?:am|pm)))?$/i.exec(s))) {
      const w = wx(m[2]);
      if (w) {
        let out = m[1] ? (/slight/i.test(m[1]) ? "Ligera posibilidad de " : "Posibles ") + w : m[3] ? "Probables " + w : w.charAt(0).toUpperCase() + w.slice(1);
        if (m[1] && /slight/i.test(m[1])) out = "Ligera posibilidad de " + w;
        if (m[4]) out += (/after/i.test(m[4]) ? " después de " : " antes de ") + hour(m[5]);
        return out;
      }
    }
    return null;
  }
  function translate(text) {
    if (!text) return text;
    const parts = text.split(/(?<=\.)\s+/);
    const out = parts.map((p) => sentence(p));
    if (out.filter((x) => x == null).length > parts.length / 2) return null;   // mostly unknown: keep English
    return out.map((x, i) => { const t = x == null ? parts[i] : x; return /\.$/.test(t) ? t : t + "."; }).join(" ");
  }
  function periodName(n) {
    if (!n) return n;
    const map = { "Tonight": "Esta noche", "This Afternoon": "Esta tarde", "This Morning": "Esta mañana", "Today": "Hoy", "Overnight": "Madrugada", "Late Afternoon": "Al final de la tarde",
      "Thanksgiving Day": "Día de Acción de Gracias", "Christmas Day": "Navidad", "Christmas Eve": "Nochebuena", "New Year's Day": "Año Nuevo", "New Year's Eve": "Fin de año" };
    if (map[n]) return map[n];
    const m = /^(\w+) Night$/.exec(n);
    if (m) return (DAYS[m[1]] || map[m[1] + " Day"] || m[1]) + " en la noche";
    return DAYS[n] || n;
  }
  window.NwsEs = { translate, periodName };
})();

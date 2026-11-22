"""US National Weather Service (api.weather.gov): gridpoint snowfall, text forecast and forecast discussion."""
import datetime as dt
import re

from common import LAT, LON, TZ, get

H = {"Accept": "application/geo+json"}


def _dur_hours(s):
    m = re.fullmatch(r"P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?", s)
    if not m:
        return 1
    d, h, mi = (int(x) if x else 0 for x in m.groups())
    return max(1, d * 24 + h + (1 if mi else 0))


def _hourly(values, scale=1.0, spread=True):
    """NWS grid values -> {local datetime hour: value}. spread=True divides amounts across the interval."""
    out = {}
    for v in values or []:
        if v.get("value") is None:
            continue
        start_s, dur_s = v["validTime"].split("/")
        start = dt.datetime.fromisoformat(start_s)
        n = _dur_hours(dur_s)
        per = v["value"] * scale / (n if spread else 1)
        for i in range(n):
            t = (start + dt.timedelta(hours=i)).astimezone(TZ)
            out[t] = per
    return out


def fetch():
    pt = get(f"https://api.weather.gov/points/{LAT:.4f},{LON:.4f}", headers=H)["properties"]
    office, gx, gy = pt["gridId"], pt["gridX"], pt["gridY"]
    res = dict(office=office, grid=[gx, gy], url=f"https://forecast.weather.gov/MapClick.php?lat={LAT}&lon={LON}")
    # quantitative grid
    g = get(pt["forecastGridData"], headers=H)["properties"]
    elev = (g.get("elevation") or {}).get("value")
    res["elevation_m"] = elev
    snow = _hourly((g.get("snowfallAmount") or {}).get("values"), scale=1 / 25.4)          # mm -> in
    qpf = _hourly((g.get("quantitativePrecipitation") or {}).get("values"), scale=1 / 25.4)
    pop = _hourly((g.get("probabilityOfPrecipitation") or {}).get("values"), spread=False)
    temp = _hourly((g.get("temperature") or {}).get("values"), spread=False)
    days = {}
    for t, v in snow.items():
        d = t.date().isoformat()
        days.setdefault(d, dict(snow=0.0, qpf=0.0, pop=0, tmin=None, tmax=None))["snow"] += v
    for t, v in qpf.items():
        d = t.date().isoformat()
        days.setdefault(d, dict(snow=0.0, qpf=0.0, pop=0, tmin=None, tmax=None))["qpf"] += v
    for t, v in pop.items():
        d = t.date().isoformat()
        if d in days:
            days[d]["pop"] = max(days[d]["pop"], int(v))
    for t, v in temp.items():
        d = t.date().isoformat()
        if d in days:
            D = days[d]
            D["tmin"] = v if D["tmin"] is None else min(D["tmin"], v)
            D["tmax"] = v if D["tmax"] is None else max(D["tmax"], v)
    res["daily"] = {d: dict(snow=round(D["snow"], 2), qpf=round(D["qpf"], 2), pop=D["pop"],
                            tmin=None if D["tmin"] is None else round(D["tmin"], 1),
                            tmax=None if D["tmax"] is None else round(D["tmax"], 1)) for d, D in sorted(days.items())}
    # text forecast (English; the Spanish version is written by the twice-daily Claude task)
    try:
        fc = get(pt["forecast"], headers=H)["properties"]
        res["issued"] = fc.get("updateTime") or fc.get("generatedAt")
        res["periods"] = [dict(name=p["name"], start=p["startTime"], short=p.get("shortForecast"),
                               text=p.get("detailedForecast"), temp=p.get("temperature"),
                               pop=(p.get("probabilityOfPrecipitation") or {}).get("value"))
                          for p in fc.get("periods", [])]
    except Exception as e:  # noqa: BLE001
        res["periods_error"] = str(e)[:200]
    return res


def fetch_afd(office="GJT"):
    lst = get(f"https://api.weather.gov/products/types/AFD/locations/{office}", headers={"Accept": "application/ld+json"})
    items = lst.get("@graph") or []
    if not items:
        raise RuntimeError("AFD: empty list")
    p = get(items[0]["@id"], headers={"Accept": "application/ld+json"})
    text = p.get("productText") or ""
    sections = {}
    for m in re.finditer(r"^\.(KEY MESSAGES|SHORT TERM|LONG TERM|AVIATION|DISCUSSION|SYNOPSIS)[^\n]*\n(.*?)(?=^\.[A-Z ]+\.{3}|^&&|\Z)",
                         text, flags=re.S | re.M):
        sections[m.group(1).title()] = re.sub(r"\s+\n", "\n", m.group(2)).strip()[:4000]
    return dict(office=office, issued=p.get("issuanceTime"), id=items[0].get("id"),
                url=f"https://forecast.weather.gov/product.php?site={office}&issuedby={office}&product=AFD&format=txt&version=1&glossary=0",
                sections=sections)

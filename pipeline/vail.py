"""Vail lift/trail status, snow report and Vail's own 5-day forecast.

Source: the public ski-run-scraper dataset (github.com/jacobschulman/ski-run-scraper),
which archives Vail Resorts' terrain and snow-report feeds once or more per day."""
import concurrent.futures as cf
import datetime as dt

from common import get

RAW = "https://raw.githubusercontent.com/jacobschulman/ski-run-scraper/main/data/vail"
BB_AREAS = ["Sun Down Bowl", "Sun Up Bowl", "Tea Cup Bowl", "China Bowl", "Siberia Bowl", "Mongolia Bowl"]


def _json(url):
    try:
        return get(url, kind="json", timeout=40, tries=2)
    except Exception:  # noqa: BLE001
        return None


def season_start(today):
    y = today.year if today.month >= 7 else today.year - 1
    return dt.date(y, 10, 1)


def summarize_terrain(t):
    areas = []
    for a in t.get("GroomingAreas", []):
        if not a.get("Trails") and not a.get("Lifts"):
            continue
        trails = [dict(n=x.get("Name"), d=x.get("Difficulty"), o=bool(x.get("IsOpen")), g=bool(x.get("IsGroomed")))
                  for x in a.get("Trails", [])]
        areas.append(dict(name=a.get("Name"), trails=trails,
                          open=sum(1 for x in trails if x["o"]), total=len(trails)))
    lifts = [dict(n=l.get("Name"), s=l.get("Status"), area=l.get("Mountain"), type=l.get("Type"),
                  open_time=l.get("OpenTime"), close_time=l.get("CloseTime")) for l in t.get("Lifts", [])]
    bb = [a for a in areas if a["name"] in BB_AREAS]
    return dict(areas=areas, lifts=lifts,
                trails_open=sum(a["open"] for a in areas), trails_total=sum(a["total"] for a in areas),
                lifts_open=sum(1 for l in lifts if (l["s"] or "").lower() == "open"), lifts_total=len(lifts),
                bb_trails_open=sum(a["open"] for a in bb), bb_trails_total=sum(a["total"] for a in bb),
                bb_open_list=[f'{a["name"]}: {x["n"]}' for a in bb for x in a["trails"] if x["o"]],
                source_updated=t.get("sourceLastUpdated") or t.get("Date"))


def summarize_snow(s):
    sf = s.get("snowfall", {}) or {}
    fc = []
    names = ["Vail base", "Vail cima", "Lionshead base", "Lionshead cima"]
    for i, loc in enumerate((s.get("forecast") or {}).get("locations", [])):
        days = []
        for d in loc.get("forecast_days", []):
            days.append(dict(date=(d.get("date") or "")[:10], hi=d.get("high_f"), lo=d.get("low_f"), desc=d.get("description"),
                             snow_day=d.get("snowfall_day_inches"), snow_night=d.get("snowfall_night_inches")))
        fc.append(dict(name=names[i] if i < len(names) else f"Ubicación {i + 1}", days=days))
    return dict(updated_text=s.get("lastUpdated"), conditions=s.get("conditions"),
                overnight=sf.get("overnight_inches"), h24=sf.get("24hour_inches"), h48=sf.get("48hour_inches"),
                d7=sf.get("7day_inches"), season_total=sf.get("season_total_inches"),
                base=(s.get("baseDepth") or {}).get("inches"), forecast=fc)


def fetch(prev, today):
    """Returns dict(latest_date, terrain, report, history_vail)."""
    idx = _json(f"{RAW}/terrain/index.json") or {}
    files = sorted(idx.get("files", []))
    start = season_start(today)
    season_days = [d for d in files if d >= start.isoformat()]
    latest = season_days[-1] if season_days else (files[-1] if files else None)
    hist = {h["date"]: h for h in (prev.get("history_vail") or []) if h.get("date", "") >= start.isoformat()}
    recent = set(season_days[-2:])
    need = [d for d in season_days if d not in hist or d in recent]

    def get_day(d):
        t = _json(f"{RAW}/terrain/{d}.json")
        s = _json(f"{RAW}/snow/{d}.json")
        row = dict(date=d)
        if t:
            st = summarize_terrain(t)
            row.update(trails_open=st["trails_open"], lifts_open=st["lifts_open"], bb_trails_open=st["bb_trails_open"])
        if s:
            ss = summarize_snow(s)
            row.update(base=ss["base"], season_total=ss["season_total"], h24=ss["h24"])
        return d, row, t, s

    latest_t = latest_s = None
    with cf.ThreadPoolExecutor(6) as ex:
        for d, row, t, s in ex.map(get_day, need):
            hist[d] = {**hist.get(d, {}), **row}
            if d == latest:
                latest_t, latest_s = t, s
    if latest and latest_t is None:
        latest_t = _json(f"{RAW}/terrain/{latest}.json")
        latest_s = _json(f"{RAW}/snow/{latest}.json")
    return dict(latest_date=latest,
                terrain=summarize_terrain(latest_t) if latest_t else None,
                report=summarize_snow(latest_s) if latest_s else None,
                history_vail=[hist[k] for k in sorted(hist)])


def vail_forecast_days(report):
    """Vail's own summit forecast: {date: inches (day + night)}."""
    out = {}
    for loc in (report or {}).get("forecast", []):
        if loc["name"] == "Vail cima":
            for d in loc["days"]:
                if d.get("date"):
                    out[d["date"]] = float((d.get("snow_day") or 0) + (d.get("snow_night") or 0))
    return out

"""Shared helpers for the Nieve Vail data pipeline (runs in GitHub Actions)."""
import datetime as dt
import json
import os
import time
from zoneinfo import ZoneInfo

import requests

TZ = ZoneInfo("America/Denver")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

# Upper mountain point used for every forecast (Back Bowls ridge, ~3,390 m / 11,120 ft)
LAT, LON, ELEV_M = 39.6064, -106.3550, 3390
# Area of interest for maps and satellite (lon/lat)
BBOX = (-106.43, 39.565, -106.29, 39.665)

UA = "nieve-vail/2.0 (personal snow app; https://github.com/acarcurs/nieve-vail)"
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": UA, "Accept-Encoding": "gzip"})


def today_local():
    return dt.datetime.now(TZ).date()


def now_utc_iso():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get(url, params=None, kind="json", timeout=60, tries=3, headers=None):
    """GET with retries. kind: json | text | bytes."""
    last = None
    for i in range(tries):
        try:
            r = SESSION.get(url, params=params, timeout=timeout, headers=headers or {})
            if r.status_code == 429 or r.status_code >= 500:
                last = RuntimeError(f"HTTP {r.status_code} {url}")
                time.sleep(2 + 4 * i)
                continue
            r.raise_for_status()
            if kind == "json":
                return r.json()
            if kind == "text":
                return r.text
            return r.content
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1 + 2 * i)
    raise last


def post_json(url, body, timeout=60, tries=3):
    last = None
    for i in range(tries):
        try:
            r = SESSION.post(url, json=body, timeout=timeout)
            if r.status_code >= 500 or r.status_code == 429:
                last = RuntimeError(f"HTTP {r.status_code} {url}")
                time.sleep(2 + 4 * i)
                continue
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1 + 2 * i)
    raise last


def load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return default


def save_json(path, obj, indent=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=indent, separators=None if indent else (",", ":"))
    os.replace(tmp, path)


def slr(t):
    """Snow-to-liquid ratio for the upper mountain from air temperature (deg C).
    Colorado powder is light: colder air -> fluffier snow. 0 means rain."""
    if t is None:
        return 13.0
    if t >= 1.0:
        return 0.0
    if t >= -1.0:
        return 8.0
    if t >= -4.0:
        return 11.0
    if t >= -8.0:
        return 14.0
    if t >= -12.0:
        return 17.0
    return 15.0


def hourly_to_daily(times, precip_mm, temp_c=None, wdir=None):
    """Aggregate an hourly local-time series into local calendar days.
    Returns {date: {mm, snow (inches of snow, temperature-based ratio), tmin, tmax, hours, wdir}}."""
    import math
    days = {}
    for i, t in enumerate(times):
        p = precip_mm[i] if i < len(precip_mm) else None
        if p is None:
            continue
        d = t[:10]
        T = temp_c[i] if temp_c is not None and i < len(temp_c) else None
        D = days.setdefault(d, dict(mm=0.0, snow=0.0, tmin=None, tmax=None, hours=0, wx=0.0, wy=0.0, wet_t=0.0, wet_mm=0.0))
        D["mm"] += p
        D["snow"] += p / 25.4 * slr(T)
        D["hours"] += 1
        if T is not None:
            D["tmin"] = T if D["tmin"] is None else min(D["tmin"], T)
            D["tmax"] = T if D["tmax"] is None else max(D["tmax"], T)
            if p > 0:
                D["wet_t"] += T * p
                D["wet_mm"] += p
        if wdir is not None and i < len(wdir) and wdir[i] is not None and p > 0:
            D["wx"] += p * math.sin(math.radians(wdir[i]))
            D["wy"] += p * math.cos(math.radians(wdir[i]))
    out = {}
    for d, D in days.items():
        wd = (math.degrees(math.atan2(D["wx"], D["wy"])) % 360) if (D["wx"] or D["wy"]) else None
        out[d] = dict(mm=round(D["mm"], 2), snow=round(D["snow"], 2), hours=D["hours"],
                      tmin=None if D["tmin"] is None else round(D["tmin"], 1),
                      tmax=None if D["tmax"] is None else round(D["tmax"], 1),
                      twet=round(D["wet_t"] / D["wet_mm"], 1) if D["wet_mm"] > 0 else None,
                      wdir=None if wd is None else round(wd))
    return out

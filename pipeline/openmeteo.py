"""Weather models through Open-Meteo (open-meteo.com, CC BY 4.0): deterministic runs and ensembles.

Snow is computed from each model's hourly precipitation and temperature at 3,390 m with our own
temperature-based snow ratio (Open-Meteo's built-in snowfall assumes a fixed 7:1 ratio, too wet for Vail)."""
from common import ELEV_M, LAT, LON, get, hourly_to_daily

# (key shown in the app, Open-Meteo model ids to try in order)
MODELS = [
    ("ECMWF", ["ecmwf_ifs025"]),
    ("AIFS", ["ecmwf_aifs025_single", "ecmwf_aifs025"]),
    ("GFS", ["gfs_seamless"]),
    ("HRRR", ["ncep_hrrr_conus", "gfs_hrrr"]),
    ("NBM", ["ncep_nbm_conus"]),
    ("ICON", ["icon_seamless"]),
    ("GEM", ["gem_seamless"]),
    ("UKMO", ["ukmo_seamless"]),
    ("JMA", ["jma_seamless"]),
]
ENSEMBLES = [
    ("ECMWF ENS", ["ecmwf_ifs025"]),
    ("GEFS", ["gfs025", "gfs_seamless"]),
    ("GEM ENS", ["gem_global"]),
]
BASE = dict(latitude=LAT, longitude=LON, elevation=ELEV_M, timezone="America/Denver")


def _model(model_id, days=16):
    p = dict(BASE, hourly="precipitation,temperature_2m,wind_direction_10m,freezing_level_height",
             models=model_id, forecast_days=days, past_days=1)
    j = get("https://api.open-meteo.com/v1/forecast", params=p, timeout=60, tries=2)
    h = j["hourly"]
    def col(name):
        for k in (name, f"{name}_{model_id}"):
            if k in h:
                return h[k]
        return None
    pr, tt = col("precipitation"), col("temperature_2m")
    if pr is None or all(v is None for v in pr):
        raise RuntimeError(f"{model_id}: no precipitation")
    daily = hourly_to_daily(h["time"], pr, tt, col("wind_direction_10m"))
    fl = col("freezing_level_height")
    if fl:
        for i, t in enumerate(h["time"]):
            d = daily.get(t[:10])
            if d is not None and fl[i] is not None and pr[i]:
                d["fl_max"] = max(d.get("fl_max") or 0, round(fl[i]))
    last = max((t[:10] for t, v in zip(h["time"], pr) if v is not None), default=None)
    return dict(id=model_id, daily={d: v for d, v in daily.items() if v["hours"] >= 18 or d == min(daily)}, last=last)


def fetch_models():
    out, errors = {}, {}
    for name, ids in MODELS:
        for mid in ids:
            try:
                out[name] = _model(mid)
                break
            except Exception as e:  # noqa: BLE001
                errors[name] = f"{mid}: {str(e)[:160]}"
        if name in out:
            errors.pop(name, None)
    return out, errors


def _ensemble(model_id, days=16):
    p = dict(BASE, hourly="precipitation,temperature_2m", models=model_id, forecast_days=days)
    j = get("https://ensemble-api.open-meteo.com/v1/ensemble", params=p, timeout=90, tries=2)
    h = j["hourly"]
    times = h["time"]
    members = {}
    for k, v in h.items():
        if not k.startswith("precipitation"):
            continue
        suffix = k[len("precipitation"):]
        members[suffix] = (v, h.get("temperature_2m" + suffix))
    per_day = {}
    for suffix, (pr, tt) in members.items():
        if pr is None or all(x is None for x in pr):
            continue
        dd = hourly_to_daily(times, pr, tt)
        for d, v in dd.items():
            if v["hours"] >= 18:
                per_day.setdefault(d, []).append(v["snow"])
    if not per_day:
        raise RuntimeError(f"{model_id}: no members")
    return dict(id=model_id, members=len(members), daily={d: sorted(v) for d, v in sorted(per_day.items())})


def fetch_ensembles():
    out, errors = {}, {}
    for name, ids in ENSEMBLES:
        for mid in ids:
            try:
                out[name] = _ensemble(mid)
                break
            except Exception as e:  # noqa: BLE001
                errors[name] = f"{mid}: {str(e)[:160]}"
        if name in out:
            errors.pop(name, None)
    return out, errors

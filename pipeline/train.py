"""Train Cumbre on archived forecasts (the PEAKS-style part).

For every weather model and lead time (1-7 days ahead) we download what that model forecast
for Vail's upper mountain over the last seasons (Open-Meteo Previous Runs API) and compare it
with what actually fell:
  - SNOTEL Vail Mountain liquid precipitation, day by day (2023-24 onwards), turned into snow
    with the same temperature-based ratio;
  - scaled to the snow Vail itself reports (24 h snow, 2025-26 and this season), so Cumbre
    forecasts the number you see on Vail's snow report.
Output: data/cumbre_model.json with, per model and lead, a multiplier (bias), the typical error,
and how often the model catches a snowy day."""
import concurrent.futures as cf
import datetime as dt
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, ELEV_M, LAT, LON, get, hourly_to_daily, now_utc_iso, save_json, slr, today_local  # noqa: E402
import snotel  # noqa: E402
from vail import RAW  # noqa: E402

MODELS = [("ECMWF", "ecmwf_ifs025"), ("AIFS", "ecmwf_aifs025_single"), ("GFS", "gfs_seamless"), ("ICON", "icon_seamless"),
          ("GEM", "gem_seamless"), ("UKMO", "ukmo_seamless"), ("JMA", "jma_seamless"), ("NBM", "ncep_nbm_conus"),
          ("HRRR", "ncep_hrrr_conus")]
LEADS = range(0, 8)
ALPHA = 3.0


def seasons(today):
    out = []
    y0 = 2023
    while dt.date(y0, 10, 15) <= today:
        out.append((dt.date(y0, 10, 15), min(dt.date(y0 + 1, 5, 15), today - dt.timedelta(days=2))))
        y0 += 1
    return out


def in_season(d):
    m = int(d[5:7]); day = int(d[8:10])
    return m in (11, 12, 1, 2, 3, 4) or (m == 10 and day >= 15) or (m == 5 and day <= 15)


def prev_runs(model_id, start, end):
    vars_ = ["precipitation", "temperature_2m"] + [f"{v}_previous_day{L}" for L in range(1, 8) for v in ("precipitation", "temperature_2m")]
    p = dict(latitude=LAT, longitude=LON, elevation=ELEV_M, timezone="America/Denver", models=model_id,
             hourly=",".join(vars_), start_date=start.isoformat(), end_date=end.isoformat())
    j = get("https://previous-runs-api.open-meteo.com/v1/forecast", params=p, timeout=180, tries=4)
    h = j["hourly"]
    def col(n):
        for k in (n, f"{n}_{model_id}"):
            if k in h:
                return h[k]
        return None
    out = {}
    for L in LEADS:
        pn = "precipitation" if L == 0 else f"precipitation_previous_day{L}"
        tn = "temperature_2m" if L == 0 else f"temperature_2m_previous_day{L}"
        pr, tt = col(pn), col(tn)
        if pr is None or all(v is None for v in pr):
            continue
        dd = hourly_to_daily(h["time"], pr, tt)
        out[L] = {d: v for d, v in dd.items() if v["hours"] >= 20}
    return out


def fetch_model(name, model_id, today):
    data, errs = {}, []
    import time
    for s, e in seasons(today):
        time.sleep(8)                      # stay under Open-Meteo's free per-minute budget
        try:
            r = prev_runs(model_id, s, e)
        except Exception as ex:  # noqa: BLE001
            errs.append(f"{s.year}: {str(ex)[:120]}")
            continue
        for L, dd in r.items():
            data.setdefault(L, {}).update(dd)
    return name, data, errs


def vail_h24(today):
    """Vail-reported 24 h snow for past seasons from the ski-run-scraper archive: {day D: inches} (report of D+1)."""
    tidx = get(f"{RAW}/terrain/index.json")          # snow files share the terrain file dates
    files = sorted(tidx.get("files", []))
    files = [f for f in files if f >= "2025-10-01" and f < today.isoformat()]

    def one(d):
        try:
            s = get(f"{RAW}/snow/{d}.json", timeout=30, tries=2)
            v = (s.get("snowfall") or {}).get("24hour_inches")
            return d, (None if v is None else float(v))
        except Exception:  # noqa: BLE001
            return d, None
    out = {}
    with cf.ThreadPoolExecutor(8) as ex:
        for d, v in ex.map(one, files):
            if v is not None:
                out[(dt.date.fromisoformat(d) - dt.timedelta(days=1)).isoformat()] = v
    return out


def stats_for(pairs):
    if not pairs:
        return None
    fw = sum(f for f, o in pairs if f >= 0.3)
    ow = sum(o for f, o in pairs if f >= 0.3)
    nw = sum(1 for f, o in pairs if f >= 0.3)
    b = (ow + ALPHA) / (fw + ALPHA)
    b = min(3.0, max(0.4, b))
    corr_vals = [(f * b if f >= 0.3 else f, o) for f, o in pairs]
    mae = sum(abs(c - o) for c, o in corr_vals) / len(pairs)
    mae_raw = sum(abs(f - o) for f, o in pairs) / len(pairs)
    n = len(pairs)
    mf = sum(f for f, _ in pairs) / n; mo = sum(o for _, o in pairs) / n
    sf = math.sqrt(sum((f - mf) ** 2 for f, _ in pairs) / n) or 1e-9
    so = math.sqrt(sum((o - mo) ** 2 for _, o in pairs) / n) or 1e-9
    r = sum((f - mf) * (o - mo) for f, o in pairs) / n / (sf * so)
    hits = sum(1 for f, o in pairs if f >= 1 and o >= 1); miss = sum(1 for f, o in pairs if f < 1 and o >= 1)
    fa = sum(1 for f, o in pairs if f >= 1 and o < 1)
    return dict(b=round(b, 3), mae=round(mae, 3), mae_raw=round(mae_raw, 3), n=n, n_wet=nw, corr=round(r, 3),
                pod=round(hits / (hits + miss), 3) if hits + miss else None,
                far=round(fa / (hits + fa), 3) if hits + fa else None, mean_f=round(mf, 3), mean_o=round(mo, 3))


def main():
    today = today_local()
    end = today - dt.timedelta(days=2)
    print("SNOTEL history…", flush=True)
    sn = snotel.fetch(f"2023-10-01,{(today - dt.timedelta(days=1)).isoformat()}")
    liq = snotel.daily_liquid(sn)
    print(f"  {len(liq)} days of liquid obs", flush=True)
    print("Vail 24 h reports…", flush=True)
    try:
        h24 = vail_h24(today)
    except Exception as e:  # noqa: BLE001
        print("  h24 failed:", e); h24 = {}
    print(f"  {len(h24)} days", flush=True)
    print("Archived model runs…", flush=True)
    models, errors = {}, {}
    with cf.ThreadPoolExecutor(1) as ex:
        for name, data, errs in ex.map(lambda m: fetch_model(m[0], m[1], today), MODELS):
            if data:
                models[name] = data
            if errs:
                errors[name] = errs
            print(f"  {name}: leads {sorted(data)} days {[len(data[L]) for L in sorted(data)]} errors {len(errs)}", flush=True)
    if "ECMWF" not in models and not models:
        raise SystemExit("no model data")
    ref = models.get("ECMWF") or next(iter(models.values()))
    ref0 = ref.get(0) or ref.get(1) or {}
    # observed snow from SNOTEL liquid with the analysis temperature
    obs_snow = {}
    for d, l in liq.items():
        if not in_season(d) or d > end.isoformat():
            continue
        t = (ref0.get(d) or {}).get("twet")
        if t is None:
            t = (ref0.get(d) or {}).get("tmax")
        obs_snow[d] = l * slr(t if t is not None else -6)
    # scale to Vail's report
    both = [(obs_snow[d], h24[d]) for d in h24 if d in obs_snow and (obs_snow[d] > 0 or h24[d] > 0)]
    k_vail = (sum(h for _, h in both) + 5) / (sum(o for o, _ in both) + 5) if both else 1.0
    k_vail = min(2.5, max(0.5, k_vail))
    target = {d: v * k_vail for d, v in obs_snow.items()}
    print(f"k_vail={k_vail:.2f} from {len(both)} days; target days {len(target)}", flush=True)
    # per model, per lead
    out_models = {}
    for name, data in models.items():
        ms = {}
        for L, dd in data.items():
            pairs = [(dd[d]["snow"], target[d]) for d in dd if d in target]
            st = stats_for(pairs)
            if st and st["n"] >= 40:
                ms[str(L)] = st
        if ms:
            out_models[name] = ms
    # how a blend weighted like Cumbre does at each lead. Weights = (1/typical error)^p; p is chosen per lead.
    # Corrections are fitted leaving each season out, so the scores are honest (out-of-sample).
    def season_of(d):
        y, m = int(d[:4]), int(d[5:7])
        return y if m >= 7 else y - 1
    seas = sorted({season_of(d) for d in target})
    oos = {}                       # (name, L, season) -> b fitted on the other seasons
    for name, data in models.items():
        for L, dd in data.items():
            for sy in seas:
                pairs = [(dd[d]["snow"], target[d]) for d in dd if d in target and season_of(d) != sy]
                st = stats_for(pairs)
                if st and st["n"] >= 40:
                    oos[(name, L, sy)] = st["b"]
    blend = {}
    for L in range(1, 8):
        rows = []                  # per day: list of (name, corrected_oos, mae)
        for d in sorted(target):
            vals = []
            for name, data in models.items():
                st = (out_models.get(name) or {}).get(str(L))
                v = (data.get(L) or {}).get(d)
                b = oos.get((name, L, season_of(d)))
                if st and v and b:
                    c = v["snow"] * b if v["snow"] >= 0.3 else v["snow"]
                    vals.append((name, c, st["mae"]))
            if len(vals) >= 2:
                rows.append((d, vals, target[d]))
        if not rows:
            continue
        def mae_for(pw, subset=None):
            err, n = 0.0, 0
            for d, vals, o in rows:
                if subset and not subset(vals):
                    continue
                ws = [(1.0 / max(m, 0.05)) ** pw for _, _, m in vals]
                c = sum(w * x for w, (_, x, _) in zip(ws, vals)) / sum(ws)
                err += abs(c - o); n += 1
            return err / n if n else None, n
        best_p, best_mae = 2, None
        for pw in (0, 1, 2, 3, 4, 6):
            m_, _ = mae_for(pw)
            if best_mae is None or m_ < best_mae - 1e-4:
                best_p, best_mae = pw, m_
        # fair comparison: each model vs the blend on the days that model has
        singles = {}
        for name in out_models:
            sub = [(d, vals, o) for d, vals, o in rows if any(n == name for n, _, _ in vals)]
            if len(sub) < 40:
                continue
            e_m = sum(abs(next(x for n, x, _ in vals if n == name) - o) for d, vals, o in sub) / len(sub)
            e_b, _ = mae_for(best_p, subset=lambda vals, nm=name: any(n == nm for n, _, _ in vals))
            singles[name] = dict(mae=round(e_m, 3), blend=round(e_b, 3), n=len(sub))
        full = {n: v for n, v in singles.items() if v["n"] >= 0.8 * len(rows)}
        best = min(full, key=lambda n: full[n]["mae"]) if full else None
        blend[str(L)] = dict(p=best_p, mae=round(best_mae, 3), n=len(rows), singles=singles,
                             best=best, best_mae=full[best]["mae"] if best else None,
                             gain=round(1 - full[best]["blend"] / full[best]["mae"], 3) if best else None)
    res = dict(trained_at=now_utc_iso(), window=[min(target), max(target)] if target else None, n_days=len(target),
               k_vail=round(k_vail, 3), n_vail_days=len(both),
               obs="SNOTEL Vail Mountain liquid x temperature-based snow ratio, scaled to Vail's 24 h report",
               models=out_models, blend=blend, errors=errors)
    save_json(os.path.join(DATA, "cumbre_model.json"), res, indent=1)
    for L in ("1", "3", "5", "7"):
        if L in blend:
            b_ = blend[L]
            print(f"lead {L}: p={b_['p']} blend MAE {b_['mae']:.2f} in (n={b_['n']}) | best full-period model {b_['best']} {b_['best_mae']} | gain {b_['gain']}", flush=True)
            print("     ", {n: (v['mae'], v['blend'], v['n']) for n, v in b_['singles'].items()}, flush=True)
    for name, ms in out_models.items():
        s1 = ms.get("1") or {}
        print(f"  {name:6s} L1 b={s1.get('b')} mae={s1.get('mae')} r={s1.get('corr')} n={s1.get('n')}", flush=True)


if __name__ == "__main__":
    main()

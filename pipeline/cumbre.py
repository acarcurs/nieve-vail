"""CUMBRE v2: our PEAKS-style 16-day snow forecast for Vail's upper mountain (~3,390 m).

1. Every source becomes inches of new snow per local day on the upper mountain:
   Vail's own summit forecast, the NWS gridpoint forecast, and 9 weather models (Open-Meteo),
   whose liquid precipitation is turned into snow with a temperature-based snow ratio.
2. Each source is corrected with what it historically gets wrong:
   - trained offline (pipeline/train.py) on 2+ seasons of archived model runs vs observations,
     per model and per lead day (multiplicative bias + typical error);
   - learned online from every run against the 24 h snow Vail reports next morning.
3. Sources are blended with weights = 1 / (0.5 + typical error), so the models that do best
   for Vail at that lead time count more.
4. Three ensembles (ECMWF ENS 51, GEFS 31, GEM 21 members) give the spread: probability of snow,
   10-90% ranges and the full distribution used by the Back Bowls simulation. They carry days 11-16.
"""
import datetime as dt
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
_C = json.load(open(os.path.join(HERE, "clim.json")))
CLIM, SEED = _C["clim"], _C["seed"]
ALPHA = 6.0           # prior strength (inches) for online multipliers
N_DAYS = 16
QS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
MAX_LEAD = {"HRRR": 1, "NBM": 10, "ICON": 7, "UKMO": 6, "JMA": 10, "GEM": 9}


def _pct(sorted_vals, p):
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    x = (len(sorted_vals) - 1) * p / 100.0
    lo, hi = int(math.floor(x)), int(math.ceil(x))
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (x - lo)


def learn_online(history_vail, log):
    """Per-source stats from logged lead 1-3 forecasts vs Vail's reported 24 h snow (h24 on D+1 = day D)."""
    obs = {}
    for h in history_vail or []:
        if h.get("h24") is not None:
            obs[(dt.date.fromisoformat(h["date"]) - dt.timedelta(days=1)).isoformat()] = float(h["h24"])
    names = sorted({e["s"] for e in log} | set(SEED))
    stats = {}
    for name in names:
        sd = SEED.get(name, {})
        fw, ow, nw = float(sd.get("fc_wet", 0)), float(sd.get("obs_wet", 0)), int(sd.get("n_wet", 0))
        nd, od = int(sd.get("n_dry", 0)), float(sd.get("obs_dry", 0))
        ae = float(sd.get("mae", 0)) * (nw + nd)
        for e in log:
            if e.get("s") != name or e.get("t") not in obs or not (1 <= e.get("L", 0) <= 3):
                continue
            v, o = float(e["v"]), obs[e["t"]]
            ae += abs(v - o)
            if v >= 1:
                fw += v; ow += o; nw += 1
            else:
                od += o; nd += 1
        n = nw + nd
        b = (ow + ALPHA) / (fw + ALPHA)
        stats[name] = dict(n=n, n_wet=nw, n_dry=nd, fc_wet=round(fw, 1), obs_wet=round(ow, 1), obs_dry=round(od, 1),
                           mae=round(ae / n, 2) if n else None, b=round(min(3.0, max(0.4, b)), 2), seeded=name in SEED)
    v = stats.get("Vail") or {}
    u0 = (v.get("obs_dry", 0) + 0.65 * 10) / (v.get("n_dry", 0) + 10) if v.get("n_dry") else 0.65
    return stats, obs, round(u0, 3)


def _trained(trained, name, lead):
    m = ((trained or {}).get("models") or {}).get(name) or {}
    return m.get(str(min(max(lead, 1), 7)))


def correction(name, lead, online, trained):
    """Multiplier b and typical error (inches) for a source at a lead time."""
    on = online.get(name) or {}
    tr = _trained(trained, name, lead)
    b_on, n_on = on.get("b"), (on.get("n_wet") or 0)
    if tr and tr.get("b") is not None:
        n_tr = tr.get("n_wet") or 20
        b = tr["b"] if not b_on else (tr["b"] * n_tr + b_on * n_on) / (n_tr + n_on)
        mae = tr.get("mae")
    else:
        b = b_on if b_on else 1.0
        mae = on.get("mae")
    n_mae = (on.get("n") or 0) + ((tr or {}).get("n") or 0)
    mae = 1.0 if mae is None else mae
    mae_s = (n_mae * mae + 10 * 1.0) / (n_mae + 10)
    mae_s *= 1.0 + 0.06 * max(0, lead - 1)       # errors grow with lead time
    return min(3.0, max(0.4, b)), mae_s


def pool_ensembles(ens, ds):
    """Combine members of all ensembles for one day, each ensemble weighted equally."""
    groups = [(name, e["daily"][ds]) for name, e in (ens or {}).items() if ds in (e.get("daily") or {})]
    if not groups:
        return None
    m = max(len(v) for _, v in groups)
    pooled = []
    for _, v in groups:
        rep = max(1, round(m / len(v)))
        pooled += v * rep
    pooled.sort()
    return dict(n=sum(len(v) for _, v in groups), names=[g for g, _ in groups], vals=pooled,
                mean=sum(pooled) / len(pooled),
                p_any=sum(1 for x in pooled if x >= 0.25) / len(pooled),
                p_1=sum(1 for x in pooled if x >= 1.0) / len(pooled),
                p_6=sum(1 for x in pooled if x >= 6.0) / len(pooled))


def build(today, det_sources, model_detail, ens, history_vail, log, trained=None):
    """det_sources: {name: {date: inches}}; model_detail: {name: {date: {...}}}; ens: {name: {daily: {date: [inches]}}}.
    Returns (cumbre dict, new log)."""
    online, obs, u0 = learn_online(history_vail, log)
    k_ens = 1.0
    tr_e = _trained(trained, "ECMWF", 7)
    if tr_e and tr_e.get("b"):
        k_ens = min(2.5, max(0.5, tr_e["b"]))
    days = []
    order = ["Vail", "NWS", "ECMWF", "AIFS", "GFS", "HRRR", "NBM", "ICON", "GEM", "UKMO", "JMA"]
    detail_pref = ["ECMWF", "GFS", "ICON", "GEM"]
    for k in range(N_DAYS):
        d = today + dt.timedelta(days=k)
        ds = d.isoformat()
        cl = CLIM.get(ds[5:], [0.3, 4.3, 7.5])
        lead = max(1, k)
        pw = (((trained or {}).get("blend") or {}).get(str(min(lead, 7))) or {}).get("p", 2)
        vals = []
        for name in order:
            ser = det_sources.get(name) or {}
            if ds not in ser or ser[ds] is None:
                continue
            if name == "Vail" and k == 0:
                continue                                   # Vail's same-day number mixes in snow already fallen
            if k > MAX_LEAD.get(name, 99):
                continue
            raw = float(ser[ds])
            b, mae = correction(name, lead, online, trained)
            corr = raw * b if raw >= 0.3 else raw
            vals.append((name, raw, corr, (1.0 / max(mae, 0.05)) ** pw))
        E = pool_ensembles(ens, ds)
        extra = 0.0
        if E:
            evals = [x * k_ens for x in E["vals"]]
            emean = E["mean"] * k_ens
        if len(vals) >= 2 and k <= 10:
            q = sum(c * w for _, _, c, w in vals) / sum(w for *_, w in vals)
            p_any = E["p_any"] if E else 1 - math.exp(-q / 1.2)
            if q < 1.0:      # dry-ish consensus: add the light snow models usually miss over Vail's peaks
                extra = u0 * max(0.0, min(2.0, p_any / 0.35)) * (1.0 - q)
            mean = q + extra
            det_lo = min(c for _, _, c, _ in vals)
            det_hi = max(c for _, _, c, _ in vals) + extra
            q10m, q90m = max(0.2, 0.45 - 0.02 * k), 2.0 + 0.1 * k
            d_lo, d_hi = min(det_lo, mean * q10m), max(det_hi, mean * q90m, mean + 0.5)
            if E and emean > 0.05:
                scale = mean / emean
                qs = [_pct(evals, p) * scale for p in QS]
                e_lo, e_hi = qs[1], qs[9]
                wE = 0.0 if k <= 1 else 0.5 if k <= 6 else 0.7
                lo = (1 - wE) * d_lo + wE * e_lo
                hi = (1 - wE) * d_hi + wE * e_hi
            else:
                lo, hi = d_lo, d_hi
                qs = None
            kind = "det"
            p = p_any
        elif E:
            q = None
            mean = emean
            qs = [_pct(evals, p) for p in QS]
            lo, hi = qs[1], qs[9]
            p = E["p_any"]
            kind = "ens"
        else:
            q = None
            p = cl[0]
            mean = p * cl[1]
            lo, hi, qs = 0.0, cl[2], None
            kind = "clim"
        if qs is None:      # synthetic distribution: dry with prob 1-p, exponential amounts otherwise
            pwet = min(0.95, max(0.05, p))
            m_wet = mean / pwet
            qs = []
            for pp in QS:
                u = pp / 100.0
                if u <= 1 - pwet:
                    qs.append(0.0)
                else:
                    u2 = min(0.97, (u - (1 - pwet)) / pwet)
                    qs.append(-m_wet * math.log(1 - u2))
        qs = sorted(max(0.0, x) for x in qs)
        # confidence from the ensemble spread and lead time
        spread = (hi - lo) / (mean + 0.75)
        if kind == "clim":
            conf = "baja"
        elif k <= 2 and spread < 2.0:
            conf = "alta"
        elif k <= 6 and spread < 3.2:
            conf = "media"
        else:
            conf = "baja"
        det = None
        for nm in detail_pref:
            det = (model_detail.get(nm) or {}).get(ds)
            if det:
                break
        det = det or {}
        days.append(dict(date=ds, k=k, kind=kind, mean=round(mean, 2), lo=round(max(0.0, lo), 2), hi=round(max(hi, mean), 2),
                         q=None if q is None else round(q, 2), extra=round(extra, 2), p=round(p, 2), conf=conf,
                         qs=[round(x, 2) for x in qs],
                         srcs={n: [round(r, 2), round(c, 2)] for n, r, c, _ in vals},
                         ens=None if not E else dict(n=E["n"], names=E["names"], mean=round(emean, 2),
                                                     p_any=round(E["p_any"], 2), p_1=round(E["p_1"], 2), p_6=round(E["p_6"], 2)),
                         tmin=det.get("tmin"), tmax=det.get("tmax"), twet=det.get("twet"), wdir=det.get("wdir"),
                         fl=det.get("fl_max"), clim=dict(p=cl[0], wet=cl[1], p90=cl[2])))
    # log leads 1-3 for online learning; newest run of the day wins
    tiso = today.isoformat()
    log = [e for e in (log or []) if e.get("i") != tiso]
    for day in days:
        if 1 <= day["k"] <= 3:
            for n, (raw, corr) in day["srcs"].items():
                log.append(dict(i=tiso, t=day["date"], L=day["k"], s=n, v=raw))
            log.append(dict(i=tiso, t=day["date"], L=day["k"], s="Cumbre", v=day["mean"]))
    cutoff = (today - dt.timedelta(days=150)).isoformat()
    log = [e for e in log if e["i"] >= cutoff]
    online, obs, u0 = learn_online(history_vail, log)
    stats = {}
    for name in order + ["Cumbre"]:
        b1, mae1 = correction(name, 1, online, trained)
        tr = _trained(trained, name, 1)
        stats[name] = dict(online=online.get(name), b=round(b1, 2), mae=round(mae1, 2),
                           trained=dict(b=tr.get("b"), mae=tr.get("mae"), n=tr.get("n")) if tr else None)
    return dict(version=2, today=tiso, days=days, stats=stats, u0=u0, k_ens=round(k_ens, 2),
                trained_at=(trained or {}).get("trained_at")), log

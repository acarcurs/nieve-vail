"""NRCS SNOTEL #842 Vail Mountain (3,139 m): snow water equivalent, depth and precipitation."""
import csv
import io

from common import get

BASE = "https://wcc.sc.egov.usda.gov/reportGenerator/view_csv/customSingleStationReport/daily/842:CO:SNTL%7Cid=%22%22%7Cname"


def _f(x):
    try:
        return float(x) if x not in ("", None) else None
    except ValueError:
        return None


def fetch(period="-30,0"):
    """period: '-30,0' (last 30 days) or 'YYYY-MM-DD,YYYY-MM-DD'.
    Returns rows [{date, swe, med, depth, precip}] (inches; start-of-day values)."""
    url = f"{BASE}/{period}/WTEQ::value,WTEQ::median_1991,SNWD::value,PREC::value"
    txt = get(url, kind="text", timeout=90)
    lines = [l for l in txt.splitlines() if l.strip() and not l.startswith("#")]
    rows = []
    for rec in csv.reader(io.StringIO("\n".join(lines))):
        if not rec or not rec[0][:4].isdigit():
            continue
        rec = (rec + [""] * 5)[:5]
        depth = _f(rec[3])
        rows.append(dict(date=rec[0][:10], swe=_f(rec[1]), med=_f(rec[2]),
                         depth=None if depth is None else int(round(depth)), precip=_f(rec[4])))
    if not rows:
        raise RuntimeError("SNOTEL: no rows")
    return rows


def merge(prev_rows, new_rows):
    cur = {r["date"]: r for r in (prev_rows or [])}
    for r in new_rows:
        old = cur.get(r["date"], {})
        cur[r["date"]] = {k: (r[k] if r.get(k) is not None else old.get(k)) for k in ("date", "swe", "med", "depth", "precip")}
    return [cur[k] for k in sorted(cur)]


def daily_liquid(rows):
    """Observed liquid precipitation per day (inches): max of the gauge and the snow-pillow increase.
    SNOTEL values are start-of-day, so day D = value(D+1) - value(D)."""
    by = {r["date"]: r for r in rows}
    import datetime as dt
    out = {}
    for d, r in by.items():
        nxt = by.get((dt.date.fromisoformat(d) + dt.timedelta(days=1)).isoformat())
        if not nxt:
            continue
        dp = (nxt["precip"] - r["precip"]) if (nxt.get("precip") is not None and r.get("precip") is not None) else None
        dw = (nxt["swe"] - r["swe"]) if (nxt.get("swe") is not None and r.get("swe") is not None) else None
        vals = [v for v in (dp, dw) if v is not None]
        if not vals:
            continue
        v = max(vals)
        if v < 0 or v > 4:      # gauge resets / bad data
            v = max(0.0, dp) if dp is not None and 0 <= dp <= 4 else None
        if v is not None:
            out[d] = round(max(0.0, v), 2)
    return out

"""Snowpack history at NRCS SNOTEL #842 Vail Mountain (3,139 m).

Daily snow water equivalent (SWE, inches, start-of-day values) for every winter on record and, for each
calendar day, the spread of that same date across the reference winters (the last 30 complete ones).

data/snowpack.json:
  days     'MM-DD' from Oct 1 to Jul 31 (304 days; Feb 29 is dropped)
  seasons  {'1979': [swe or null, ...], ...}   key = year the winter starts
  bands    {min, p10, p30, p50, p70, p90, max: [...]} over the reference winters
  ref      {first, last, n}  reference winters (start years)
Rebuilt weekly by update.py."""
import csv
import datetime as dt
import io

from common import get, now_utc_iso
from snotel import BASE

N_REF = 30
MAX_GAP = 10            # days of missing data filled by linear interpolation


def template():
    d, end, out = dt.date(2001, 10, 1), dt.date(2002, 7, 31), []
    while d <= end:
        out.append(d.strftime("%m-%d"))
        d += dt.timedelta(days=1)
    return out


def fetch_por():
    """{date: swe} for the whole period of record."""
    txt = get(f"{BASE}/POR_BEGIN,POR_END/WTEQ::value", kind="text", timeout=240)
    lines = [l for l in txt.splitlines() if l.strip() and not l.startswith("#")]
    out = {}
    for rec in csv.reader(io.StringIO("\n".join(lines))):
        if len(rec) < 2 or not rec[0][:4].isdigit():
            continue
        try:
            v = float(rec[1]) if rec[1] != "" else None
        except ValueError:
            v = None
        out[rec[0][:10]] = None if v is None else max(0.0, v)
    if len(out) < 365:
        raise RuntimeError(f"SNOTEL POR: only {len(out)} rows")
    return out


def to_seasons(rows, days):
    idx = {k: i for i, k in enumerate(days)}
    out = {}
    for d, v in rows.items():
        y, m, key = int(d[:4]), int(d[5:7]), d[5:10]
        if key not in idx:                       # Aug, Sep and Feb 29
            continue
        sy = y if m >= 10 else y - 1
        out.setdefault(sy, [None] * len(days))[idx[key]] = v
    for arr in out.values():                      # fill short gaps
        known = [i for i, v in enumerate(arr) if v is not None]
        for a, b in zip(known, known[1:]):
            if 1 < b - a <= MAX_GAP + 1:
                for i in range(a + 1, b):
                    arr[i] = arr[a] + (arr[b] - arr[a]) * (i - a) / (b - a)
    return out


def pct(vals, q):
    v = sorted(vals)
    k = (len(v) - 1) * q
    f = int(k)
    c = min(f + 1, len(v) - 1)
    return v[f] + (v[c] - v[f]) * (k - f)


def build(today):
    days = template()
    rows = fetch_por()
    seasons = to_seasons(rows, days)
    cur = today.year if today.month >= 10 else today.year - 1
    jun30 = days.index("06-30")

    def complete(sy):
        arr = seasons[sy][:jun30 + 1]
        return sy < cur and sum(v is not None for v in arr) >= 0.9 * len(arr)

    ref = sorted(sy for sy in seasons if complete(sy))[-N_REF:]
    if len(ref) < 10:
        raise RuntimeError(f"only {len(ref)} complete winters")
    qs = dict(min=0.0, p10=0.1, p30=0.3, p50=0.5, p70=0.7, p90=0.9, max=1.0)
    bands = {k: [] for k in qs}
    for i in range(len(days)):
        vals = [seasons[sy][i] for sy in ref if seasons[sy][i] is not None]
        for k, q in qs.items():
            bands[k].append(round(pct(vals, q), 2) if len(vals) >= 10 else None)
    keep = {str(sy): [None if v is None else round(v, 1) for v in arr]
            for sy, arr in sorted(seasons.items()) if sy == cur or sum(v is not None for v in arr) >= 0.5 * len(arr)}
    return dict(built=today.isoformat(), generated_at=now_utc_iso(),
                station="Vail Mountain SNOTEL #842 · 3,139 m", unit="in",
                por_first=min(d for d, v in rows.items() if v is not None),
                days=days, ref=dict(first=ref[0], last=ref[-1], n=len(ref)),
                bands=bands, seasons=keep)

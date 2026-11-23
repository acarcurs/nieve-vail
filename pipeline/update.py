#!/usr/bin/env python3
"""Refresh every data file of the app. Runs in GitHub Actions every few hours.

  python pipeline/update.py                 # normal run
  python pipeline/update.py --osm           # also refresh runs and lifts from OpenStreetMap
  python pipeline/update.py --sat-backfill 2025-10-01   # analyze older Sentinel-2 passes too

Each source is independent: if one fails, the others still update and the old values are kept."""
import argparse
import datetime as dt
import os
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import DATA, load_json, now_utc_iso, save_json, today_local  # noqa: E402
import cumbre  # noqa: E402
import news  # noqa: E402
import nws  # noqa: E402
import openmeteo  # noqa: E402
import osm  # noqa: E402
import snotel  # noqa: E402
import vail  # noqa: E402

LIVE = os.path.join(DATA, "live.json")
STATUS = os.path.join(DATA, "status.json")
LOG = os.path.join(DATA, "cumbre_log.json")
MODEL = os.path.join(DATA, "cumbre_model.json")
OSM = os.path.join(DATA, "map", "vail_osm.geojson")
MAPST = os.path.join(DATA, "map", "status.json")
SAT = os.path.join(DATA, "sat", "index.json")


class Step:
    def __init__(self, status, name):
        self.status, self.name = status, name

    def __enter__(self):
        self.t = time.time()
        return self

    def __exit__(self, et, ev, tb):
        ms = int((time.time() - self.t) * 1000)
        if et is None:
            self.status[self.name] = dict(ok=True, ms=ms, at=now_utc_iso(), info=getattr(self, "info", None))
            print(f"[ok] {self.name} {ms} ms {getattr(self, 'info', '')}", flush=True)
        else:
            self.status[self.name] = dict(ok=False, ms=ms, at=now_utc_iso(), error=f"{et.__name__}: {str(ev)[:300]}")
            print(f"[FAIL] {self.name}: {et.__name__}: {ev}", flush=True)
            traceback.print_exception(et, ev, tb, limit=3)
        return True        # never stop the run


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--osm", action="store_true")
    ap.add_argument("--no-sat", action="store_true")
    ap.add_argument("--sat-backfill")
    a = ap.parse_args()
    prev = load_json(LIVE, {}) or {}
    old_status = load_json(STATUS, {}) or {}
    status = {}
    today = today_local()
    live = dict(prev)
    live["generated_at"] = now_utc_iso()
    live["today"] = today.isoformat()

    with Step(status, "vail") as s:
        v = vail.fetch(prev, today)
        if v.get("terrain"):
            live["terrain"], live["terrain_date"] = v["terrain"], v["latest_date"]
        if v.get("report"):
            live["report"] = v["report"]
        if v.get("history_vail"):
            live["history_vail"] = v["history_vail"]
        s.info = dict(date=v.get("latest_date"))
        # lifts show "Closed" after hours: remember which ones ran at any point today
        lt = prev.get("lifts_today") or {}
        names = set(lt.get("names", [])) if lt.get("date") == live.get("terrain_date") else set()
        names |= {l["n"] for l in (live.get("terrain") or {}).get("lifts", []) if (l.get("s") or "").lower() == "open"}
        live["lifts_today"] = dict(date=live.get("terrain_date"), names=sorted(names))

    with Step(status, "snotel") as s:
        rows = snotel.fetch("-30,0")
        live["snotel"] = snotel.merge(prev.get("snotel"), rows)
        s.info = dict(last=rows[-1]["date"], swe=rows[-1]["swe"])

    with Step(status, "nws") as s:
        n = nws.fetch()
        live["nws"] = n
        s.info = dict(days=len(n.get("daily", {})), periods=len(n.get("periods", [])))

    with Step(status, "nws_afd") as s:
        live["afd"] = nws.fetch_afd()
        s.info = dict(issued=live["afd"].get("issued"))

    models, ens = {}, {}
    with Step(status, "models") as s:
        models, errs = openmeteo.fetch_models()
        if not models:
            raise RuntimeError(f"no models: {errs}")
        s.info = dict(got=sorted(models), failed=errs)
    with Step(status, "ensembles") as s:
        ens, errs = openmeteo.fetch_ensembles()
        if not ens:
            raise RuntimeError(f"no ensembles: {errs}")
        s.info = dict(got={k: v["members"] for k, v in ens.items()}, failed=errs)

    with Step(status, "cumbre") as s:
        det = {}
        vf = vail.vail_forecast_days(live.get("report"))
        if vf:
            det["Vail"] = vf
        if (live.get("nws") or {}).get("daily") and status.get("nws", {}).get("ok"):
            det["NWS"] = {d: v["snow"] for d, v in live["nws"]["daily"].items()}
        for name, m in models.items():
            det[name] = {d: v["snow"] for d, v in m["daily"].items()}
        if len(det) < 2 and (prev.get("cumbre") or {}).get("sources"):
            old = {}                                          # keep the last sources if almost everything failed
            for n, ser in prev["cumbre"]["sources"].items():
                ser = ser.get("days", ser) if isinstance(ser, dict) else {}
                old[n] = {d: float(x) for d, x in ser.items() if isinstance(x, (int, float)) and d[:2] == "20"}
            det = {**old, **det}
        log = load_json(LOG, []) or []
        trained = load_json(MODEL, None)
        cb, log = cumbre.build(today, det, {n: m["daily"] for n, m in models.items()}, ens,
                               live.get("history_vail"), log, trained)
        cb["issued"] = now_utc_iso()
        cb["sources"] = {n: {d: round(x, 2) for d, x in ser.items() if d >= today.isoformat()} for n, ser in det.items()}
        cb["model_ids"] = {n: m["id"] for n, m in models.items()}
        cb["ensembles"] = {n: dict(id=e["id"], members=e["members"]) for n, e in ens.items()}
        live["cumbre"] = cb
        save_json(LOG, log)
        s.info = dict(d5=round(sum(d["mean"] for d in cb["days"][:5]), 1), d16=round(sum(d["mean"] for d in cb["days"]), 1))

    with Step(status, "news") as s:
        items = news.fetch()
        live["news_raw"] = dict(checked=today.isoformat(), items=items)
        s.info = dict(n=len(items))

    # runs & lifts (OSM refreshed weekly) and their status (every run)
    geo = load_json(OSM)
    if a.osm or not geo or dt.datetime.utcnow().weekday() == 0 and dt.datetime.utcnow().hour < 4:
        with Step(status, "osm") as s:
            geo = osm.fetch()
            save_json(OSM, geo)
            s.info = dict(features=len(geo["features"]))
    zones = None
    if geo and live.get("terrain"):
        with Step(status, "map_status") as s:
            ms = osm.match(geo, live["terrain"], set((live.get("lifts_today") or {}).get("names", [])))
            ms["updated"] = now_utc_iso()
            ms["terrain_date"] = live.get("terrain_date")
            save_json(MAPST, ms)
            s.info = dict(pistes=len(ms["pistes"]), lifts=len(ms["lifts"]), unmatched=len(ms["unmatched"]))
            bb = [f for f in ms["areas"]["features"] if f["properties"]["name"] in vail.BB_AREAS]
            fr = [f for f in ms["areas"]["features"] if f["properties"]["name"] not in vail.BB_AREAS and f["properties"]["name"] != "Blue Sky Basin"]
            if bb and fr:
                zones = {"bb": osm._hull([p for f in bb for p in f["geometry"]["coordinates"][0]]),
                         "front": osm._hull([p for f in fr for p in f["geometry"]["coordinates"][0]])}
                zones = {k: [tuple(p) for p in v] + [tuple(v[0])] for k, v in zones.items()}

    if not a.no_sat:
        with Step(status, "satellite") as s:
            import satellite
            si = satellite.run(load_json(SAT, {}), zones=zones, backfill_from=a.sat_backfill)
            save_json(SAT, si)
            s.info = dict(new=si["new"], passes=len(si["passes"]), overlay=(si.get("overlay") or {}).get("date"), errors=len(si["errors"]))

    # keep the previous status for steps that did not run this time
    for k, v in old_status.get("steps", {}).items():
        status.setdefault(k, {**v, "skipped": True})
    save_json(LIVE, live)
    save_json(STATUS, dict(updated=now_utc_iso(), steps=status))
    bad = [k for k, v in status.items() if not v.get("ok") and not v.get("skipped")]
    print("done; failed steps:", bad or "none", flush=True)


if __name__ == "__main__":
    main()

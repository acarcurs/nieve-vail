"""Decide whether a data refresh is worth a commit (exit 0) or can be dropped (exit 1).

The workflow runs often because GitHub's scheduler skips runs; committing every run would bloat the
history, so only material changes are kept, plus a refresh at least every 3 hours."""
import json
import subprocess
import sys
import time


def head(path):
    try:
        return json.loads(subprocess.check_output(["git", "show", "HEAD:" + path], stderr=subprocess.DEVNULL))
    except Exception:  # noqa: BLE001
        return None


def cur(path):
    try:
        return json.load(open(path, encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None


def strip_live(L):
    if not L:
        return L
    L = dict(L)
    for k in ("generated_at", "cumbre", "nws", "news_raw"):
        L.pop(k, None)
    return L


def cumbre_material(a, b):
    da = {d["date"]: d for d in ((a or {}).get("cumbre") or {}).get("days", [])}
    db = {d["date"]: d for d in ((b or {}).get("cumbre") or {}).get("days", [])}
    if set(da) != set(db):
        return True
    for k, x in da.items():
        y = db[k]
        if x.get("kind") != y.get("kind") or abs(x.get("mean", 0) - y.get("mean", 0)) >= 0.2 or abs(x.get("p", 0) - y.get("p", 0)) >= 0.1:
            return True
    return False


def main():
    old, new = head("data/live.json"), cur("data/live.json")
    reasons = []
    if old is None or new is None:
        reasons.append("live.json new or unreadable")
    else:
        if strip_live(old) != strip_live(new):
            reasons.append("Vail/SNOTEL/terrain/discussion")
        if cumbre_material(old, new):
            reasons.append("Cumbre")
        po = [p.get("text") for p in ((old.get("nws") or {}).get("periods") or [])]
        pn = [p.get("text") for p in ((new.get("nws") or {}).get("periods") or [])]
        if po != pn:
            reasons.append("NWS text")
        if [i.get("url") for i in (old.get("news_raw") or {}).get("items", [])] != [i.get("url") for i in (new.get("news_raw") or {}).get("items", [])]:
            reasons.append("headlines")
    for path, vol in (("data/sat/index.json", ("updated", "errors", "new")), ("data/map/status.json", ("updated",))):
        a, b = head(path), cur(path)
        if a is not None and b is not None:
            a = {k: v for k, v in a.items() if k not in vol}
            b = {k: v for k, v in b.items() if k not in vol}
        if a != b:
            reasons.append(path.split("/")[-2] if "sat" in path else "map")
    a, b = head("data/snowpack.json"), cur("data/snowpack.json")
    if b is not None and (a is None or {k: v for k, v in a.items() if k != "generated_at"} != {k: v for k, v in b.items() if k != "generated_at"}):
        reasons.append("snowpack")
    out = subprocess.check_output(["git", "status", "--porcelain", "--", "data"]).decode()
    if any(l[3:].startswith("data/sat/") and l[3:].endswith((".jpg", ".png")) for l in out.splitlines()):
        reasons.append("satellite image")
    try:
        last = int(subprocess.check_output(["git", "log", "-1", "--format=%ct", "--", "data/live.json"]).decode().strip() or 0)
    except Exception:  # noqa: BLE001
        last = 0
    if time.time() - last > 3 * 3600:
        reasons.append("3 h since last refresh")
    print("changes:", ", ".join(reasons) if reasons else "none")
    sys.exit(0 if reasons else 1)


if __name__ == "__main__":
    main()

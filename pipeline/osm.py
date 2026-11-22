"""Vail's runs and lifts from OpenStreetMap (Overpass API, ODbL) and their open/closed status.

Run names in OSM and in Vail's feed differ a little ("Born Free" vs "Born Free - Lower",
"Mountaintop Express" vs "Mountaintop Express #4"), so names are normalized and matched."""
import difflib
import re

from common import SESSION

S, W, N, E = 39.555, -106.43, 39.665, -106.25
QUERY = f"""[out:json][timeout:90];
(
  way["piste:type"="downhill"]({S},{W},{N},{E});
  relation["piste:type"="downhill"]({S},{W},{N},{E});
  way["aerialway"]({S},{W},{N},{E});
  way["landuse"="winter_sports"]({S},{W},{N},{E});
  relation["landuse"="winter_sports"]({S},{W},{N},{E});
);
out geom;"""
ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
             "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
POS = {"lower", "upper", "middle", "lower middle", "upper middle", "east", "west", "north", "south"}


def fetch():
    last = None
    for url in ENDPOINTS:
        try:
            r = SESSION.post(url, data={"data": QUERY}, timeout=120)
            r.raise_for_status()
            return to_geojson(r.json())
        except Exception as e:  # noqa: BLE001
            last = e
    raise last


def _coords(geom):
    return [[round(p["lon"], 6), round(p["lat"], 6)] for p in geom if p]


def to_geojson(j):
    feats = []
    for el in j.get("elements", []):
        t = el.get("tags", {})
        kind = "lift" if "aerialway" in t else "piste" if t.get("piste:type") == "downhill" else "area" if t.get("landuse") == "winter_sports" else None
        if not kind:
            continue
        if kind == "lift" and t.get("aerialway") in ("station", "pylon", "goods", "zip_line"):
            continue
        props = dict(kind=kind, id=f'{el["type"][0]}{el["id"]}', name=t.get("name") or t.get("piste:name"),
                     diff=t.get("piste:difficulty"), ref=t.get("ref"), lift=t.get("aerialway"),
                     groom=t.get("piste:grooming"))
        props = {k: v for k, v in props.items() if v}
        if el["type"] == "way":
            c = _coords(el.get("geometry", []))
            if len(c) < 2:
                continue
            closed = c[0] == c[-1] and len(c) >= 4
            is_area = kind == "area" or (closed and (t.get("area") == "yes" or kind == "piste" and t.get("area") != "no" and len(c) > 6 and _is_area_like(c)))
            geom = dict(type="Polygon", coordinates=[c]) if is_area else dict(type="LineString", coordinates=c)
            feats.append(dict(type="Feature", properties=props, geometry=geom))
        elif el["type"] == "relation":
            lines = [_coords(m.get("geometry", [])) for m in el.get("members", []) if m.get("type") == "way" and m.get("geometry")]
            lines = [l for l in lines if len(l) >= 2]
            if not lines:
                continue
            if kind == "area" or t.get("type") == "multipolygon":
                geom = dict(type="MultiPolygon", coordinates=[[l] for l in lines if l[0] == l[-1]] or [[lines[0]]])
            else:
                geom = dict(type="MultiLineString", coordinates=lines)
            feats.append(dict(type="Feature", properties=props, geometry=geom))
    return dict(type="FeatureCollection", features=feats)


def _is_area_like(c):
    xs, ys = [p[0] for p in c], [p[1] for p in c]
    w, h = (max(xs) - min(xs)) * 77, (max(ys) - min(ys)) * 111      # km
    return min(w, h) > 0.08


def norm(s):
    s = (s or "").lower().replace("’", "'")
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"#\s*\d+", " ", s)
    s = s.replace("&", " and ").replace("'", "")
    s = re.sub(r"[^a-z0-9%]+", " ", s)
    stop = {"the", "lift", "chair", "chairlift", "run", "trail", "ski"}
    return " ".join(w for w in s.split() if w not in stop)


def _variants(name):
    n = norm(name)
    out = {n}
    words = n.split()
    for k in (2, 1):
        if len(words) > k and " ".join(words[:k]) in POS:       # "lower born free" -> "born free lower"
            out.add(" ".join(words[k:] + words[:k]))
    return out


def match(geo, terrain):
    """Returns status for each OSM feature id and polygons/centers per Vail area."""
    full, base, lifts_by_ref, lifts_by_name = {}, {}, {}, {}
    for a in (terrain or {}).get("areas", []):
        for t in a["trails"]:
            n = norm(t["n"])
            full[n] = (t, a["name"])
            parts = re.split(r"\s+-\s+", t["n"], maxsplit=1)
            b = norm(parts[0])
            if len(parts) == 2:
                full[norm(parts[0] + " " + parts[1])] = (t, a["name"])
            base.setdefault(b, []).append((t, a["name"]))
    for l in (terrain or {}).get("lifts", []):
        m = re.search(r"#\s*(\d+)", l["n"] or "")
        if m:
            lifts_by_ref[m.group(1)] = l
        lifts_by_name[norm(l["n"])] = l
    st_p, st_l, unmatched = {}, {}, []
    keys_full = list(full)
    for f in geo.get("features", []):
        p = f["properties"]
        if p["kind"] == "piste" and p.get("name"):
            hit = None
            for v in _variants(p["name"]):
                if v in full:
                    t, area = full[v]
                    hit = (1 if t["o"] else 0, t["n"], area, t.get("d"))
                    break
                if v in base:
                    segs = base[v]
                    hit = (1 if any(t["o"] for t, _ in segs) else 0, segs[0][0]["n"].split(" - ")[0], segs[0][1], segs[0][0].get("d"))
                    break
            if not hit:
                c = difflib.get_close_matches(norm(p["name"]), keys_full, n=1, cutoff=0.86)
                if c:
                    t, area = full[c[0]]
                    hit = (1 if t["o"] else 0, t["n"], area, t.get("d"))
            if hit:
                st_p[p["id"]] = list(hit)
            else:
                unmatched.append(p["name"])
        elif p["kind"] == "lift":
            l = lifts_by_ref.get(str(p.get("ref") or "").strip("# ")) if p.get("ref") else None
            if not l and p.get("name"):
                n = norm(p["name"])
                l = lifts_by_name.get(n)
                if not l:
                    c = difflib.get_close_matches(n, list(lifts_by_name), n=1, cutoff=0.8)
                    l = lifts_by_name[c[0]] if c else None
            if l:
                st_l[p["id"]] = [(l.get("s") or "").lower(), l["n"], l.get("area")]
    # area hulls from matched runs
    pts = {}
    for f in geo.get("features", []):
        s = st_p.get(f["properties"]["id"])
        if not s:
            continue
        g = f["geometry"]
        cs = g["coordinates"]
        flat = cs if g["type"] == "LineString" else cs[0] if g["type"] == "Polygon" else [p for l in cs for p in (l if g["type"] == "MultiLineString" else l[0])]
        pts.setdefault(s[2], []).extend(flat)
    areas = []
    for a in (terrain or {}).get("areas", []):
        P = pts.get(a["name"])
        if not P or len(P) < 3:
            continue
        hull = _hull(P)
        cx = sum(p[0] for p in P) / len(P)
        cy = sum(p[1] for p in P) / len(P)
        areas.append(dict(type="Feature", properties=dict(name=a["name"], open=a["open"], total=a["total"]),
                          geometry=dict(type="Polygon", coordinates=[hull + [hull[0]]]), center=[round(cx, 5), round(cy, 5)]))
    return dict(pistes=st_p, lifts=st_l, unmatched=sorted(set(unmatched))[:80],
                areas=dict(type="FeatureCollection", features=areas))


def _hull(points):
    pts = sorted(set((round(x, 5), round(y, 5)) for x, y in points))
    if len(pts) <= 2:
        return [list(p) for p in pts]
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return [list(p) for p in lower[:-1] + upper[:-1]]

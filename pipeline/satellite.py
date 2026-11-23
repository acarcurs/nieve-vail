"""Snow cover from Sentinel-2 (ESA Copernicus; COGs on AWS via Element 84 Earth Search).

For each new pass over Vail (MGRS tile 13SCD) we read only the small window around the ski area:
 - SCL scene classification -> clouds;
 - NDSI = (green - SWIR) / (green + SWIR) -> snow where NDSI > 0.4 and the surface is bright;
 - snow % for the Back Bowls, the front side and the whole area (clear pixels only).
For the newest clear pass we also save a true-color image and a snow overlay, both in lon/lat
so the web map can drape them over the 3D terrain."""
import datetime as dt
import io
import os

import numpy as np

from common import BBOX, DATA, post_json

STAC = "https://earth-search.aws.element84.com/v1/search"
TILE = "_13SCD_"
OUT = os.path.join(DATA, "sat")
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif,.TIF")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "3")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")

# Fallback zone polygons (lon, lat) if the OSM run hulls are not available
BB_POLY = [(-106.395, 39.612), (-106.355, 39.615), (-106.330, 39.611), (-106.300, 39.604), (-106.296, 39.588),
           (-106.330, 39.582), (-106.368, 39.585), (-106.395, 39.596), (-106.395, 39.612)]
FRONT_POLY = [(-106.405, 39.640), (-106.380, 39.646), (-106.345, 39.646), (-106.330, 39.640), (-106.332, 39.618),
              (-106.360, 39.613), (-106.395, 39.614), (-106.408, 39.625), (-106.405, 39.640)]
# lon/lat grid for map overlays (~10 m)
DLON, DLAT = 0.00012, 0.00009


def search(start, end, limit=200):
    body = {"collections": ["sentinel-2-l2a"], "bbox": list(BBOX), "limit": 100,
            "datetime": f"{start}T00:00:00Z/{end}T23:59:59Z",
            "sortby": [{"field": "properties.datetime", "direction": "desc"}]}
    items, url, n = [], STAC, 0
    while url and n < 10:
        j = post_json(url, body, timeout=60)
        items += [f for f in j.get("features", []) if TILE in f["id"]]
        nxt = [l for l in j.get("links", []) if l.get("rel") == "next"]
        if not nxt or len(items) >= limit:
            break
        body = nxt[0].get("body") or body
        url = nxt[0].get("href", STAC)
        n += 1
    seen, out = set(), []
    for f in items:                 # drop duplicate reprocessings of the same pass (keep newest)
        key = f["properties"]["datetime"][:16]
        if key in seen:
            continue
        seen.add(key)
        out.append(f)
    return out


def _offset(item):
    p = item["properties"]
    if p.get("earthsearch:boa_offset_applied"):
        return 0
    try:
        return -1000 if float(p.get("s2:processing_baseline", "0")) >= 4.0 else 0
    except ValueError:
        return 0


def _read(href, shape=None):
    import rasterio
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds
    with rasterio.open(href) as ds:
        b = transform_bounds("EPSG:4326", ds.crs, *BBOX, densify_pts=21)
        win = from_bounds(*b, transform=ds.transform).round_offsets().round_lengths()
        kw = dict(window=win, boundless=True, fill_value=0)
        if shape:
            kw["out_shape"] = (ds.count, shape[0], shape[1]) if ds.count > 1 else shape
            from rasterio.enums import Resampling
            kw["resampling"] = Resampling.bilinear
        arr = ds.read(**kw) if ds.count > 1 else ds.read(1, **kw)
        tr = ds.window_transform(win)
        if shape:
            tr = tr * tr.scale(win.width / shape[1], win.height / shape[0])
        return arr, tr, ds.crs


def _zone_mask(poly, shape, transform, crs):
    from rasterio.features import rasterize
    from rasterio.warp import transform_geom
    g = transform_geom("EPSG:4326", crs, {"type": "Polygon", "coordinates": [poly]})
    return rasterize([(g, 1)], out_shape=shape, transform=transform, fill=0, dtype="uint8").astype(bool)


def analyze(item, zones):
    a = item["assets"]
    scl, tr, crs = _read(a["scl"]["href"])
    shape = scl.shape
    swir, _, _ = _read(a["swir16"]["href"])
    green, _, _ = _read(a["green"]["href"], shape=shape)
    off = _offset(item)
    g = (green.astype("float32") + off) / 10000.0
    s = (swir.astype("float32") + off) / 10000.0
    valid = scl > 0
    cloud = np.isin(scl, [3, 8, 9, 10]) & valid
    clear = valid & ~cloud
    ndsi = (g - s) / np.maximum(g + s, 1e-4)
    snow = clear & (ndsi > 0.40) & (g > 0.12)
    res = dict(id=item["id"], datetime=item["properties"]["datetime"][:19] + "Z", date=item["properties"]["datetime"][:10],
               tile_cloud=round(float(item["properties"].get("eo:cloud_cover", 0)), 1),
               valid=round(float(valid.mean()), 3), cloud=round(float(cloud.sum() / max(1, valid.sum())), 3))
    for name, poly in zones.items():
        m = _zone_mask(poly, shape, tr, crs)
        c = (m & clear).sum()
        res[f"clear_{name}"] = round(float(c / max(1, (m & valid).sum())), 3)
        res[f"snow_{name}"] = round(float((m & snow).sum() / c), 3) if c > 50 else None
    return res, dict(snow=snow, cloud=cloud, valid=valid, transform=tr, crs=crs)


def _to_lonlat(arr, src_tr, src_crs, resampling, scale=1):
    from rasterio.transform import from_origin
    from rasterio.warp import reproject
    W_, S_, E_, N_ = BBOX
    w = int(round((E_ - W_) / (DLON * scale)))
    h = int(round((N_ - S_) / (DLAT * scale)))
    dst_tr = from_origin(W_, N_, DLON * scale, DLAT * scale)
    bands = arr if arr.ndim == 3 else arr[None]
    out = np.zeros((bands.shape[0], h, w), dtype=bands.dtype)
    for i in range(bands.shape[0]):
        reproject(bands[i], out[i], src_transform=src_tr, src_crs=src_crs, dst_transform=dst_tr, dst_crs="EPSG:4326",
                  resampling=resampling)
    return out


def render(item, masks):
    """Writes data/sat/latest_true.jpg, latest_snow.png and a thumbnail; returns overlay metadata."""
    from PIL import Image
    from rasterio.enums import Resampling
    os.makedirs(OUT, exist_ok=True)
    vis, tr, crs = _read(item["assets"]["visual"]["href"])
    rgb = _to_lonlat(vis, tr, crs, Resampling.bilinear)
    img = Image.fromarray(np.transpose(rgb, (1, 2, 0)).astype("uint8"), "RGB")
    # gentle contrast stretch so snow and rock read well on a phone
    arr = np.asarray(img).astype("float32")
    lo, hi = np.percentile(arr, 1), np.percentile(arr, 99.7)
    arr = np.clip((arr - lo) / max(1.0, hi - lo) * 255.0, 0, 255).astype("uint8")
    img = Image.fromarray(arr, "RGB")
    img.save(os.path.join(OUT, "latest_true.jpg"), quality=80, optimize=True, progressive=True)
    th = img.copy(); th.thumbnail((480, 480)); th.save(os.path.join(OUT, "latest_thumb.jpg"), quality=78)
    sm = _to_lonlat(masks["snow"].astype("uint8"), masks["transform"], masks["crs"], Resampling.nearest, scale=2)[0]
    cm = _to_lonlat(masks["cloud"].astype("uint8"), masks["transform"], masks["crs"], Resampling.nearest, scale=2)[0]
    rgba = np.zeros(sm.shape + (4,), dtype="uint8")
    rgba[sm == 1] = (64, 156, 255, 175)
    rgba[cm == 1] = (150, 150, 150, 110)
    Image.fromarray(rgba, "RGBA").save(os.path.join(OUT, "latest_snow.png"), optimize=True)
    W_, S_, E_, N_ = BBOX
    return dict(id=item["id"], date=item["properties"]["datetime"][:10], datetime=item["properties"]["datetime"][:19] + "Z",
                coordinates=[[W_, N_], [E_, N_], [E_, S_], [W_, S_]],
                true="data/sat/latest_true.jpg", snow="data/sat/latest_snow.png", thumb="data/sat/latest_thumb.jpg")


def run(prev, zones=None, backfill_from=None, max_new=12, budget_s=600):
    """prev: previous data/sat/index.json content. Returns new index dict.
    The first time, last season's passes are analyzed too (for the comparison chart), within a time budget."""
    import time
    t0 = time.time()
    zones = zones or {"bb": BB_POLY, "front": FRONT_POLY}
    zones = {**{"aoi": [(BBOX[0], BBOX[1]), (BBOX[2], BBOX[1]), (BBOX[2], BBOX[3]), (BBOX[0], BBOX[3]), (BBOX[0], BBOX[1])]}, **zones}
    prev = prev or {}
    hist = {h["id"]: h for h in prev.get("passes", [])}
    today = dt.date.today()
    season0 = dt.date(today.year if today.month >= 7 else today.year - 1, 10, 1)
    last0 = dt.date(season0.year - 1, 10, 1)
    if not backfill_from and not any(h["date"] < (last0 + dt.timedelta(days=120)).isoformat() for h in hist.values()):
        backfill_from = last0.isoformat()          # never filled last season yet
    start = backfill_from or (today - dt.timedelta(days=40)).isoformat()
    items = search(start, today.isoformat(), limit=500 if backfill_from else 60)
    items = [it for it in items if int(it["properties"]["datetime"][5:7]) not in (6, 7, 8, 9)]   # no summer scenes
    new = [it for it in items if it["id"] not in hist][: (500 if backfill_from else max_new)]
    errors = []
    latest_clear = None
    for it in new:          # newest first
        if time.time() - t0 > budget_s:
            errors.append(f"time budget reached; {len(new)} pending passes continue next run")
            break
        try:
            res, masks = analyze(it, zones)
            hist[it["id"]] = res
            if latest_clear is None and res["cloud"] < 0.35 and res["valid"] > 0.9 and \
                    (not prev.get("overlay") or res["date"] > prev["overlay"]["date"]):
                latest_clear = (it, masks, res)
        except Exception as e:  # noqa: BLE001
            errors.append(f'{it["id"]}: {str(e)[:150]}')
    overlay = prev.get("overlay")
    if latest_clear:
        it, masks, res = latest_clear
        try:
            overlay = render(it, masks)
            overlay.update(cloud=res["cloud"], snow_bb=res.get("snow_bb"), snow_front=res.get("snow_front"), snow_aoi=res.get("snow_aoi"))
        except Exception as e:  # noqa: BLE001
            errors.append(f"render: {str(e)[:150]}")
    passes = sorted(hist.values(), key=lambda h: h["datetime"], reverse=True)
    return dict(updated=dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"), overlay=overlay, passes=passes,
                zones={k: v for k, v in zones.items() if k != "aoi"}, errors=errors[:10], new=len(new))

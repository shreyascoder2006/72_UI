"""Rewrite the baked OpenMapTiles building layer for realism and per-facility control.

    python3 tools/enrich_buildings.py

OpenFreeMap merges every building of the same height in a tile into one feature and
carries no building class, and most Raleigh buildings have no height tag (OpenMapTiles
then writes render_height = 5). This pass, on the z13 and z14 tiles in place:

  1. reassembles buildings that tile clipping split across neighbouring tiles, so every
     decision below is made once per building and seams never show a step;
  2. classifies each building by the OSM land-use polygon its centroid falls in
     (commercial, industrial, hospital, civic, residential) and writes it as `class`;
  3. infers a height where OSM has none, from footprint area and class (a smooth
     function plus spatially smooth variation, so z13 and z14 agree), marked
     `inferred = 1`; explicit OSM heights are kept;
  4. lifts the footprints under each facility's hero-model site out of the tiles into
     tools/osm/facility_sites.json, so the map can show them or swap in the model.

Every other layer is copied byte for byte. Enriched tiles are skipped on a re-run; to
start over, re-fetch the originals with tools/fetch_tiles.py.
"""
import glob
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import mvt  # noqa: E402

GEO = os.path.join(ROOT, "src", "js", "data", "geodata.js")
SITES = os.path.join(HERE, "osm", "facility_sites.json")

LANDUSE_CLASS = {
    "commercial": "commercial", "retail": "commercial",
    "industrial": "industrial", "railway": "industrial", "garages": "industrial", "quarry": "industrial", "construction": "industrial",
    "hospital": "hospital",
    "school": "civic", "university": "civic", "college": "civic", "kindergarten": "civic", "library": "civic",
    "religious": "civic", "stadium": "civic", "bus_station": "civic", "military": "civic",
    "residential": "residential", "neighbourhood": "residential",
}
# Hero-model site radius (m) per facility kind: buildings whose centroid lies inside, or
# that contain the facility point, are lifted out of the tiles. Weather stations are never
# lifted; one inside a building is mounted on its roof instead.
SITE_R = {"hospital": 20, "ems": 18, "pump": 15, "power": 28, "traffic": 8, "drainage": 10, "weather": 0}
MAX_CONTAIN_AREA = 12000  # m²: never lift a whole campus slab just because the point is inside
# Height ~ a + b·ln(area), clamped (m), per class.
HEIGHT_MODEL = {
    "residential": (-5.4, 2.58, 4.5, 18), "commercial": (-0.7, 1.09, 4.5, 12), "industrial": (-2.8, 1.5, 5, 13),
    "hospital": (-22.0, 5.0, 8, 36), "civic": (-6.9, 2.23, 5, 15),
}


def kind_of(f):
    if f["subtype"] == "EMS station":
        return "ems"
    if f["subtype"] == "Pumping station":
        return "pump"
    return f["type"]


def load_geo():
    src = open(GEO, encoding="utf-8").read()
    return json.loads(src[src.index("{"):src.rindex("}") + 1])


def metres(a, b):
    kx = 111320 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110540)


def pip(x, y, ring):
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1:
            inside = not inside
    return inside


def centroid(ring):
    a = cx = cy = 0.0
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
        c = x1 * y2 - x2 * y1
        a += c
        cx += (x1 + x2) * c
        cy += (y1 + y2) * c
    if abs(a) < 1e-9:
        return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    return cx / (3 * a), cy / (3 * a)


def smooth_noise(lon, lat):
    """Value noise in [0, 1) with ~60 m cells: nearby buildings vary, zooms agree."""
    gx, gy = lon / 0.0006, lat / 0.0005
    x0, y0 = math.floor(gx), math.floor(gy)
    fx, fy = gx - x0, gy - y0
    h = lambda i, j: (math.sin(i * 127.1 + j * 311.7) * 43758.5453) % 1  # noqa: E731
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a = h(x0, y0) + (h(x0 + 1, y0) - h(x0, y0)) * sx
    b = h(x0, y0 + 1) + (h(x0 + 1, y0 + 1) - h(x0, y0 + 1)) * sx
    return a + (b - a) * sy


def infer_height(cls, area, lon, lat):
    a, b, lo, hi = HEIGHT_MODEL.get(cls, HEIGHT_MODEL["residential"])
    h = min(hi, max(lo, a + b * math.log(max(area, 1.0))))
    return round(h * (0.88 + 0.24 * smooth_noise(lon, lat)) * 2) / 2


def clip_square(ring, ext):
    """Sutherland-Hodgman clip of a ring to the tile square [0, ext]^2."""
    def clip(pts, inside, inter):
        out = []
        for i in range(len(pts)):
            a, b = pts[i - 1], pts[i]
            if inside(b):
                if not inside(a):
                    out.append(inter(a, b))
                out.append(b)
            elif inside(a):
                out.append(inter(a, b))
        return out
    pts = ring[:-1] if ring[0] == ring[-1] else list(ring)
    for axis, bound, keep_lo in ((0, 0, False), (0, ext, True), (1, 0, False), (1, ext, True)):
        if not pts:
            break
        ins = (lambda p, ax=axis, bd=bound, lo=keep_lo: p[ax] <= bd if lo else p[ax] >= bd)

        def inter(a, b, ax=axis, bd=bound):
            t = (bd - a[ax]) / ((b[ax] - a[ax]) or 1e-12)
            return (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
        pts = clip(pts, ins, inter)
    return pts + pts[:1] if len(pts) >= 3 else []


class UnionFind:
    def __init__(self, n):
        self.p = list(range(n))

    def find(self, a):
        while self.p[a] != a:
            self.p[a] = self.p[self.p[a]]
            a = self.p[a]
        return a

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[rb] = ra


def main():
    geo = load_geo()
    F = geo["facilities"]
    sites = {i: {"fi": i, "id": f["id"], "kind": kind_of(f), "footprints": []} for i, f in enumerate(F)}
    rewritten = skipped = 0
    for z in (13, 14):
        tiles = []
        pieces = []  # one record per polygon piece in this zoom
        vertex_owner = {}
        for path in sorted(glob.glob(os.path.join(ROOT, "data", "tiles", str(z), "*", "*.pbf"))):
            tx, ty = int(path.split(os.sep)[-2]), int(os.path.basename(path)[:-4])
            data = open(path, "rb").read()
            layers = mvt.split_layers(data)
            names = [n for n, _ in layers]
            if "building" not in names:
                continue
            B = mvt.read_layer(dict(layers)["building"])
            if "class" in B["keys"]:
                skipped += 1
                continue
            ext = B["extent"]
            lat0 = mvt.tile_to_lnglat(z, tx, ty, ext / 2, ext / 2, ext)[1]
            mpu = 156543.03 * math.cos(math.radians(lat0)) / 2 ** z * 256 / ext
            landuse = []
            if "landuse" in names:
                LU = mvt.read_layer(dict(layers)["landuse"])
                for f in LU["features"]:
                    props = {LU["keys"][f["tags"][i]]: mvt.value_of(LU, f["tags"][i + 1]) for i in range(0, len(f["tags"]), 2)}
                    c = LANDUSE_CLASS.get(props.get("class"))
                    if c and f["type"] == 3:
                        for poly in mvt.polygons(f["rings"]):
                            xs, ys = [p[0] for p in poly[0]], [p[1] for p in poly[0]]
                            landuse.append((min(xs), min(ys), max(xs), max(ys), poly, c))
            near = []
            n2 = 2 ** z
            for i, f in enumerate(F):
                px = ((f["lngLat"][0] + 180) / 360 * n2 - tx) * ext
                py = ((1 - math.asinh(math.tan(math.radians(f["lngLat"][1]))) / math.pi) / 2 * n2 - ty) * ext
                if -ext * 0.2 < px < ext * 1.2 and -ext * 0.2 < py < ext * 1.2:
                    near.append((i, px, py, SITE_R[kind_of(f)] / mpu))
            tile = {"path": path, "layers": layers, "ext": ext, "version": B["version"], "tx": tx, "ty": ty, "pieces": []}
            tiles.append(tile)
            for feat in B["features"]:
                props = {B["keys"][feat["tags"][i]]: mvt.value_of(B, feat["tags"][i + 1]) for i in range(0, len(feat["tags"]), 2)}
                for poly in mvt.polygons(feat["rings"]):
                    cx, cy = centroid(poly[0])
                    area = abs(mvt.ring_area2(poly[0])) / 2 * mpu * mpu
                    cls = None
                    for (x0, y0, x1, y1, lpoly, c) in landuse:
                        if x0 <= cx <= x1 and y0 <= cy <= y1 and pip(cx, cy, lpoly[0]) and not any(pip(cx, cy, hole) for hole in lpoly[1:]):
                            cls = c
                            break
                    lift, roof_for = None, []
                    for (i, px, py, r) in near:
                        inside = area <= MAX_CONTAIN_AREA and pip(px, py, poly[0])
                        if sites[i]["kind"] == "weather":
                            if inside:
                                roof_for.append(i)
                        elif math.hypot(cx - px, cy - py) <= r or inside:
                            lift = i
                    k = len(pieces)
                    rec = {"tile": tile, "poly": poly, "props": props, "area": area, "cls": cls, "lift": lift, "roof": roof_for,
                           "ll": mvt.tile_to_lnglat(z, tx, ty, cx, cy, ext)}
                    pieces.append(rec)
                    tile["pieces"].append(k)
                    # Pieces that reach into the tile buffer are joined to their neighbours
                    # through the original vertices both tiles carry.
                    ring = poly[0]
                    # (Clip points at the buffer edge exist in one tile only, so they never match.)
                    if any(not (0 <= x <= ext and 0 <= y <= ext) for x, y in ring):
                        for x, y in ring:
                            vertex_owner.setdefault((tx * ext + x, ty * ext + y), []).append(k)
        if not tiles:
            continue
        uf = UnionFind(len(pieces))
        for owners in vertex_owner.values():
            for k in owners[1:]:
                if pieces[k]["tile"] is not pieces[owners[0]]["tile"]:
                    uf.union(owners[0], k)
        groups = {}
        for k in range(len(pieces)):
            groups.setdefault(uf.find(k), []).append(k)
        # Decide class, height and lifting once per building.
        for members in groups.values():
            big = max(members, key=lambda k: pieces[k]["area"])
            P = pieces[big]
            cls = P["cls"] or ("commercial" if P["props"].get("render_height", 5) >= 30 else "residential")
            h0, mh0 = P["props"].get("render_height", 5), P["props"].get("render_min_height", 0)
            if h0 == 5 and mh0 == 0:
                h, inferred = infer_height(cls, P["area"], *P["ll"]), 1
            else:
                h, inferred = h0, 0
            lift = next((pieces[k]["lift"] for k in members if pieces[k]["lift"] is not None), None)
            for k in members:
                pieces[k].update(cls_final=cls, h=h, mh=mh0, inferred=inferred, lift_final=lift)
                for i in pieces[k]["roof"]:
                    if z == 14:
                        sites[i]["roof"] = max(sites[i].get("roof", 0), h)
            if lift is not None and z == 14:
                for k in members:
                    t = pieces[k]["tile"]
                    rings = [clip_square(r, t["ext"]) for r in pieces[k]["poly"]]
                    if not rings[0]:
                        continue
                    sites[lift]["footprints"].append({
                        "g": [[[round(c, 6) for c in mvt.tile_to_lnglat(14, t["tx"], t["ty"], p[0], p[1], t["ext"])] for p in r] for r in rings if r],
                        "h": h, "mh": mh0, "c": cls, "a": round(P["area"]),
                    })
        for tile in tiles:
            feats = {}
            for k in tile["pieces"]:
                P = pieces[k]
                if P["lift_final"] is not None:
                    continue
                key = (P["h"], P["mh"], P["props"].get("hide_3d"), P["cls_final"], P["inferred"])
                feats.setdefault(key, []).append(P["poly"])
            out_feats = [{"props": {"render_height": k[0], "render_min_height": k[1], "hide_3d": k[2], "class": k[3], "inferred": k[4] or None},
                          "polys": polys} for k, polys in feats.items()]
            raw = mvt.write_layer("building", tile["ext"], tile["version"], out_feats)
            with open(tile["path"], "wb") as fh:
                fh.write(mvt.join_layers([(n, raw if n == "building" else r) for n, r in tile["layers"]]))
            rewritten += 1
        joined = sum(1 for m in groups.values() if len(m) > 1)
        print(f"z{z}: {len(tiles)} tiles, {len(pieces)} pieces, {joined} buildings reassembled across tiles", flush=True)

    if rewritten or not os.path.exists(SITES):
        roads = [seg["g"] for seg in geo["corridors"]]
        for s in sites.values():
            fps = sorted(s["footprints"], key=lambda f: -f["a"])
            s["heading"] = principal_axis(fps[0]["g"][0]) if fps else road_bearing(F[s["fi"]]["lngLat"], roads)
        with open(SITES, "w") as fh:
            json.dump(list(sites.values()), fh, separators=(",", ":"))
        n = sum(len(s["footprints"]) for s in sites.values())
        print(f"lifted {n} footprint pieces at {sum(1 for s in sites.values() if s['footprints'])} facilities -> {os.path.relpath(SITES, ROOT)}")
    print(f"rewrote {rewritten} tiles, skipped {skipped} already enriched")


def road_bearing(p, roads):
    """Bearing (0-180°) of the nearest monitored road segment, 0 if none within 400 m."""
    best, brg = 400.0, 0.0
    kx = 111320 * math.cos(math.radians(p[1]))
    for g in roads:
        for a, b in zip(g, g[1:]):
            d = metres(p, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2))
            if d < best:
                best, brg = d, math.degrees(math.atan2((b[0] - a[0]) * kx, (b[1] - a[1]) * 110540)) % 180
    return round(brg, 1)


def principal_axis(ring):
    """Bearing (0-180°, clockwise from north) of a footprint's long axis (min-area rectangle)."""
    kx = 111320 * math.cos(math.radians(ring[0][1]))
    pts = [((p[0] - ring[0][0]) * kx, (p[1] - ring[0][1]) * 110540) for p in ring]
    best, ang = None, 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        theta = math.atan2(y2 - y1, x2 - x1)
        c, s_ = math.cos(theta), math.sin(theta)
        us = [x * c + y * s_ for x, y in pts]
        vs = [-x * s_ + y * c for x, y in pts]
        area = (max(us) - min(us)) * (max(vs) - min(vs))
        if best is None or area < best:
            best = area
            ang = theta if (max(us) - min(us)) >= (max(vs) - min(vs)) else theta + math.pi / 2
    return round((90 - math.degrees(ang)) % 180, 1)


if __name__ == "__main__":
    main()

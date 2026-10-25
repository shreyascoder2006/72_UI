"""Build src/js/data/geodata.js from the baked OpenMapTiles tiles and the OSM facility pull.

    python3 tools/build_data.py

Outputs one classic script that sets window.TWIN_GEO. Everything geometric in it is
derived from real OpenStreetMap data:
  * facility points (OSM features, or exact creek x road / road x road crossings)
  * dependency routes, found with Dijkstra on the street graph or down the waterway graph
  * the monitored corridor network and drainage network, chunked for per-segment styling
  * stormwater ponds, substations and their Voronoi service areas
"""
import glob
import heapq
import json
import math
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import mvt  # noqa: E402
import spec  # noqa: E402

TILES = os.path.join(ROOT, "data", "tiles", "14")
OSM_FACILITIES = os.path.join(HERE, "osm", "facilities_raw.json")
OUT = os.path.join(ROOT, "src", "js", "data", "geodata.js")

LON0, LAT0 = spec.CENTER
KX = 111320.0 * math.cos(math.radians(LAT0))
KY = 110540.0


def to_m(p):
    return ((p[0] - LON0) * KX, (p[1] - LAT0) * KY)


def to_ll(q):
    return (round(q[0] / KX + LON0, 6), round(q[1] / KY + LAT0, 6))


def dist(a, b):
    ax, ay = to_m(a)
    bx, by = to_m(b)
    return math.hypot(ax - bx, ay - by)


def length(line):
    return sum(dist(a, b) for a, b in zip(line, line[1:]))


def in_extent(p, pad=0.0):
    w, s, e, n = spec.EXTENT
    return w - pad <= p[0] <= e + pad and s - pad <= p[1] <= n + pad


# ── Douglas-Peucker in metres ────────────────────────────────────────────────
def simplify(line, tol):
    if len(line) < 3:
        return line
    if tuple(line[0]) == tuple(line[-1]):
        # A closed ring has a zero-length base segment; split it at the far point.
        far = max(range(len(line)), key=lambda k: dist(line[0], line[k]))
        if far == 0:
            return line
        return simplify(line[:far + 1], tol)[:-1] + simplify(line[far:], tol)
    pts = [to_m(p) for p in line]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        (x1, y1), (x2, y2) = pts[i], pts[j]
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy) or 1e-9
        best, bi = -1, -1
        for k in range(i + 1, j):
            x0, y0 = pts[k]
            d = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / L
            if d > best:
                best, bi = d, k
        if best > tol:
            keep[bi] = True
            stack += [(i, bi), (bi, j)]
    return [p for p, k in zip(line, keep) if k]


def chunk(line, max_len):
    """Split a polyline into pieces no longer than max_len metres."""
    out, cur, acc = [], [line[0]], 0.0
    for a, b in zip(line, line[1:]):
        d = dist(a, b)
        if acc + d > max_len and len(cur) > 1:
            out.append(cur)
            cur, acc = [a], 0.0
        cur.append(b)
        acc += d
    if len(cur) > 1:
        out.append(cur)
    return out


def r5(line):
    return [[round(p[0], 5), round(p[1], 5)] for p in line]


# ── Tile decoding ────────────────────────────────────────────────────────────
def load_features():
    feats = defaultdict(list)
    for path in sorted(glob.glob(os.path.join(TILES, "*", "*.pbf"))):
        x = int(path.split(os.sep)[-2])
        y = int(os.path.basename(path)[:-4])
        layers = mvt.decode(open(path, "rb").read(), 14, x, y,
                            layers={"waterway", "transportation", "transportation_name", "water"})
        for k, v in layers.items():
            feats[k].extend(v)
    return feats


def road_name(p):
    if p.get("class") == "motorway" and p.get("ref") == "440":
        return "I-440"
    if p.get("class") == "motorway" and p.get("ref") == "40":
        return "I-40"
    return p.get("name")


# ── Graph with snapped nodes ─────────────────────────────────────────────────
class Graph:
    SNAP = 2.0  # metres

    def __init__(self, directed=False):
        self.directed = directed
        self.nodes = []          # metre coords
        self.cells = defaultdict(list)
        self.adj = defaultdict(list)

    def node(self, p):
        x, y = to_m(p)
        cx, cy = int(x // self.SNAP), int(y // self.SNAP)
        for i in range(cx - 1, cx + 2):
            for j in range(cy - 1, cy + 2):
                for n in self.cells[(i, j)]:
                    nx, ny = self.nodes[n]
                    if (nx - x) ** 2 + (ny - y) ** 2 <= self.SNAP ** 2:
                        return n
        self.nodes.append((x, y))
        n = len(self.nodes) - 1
        self.cells[(cx, cy)].append(n)
        return n

    def add_line(self, line, factor=1.0, tag=None):
        prev = None
        for p in line:
            n = self.node(p)
            if prev is not None and prev != n:
                (ax, ay), (bx, by) = self.nodes[prev], self.nodes[n]
                w = math.hypot(ax - bx, ay - by) * factor
                self.adj[prev].append((n, w, tag))
                if not self.directed:
                    self.adj[n].append((prev, w, tag))
            prev = n

    def nearest(self, p, accept=None):
        x, y = to_m(p)
        best, bn = 1e18, None
        for n, (nx, ny) in enumerate(self.nodes):
            if not self.adj.get(n):
                continue
            if accept and not accept(n):
                continue
            d = (nx - x) ** 2 + (ny - y) ** 2
            if d < best:
                best, bn = d, n
        return bn, math.sqrt(best)

    def route(self, a, b):
        dist_, prev = {a: 0.0}, {}
        pq = [(0.0, a)]
        while pq:
            d, u = heapq.heappop(pq)
            if u == b:
                break
            if d > dist_.get(u, 1e18):
                continue
            for v, w, _ in self.adj[u]:
                nd = d + w
                if nd < dist_.get(v, 1e18):
                    dist_[v] = nd
                    prev[v] = u
                    heapq.heappush(pq, (nd, v))
        if b not in dist_:
            return None
        path, u = [b], b
        while u != a:
            u = prev[u]
            path.append(u)
        return [to_ll(self.nodes[n]) for n in reversed(path)]


ROAD_COST = {"motorway": 0.55, "trunk": 0.65, "primary": 0.75, "secondary": 0.85,
             "tertiary": 0.95, "minor": 1.25}


# ── Crossings ────────────────────────────────────────────────────────────────
def seg_x(a, b, c, d):
    (x1, y1), (x2, y2), (x3, y3), (x4, y4) = a, b, c, d
    den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if den == 0:
        return None
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
    u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den
    if 0 <= t <= 1 and 0 <= u <= 1:
        return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))
    return None


def crossings(lines_a, lines_b):
    pts = []
    for la in lines_a:
        for lb in lines_b:
            for a, b in zip(la, la[1:]):
                for c, d in zip(lb, lb[1:]):
                    if max(a[0], b[0]) < min(c[0], d[0]) or max(c[0], d[0]) < min(a[0], b[0]):
                        continue
                    if max(a[1], b[1]) < min(c[1], d[1]) or max(c[1], d[1]) < min(a[1], b[1]):
                        continue
                    p = seg_x(a, b, c, d)
                    if p:
                        pts.append(p)
    return pts


# ── Voronoi service areas (half-plane clipping in metres) ───────────────────
def clip_halfplane(poly, px, py, nx, ny):
    """Keep the part of poly where (q - p) . n <= 0."""
    out = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        da = (a[0] - px) * nx + (a[1] - py) * ny
        db = (b[0] - px) * nx + (b[1] - py) * ny
        if da <= 0:
            out.append(a)
        if (da <= 0) != (db <= 0):
            t = da / (da - db)
            out.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])))
    return out


def voronoi(sites):
    w, s, e, n = spec.EXTENT
    box = [to_m((w, s)), to_m((e, s)), to_m((e, n)), to_m((w, n))]
    ms = [to_m(p) for p in sites]
    cells = []
    for i, (xi, yi) in enumerate(ms):
        poly = box[:]
        for j, (xj, yj) in enumerate(ms):
            if i == j:
                continue
            mx, my = (xi + xj) / 2, (yi + yj) / 2
            poly = clip_halfplane(poly, mx, my, xj - xi, yj - yi)
            if not poly:
                break
        ring = [to_ll(q) for q in poly]
        if ring:
            ring.append(ring[0])
        cells.append(ring)
    return cells


def polygon_area_m2(ring):
    pts = [to_m(p) for p in ring]
    return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:] + pts[:1]))) / 2


def main():
    print("decoding tiles…")
    feats = load_features()

    # Named line collections
    creeks = defaultdict(list)
    for f in feats["waterway"]:
        if f["type"] == 2 and f["props"].get("name"):
            creeks[f["props"]["name"]].extend(f["coords"])
    roads = defaultdict(list)
    for f in feats["transportation_name"]:
        if f["type"] == 2:
            nm = road_name(f["props"])
            if nm:
                roads[nm].extend(f["coords"])

    # ── Facilities ──
    osm = json.load(open(OSM_FACILITIES))["elements"]
    substations = []
    for e in osm:
        t = e.get("tags", {})
        c = e.get("center") or {"lat": e.get("lat"), "lon": e.get("lon")}
        if t.get("power") == "substation":
            substations.append(dict(lngLat=[round(c["lon"], 5), round(c["lat"], 5)],
                                    voltage=t.get("voltage", ""), kind=t.get("substation", "")))

    facilities = []
    for f in spec.FACILITIES:
        at = f["at"]
        if at[0] in ("osm", "pt"):
            ll = (at[2], at[1])
        else:
            if at[0] == "cross":
                A, B = creeks.get(at[1], []), roads.get(at[2], [])
            else:
                A, B = roads.get(at[1], []), roads.get(at[2], [])
            pts = crossings(A, B)
            if not pts:
                raise SystemExit(f"{f['id']}: no crossing of {at[1]} and {at[2]}")
            hint = (at[4], at[3])
            ll = min(pts, key=lambda p: dist(p, hint))
            if dist(ll, hint) > 400:
                raise SystemExit(f"{f['id']}: nearest crossing is {dist(ll, hint):.0f} m from the hint")
        rec = {k: v for k, v in f.items() if k not in ("at",)}
        rec["lngLat"] = [round(ll[0], 5), round(ll[1], 5)]
        rec["source"] = {"osm": "OpenStreetMap feature", "pt": "Modeled sensor site",
                         "cross": "Creek x road crossing (OSM)", "road": "Road x road crossing (OSM)"}[at[0]]
        facilities.append(rec)
    fidx = {f["id"]: i for i, f in enumerate(facilities)}
    print(f"facilities: {len(facilities)}")

    # ── Graphs ──
    print("building street graph…")
    G = Graph()
    for f in feats["transportation"]:
        cls = f["props"].get("class")
        if f["type"] == 2 and cls in ROAD_COST:
            for line in f["coords"]:
                G.add_line(line, ROAD_COST[cls], cls)
    major = {"motorway", "trunk", "primary", "secondary", "tertiary"}
    major_nodes = set()
    for u, lst in G.adj.items():
        if any(tag in major for _, _, tag in lst):
            major_nodes.add(u)
    print(f"  nodes={len(G.nodes)}")

    print("building waterway graph…")
    W = Graph(directed=True)
    WU = Graph()
    for f in feats["waterway"]:
        if f["type"] == 2:
            for line in f["coords"]:
                W.add_line(line)
                WU.add_line(line)

    def snap_road(p):
        n, d = G.nearest(p, accept=lambda n: n in major_nodes)
        return n

    def snap_creek(g, fac):
        creek = fac.get("creek")
        n, _ = g.nearest(fac["lngLat"])
        return n

    edges = []
    cache_road = {}
    for (a, b, w, lag, mech, kind) in spec.EDGES:
        fa, fb = facilities[fidx[a]], facilities[fidx[b]]
        path = None
        if kind == "road":
            na = cache_road.setdefault(a, snap_road(fa["lngLat"]))
            nb = cache_road.setdefault(b, snap_road(fb["lngLat"]))
            path = G.route(na, nb)
        elif kind == "creek":
            path = W.route(snap_creek(W, fa), snap_creek(W, fb)) or WU.route(snap_creek(WU, fa), snap_creek(WU, fb))
        if path:
            path = simplify([tuple(fa["lngLat"])] + path + [tuple(fb["lngLat"])], 4.0)
        else:
            path = [tuple(fa["lngLat"]), tuple(fb["lngLat"])]
        edges.append(dict(from_=a, to=b, w=w, lag=lag, mechanism=mech, kind=kind,
                          path=r5(path), km=round(length(path) / 1000, 2)))
    print(f"edges: {len(edges)} ({sum(e['kind'] == 'road' for e in edges)} routed on streets)")

    # ── Corridor network (traffic layer) ──
    traffic_ids = [i for i, f in enumerate(facilities) if f["type"] == "traffic"]
    drain_ids = [i for i, f in enumerate(facilities) if f["type"] == "drainage"]
    corridors = []
    for f in feats["transportation_name"]:
        cls = f["props"].get("class")
        if f["type"] != 2 or cls not in spec.CORRIDOR_CLASSES:
            continue
        nm = road_name(f["props"]) or f["props"].get("ref") or ""
        for line in f["coords"]:
            line = simplify(line, 3.0)
            for seg in chunk(line, 650):
                if length(seg) < 25:
                    continue
                mid = seg[len(seg) // 2]
                if not in_extent(mid):
                    continue
                inf = []
                for i in traffic_ids:
                    d = dist(mid, facilities[i]["lngLat"])
                    if d < 2600:
                        inf.append((i, math.exp(-d / 900)))
                for i in drain_ids:
                    d = dist(mid, facilities[i]["lngLat"])
                    if d < 450:
                        inf.append((i, 1.2 * math.exp(-d / 220)))
                inf.sort(key=lambda t: -t[1])
                corridors.append(dict(n=nm, c=cls, g=r5(seg), i=[[i, round(w, 3)] for i, w in inf[:3]]))
    print(f"corridor segments: {len(corridors)}")

    # ── Drainage network ──
    named_gauges = defaultdict(list)
    for i in drain_ids:
        if facilities[i].get("creek"):
            named_gauges[facilities[i]["creek"]].append(i)
    network = []
    for f in feats["waterway"]:
        if f["type"] != 2:
            continue
        nm = f["props"].get("name")
        cls = f["props"].get("class")
        if not nm and cls not in ("stream", "river", "canal"):
            continue
        for line in f["coords"]:
            if not nm and length(line) < 220:
                continue
            line = simplify(line, 4.0)
            for seg in chunk(line, 700):
                mid = seg[len(seg) // 2]
                if not in_extent(mid):
                    continue
                inf = []
                for i in drain_ids:
                    d = dist(mid, facilities[i]["lngLat"])
                    same = nm and facilities[i].get("creek") == nm
                    if same and d < 4500:
                        inf.append((i, math.exp(-d / 1800)))
                    elif d < 1800:
                        inf.append((i, 0.45 * math.exp(-d / 700)))
                inf.sort(key=lambda t: -t[1])
                network.append(dict(n=nm or "", m=1 if nm else 0, g=r5(seg),
                                    i=[[i, round(w, 3)] for i, w in inf[:2]]))
    print(f"drainage segments: {len(network)}")

    # ── Stormwater ponds ──
    basins = []
    for f in feats["water"]:
        if f["type"] != 3 or f["props"].get("class") != "pond":
            continue
        for ring in f["coords"]:
            if len(ring) < 4:
                continue
            a = polygon_area_m2(ring)
            if a < 1800 or a > 250000:
                continue
            ring = simplify(ring, 2.5)
            if len(ring) < 4 or not in_extent(ring[0]):
                continue
            c = ring[0]
            near = min(drain_ids, key=lambda i: dist(c, facilities[i]["lngLat"]))
            dn = dist(c, facilities[near]["lngLat"])
            basins.append(dict(g=r5(ring), i=[[near, round(math.exp(-dn / 1500), 3)]]))
    print(f"basins: {len(basins)}")

    # ── Substations and service areas ──
    cells = voronoi([tuple(s["lngLat"]) for s in substations])
    for s, cell in zip(substations, cells):
        s["cell"] = r5(cell)
        near = min((i for i, f in enumerate(facilities) if f["type"] == "power"),
                   key=lambda i: dist(tuple(s["lngLat"]), facilities[i]["lngLat"]))
        s["fac"] = near if dist(tuple(s["lngLat"]), facilities[near]["lngLat"]) < 30 else None
    print(f"substations: {len(substations)}")

    out = dict(
        city="Raleigh",
        region="North Carolina",
        extent=spec.EXTENT,
        center=spec.CENTER,
        t0=spec.T0_ISO,
        facilities=facilities,
        edges=[{("from" if k == "from_" else k): v for k, v in e.items()} for e in edges],
        corridors=corridors,
        drainage=network,
        basins=basins,
        substations=substations,
        districts=[dict(name=n, lngLat=[lon, lat]) for n, lat, lon in spec.DISTRICTS],
        attribution="© OpenStreetMap contributors · © OpenMapTiles · OpenFreeMap",
    )
    js = ("/* Generated by tools/build_data.py from OpenStreetMap data (ODbL). Do not edit by hand. */\n"
          "window.TWIN_GEO = " + json.dumps(out, separators=(",", ":"), ensure_ascii=False) + ";\n")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(js)
    print(f"wrote {OUT} ({len(js) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()

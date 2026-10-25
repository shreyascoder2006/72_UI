"""Download the OpenMapTiles-schema vector tiles (OpenFreeMap, OpenStreetMap data) for the twin extent.

    python3 tools/fetch_tiles.py data/tiles
"""
import math, os, sys, gzip, urllib.request, concurrent.futures as cf

OUT = sys.argv[1]
TPL = "https://tiles.openfreemap.org/planet/20261018_080001_pt/{z}/{x}/{y}.pbf"
W, S, E, N = -78.745, 35.728, -78.548, 35.915     # Raleigh twin extent
ZOOMS = range(10, 15)

def tile(lat, lon, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y

jobs = []
for z in ZOOMS:
    x0, y0 = tile(N, W, z); x1, y1 = tile(S, E, z)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            jobs.append((z, x, y))
print("tiles to fetch:", len(jobs), flush=True)

def fetch(j):
    z, x, y = j
    p = os.path.join(OUT, str(z), str(x), f"{y}.pbf")
    if os.path.exists(p) and os.path.getsize(p) > 0:
        return j, os.path.getsize(p), "cached"
    os.makedirs(os.path.dirname(p), exist_ok=True)
    req = urllib.request.Request(TPL.format(z=z, x=x, y=y), headers={"Accept-Encoding": "gzip", "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) raleigh-twin-builder/1.0"})
    for a in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                b = r.read()
                if r.headers.get("Content-Encoding") == "gzip" or b[:2] == b"\x1f\x8b":
                    b = gzip.decompress(b)
            with open(p, "wb") as f: f.write(b)
            return j, len(b), "ok"
        except Exception as ex:
            err = ex
    return j, 0, f"FAIL {err}"

tot = 0
with cf.ThreadPoolExecutor(4) as ex:
    for j, n, st in ex.map(fetch, jobs):
        tot += n
        if st.startswith("FAIL"): print(j, st, flush=True)
print(f"done bytes={tot} ({tot/1e6:.1f} MB)", flush=True)

"""Minimal, dependency-free Mapbox Vector Tile (MVT v2) decoder.

Only what the data build needs: layers, feature tags and geometry decoded to
lon/lat, with lines clipped to the tile's own square so segments from adjacent
tiles meet cleanly at the seams instead of overlapping in the tile buffer.
"""
import math
import struct

GEOM_POINT, GEOM_LINE, GEOM_POLY = 1, 2, 3


def _varint(buf, i):
    shift = result = 0
    while True:
        b = buf[i]
        i += 1
        result |= (b & 0x7F) << shift
        if not b & 0x80:
            return result, i
        shift += 7


def _fields(buf):
    """Yield (field_number, wire_type, value) for one protobuf message."""
    i, n = 0, len(buf)
    while i < n:
        key, i = _varint(buf, i)
        field, wire = key >> 3, key & 7
        if wire == 0:
            val, i = _varint(buf, i)
        elif wire == 1:
            val = buf[i:i + 8]
            i += 8
        elif wire == 2:
            ln, i = _varint(buf, i)
            val = buf[i:i + ln]
            i += ln
        elif wire == 5:
            val = buf[i:i + 4]
            i += 4
        else:
            raise ValueError(f"unsupported wire type {wire}")
        yield field, wire, val


def _packed(buf):
    out, i = [], 0
    while i < len(buf):
        v, i = _varint(buf, i)
        out.append(v)
    return out


def _zigzag(n):
    return (n >> 1) ^ -(n & 1)


def _value(buf):
    for field, wire, val in _fields(buf):
        if field == 1:
            return bytes(val).decode("utf-8", "replace")
        if field == 2:
            return struct.unpack("<f", val)[0]
        if field == 3:
            return struct.unpack("<d", val)[0]
        if field in (4, 5):
            return val
        if field == 6:
            return _zigzag(val)
        if field == 7:
            return bool(val)
    return None


def _rings(cmds):
    """Decode a geometry command stream into a list of integer-coordinate rings/lines."""
    parts, cur, x, y, i = [], None, 0, 0, 0
    while i < len(cmds):
        cmd = cmds[i]
        i += 1
        cid, count = cmd & 7, cmd >> 3
        if cid == 7:  # ClosePath
            if cur:
                cur.append(cur[0])
            continue
        for _ in range(count):
            x += _zigzag(cmds[i])
            y += _zigzag(cmds[i + 1])
            i += 2
            if cid == 1:  # MoveTo
                cur = [(x, y)]
                parts.append(cur)
            else:  # LineTo
                cur.append((x, y))
    return parts


def _clip_line(pts, ext):
    """Liang-Barsky clip of a polyline to [0, ext]^2; returns a list of pieces."""
    pieces, cur = [], []

    def inside(p):
        return 0 <= p[0] <= ext and 0 <= p[1] <= ext

    for a, b in zip(pts, pts[1:]):
        t0, t1 = 0.0, 1.0
        dx, dy = b[0] - a[0], b[1] - a[1]
        ok = True
        for p, q in ((-dx, a[0]), (dx, ext - a[0]), (-dy, a[1]), (dy, ext - a[1])):
            if p == 0:
                if q < 0:
                    ok = False
                    break
            else:
                r = q / p
                if p < 0:
                    t0 = max(t0, r)
                else:
                    t1 = min(t1, r)
        if not ok or t0 > t1:
            if len(cur) > 1:
                pieces.append(cur)
            cur = []
            continue
        pa = (a[0] + t0 * dx, a[1] + t0 * dy)
        pb = (a[0] + t1 * dx, a[1] + t1 * dy)
        if not cur:
            cur = [pa]
        cur.append(pb)
        if t1 < 1.0 or not inside(b):
            pieces.append(cur)
            cur = []
    if len(cur) > 1:
        pieces.append(cur)
    return pieces


def tile_to_lnglat(z, tx, ty, px, py, ext):
    n = 2.0 ** z
    lon = (tx + px / ext) / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty + py / ext) / n))))
    return round(lon, 6), round(lat, 6)


def decode(data, z, x, y, layers=None, clip=True):
    """Return {layer_name: [ {type, props, coords} ]} with coords in lon/lat.

    Lines come back as a list of polylines (clipped to the tile when clip=True),
    polygons as a list of rings, points as a list of [lon, lat].
    """
    out = {}
    for field, _, lbuf in _fields(memoryview(data)):
        if field != 3:
            continue
        name, feats, keys, vals, ext = None, [], [], [], 4096
        for f2, _, v2 in _fields(lbuf):
            if f2 == 1:
                name = bytes(v2).decode()
            elif f2 == 2:
                feats.append(v2)
            elif f2 == 3:
                keys.append(bytes(v2).decode())
            elif f2 == 4:
                vals.append(_value(v2))
            elif f2 == 5:
                ext = v2
        if layers and name not in layers:
            continue
        res = out.setdefault(name, [])
        for fbuf in feats:
            tags, gtype, geom = [], 0, []
            for f3, _, v3 in _fields(fbuf):
                if f3 == 2:
                    tags = _packed(v3)
                elif f3 == 3:
                    gtype = v3
                elif f3 == 4:
                    geom = _packed(v3)
            props = {keys[tags[k]]: vals[tags[k + 1]] for k in range(0, len(tags), 2)}
            parts = _rings(geom)
            if gtype == GEOM_LINE and clip:
                clipped = []
                for p in parts:
                    clipped.extend(_clip_line(p, ext))
                parts = clipped
            coords = [[tile_to_lnglat(z, x, y, px, py, ext) for px, py in part] for part in parts]
            if gtype == GEOM_POINT:
                coords = [c[0] for c in coords]
            res.append({"type": gtype, "props": props, "coords": coords})
    return out


# ── Raw editing: re-encode one layer, copy the rest byte for byte ─────────────

def _varint_bytes(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def _key(field, wire):
    return _varint_bytes((field << 3) | wire)


def _len_field(field, payload):
    return _key(field, 2) + _varint_bytes(len(payload)) + payload


def _packed_bytes(values):
    return b"".join(_varint_bytes(v) for v in values)


def _zz(n):
    return (n << 1) ^ (n >> 63)


def split_layers(data):
    """[(name, raw_layer_bytes)] in tile order."""
    out = []
    for field, _, lbuf in _fields(memoryview(data)):
        if field != 3:
            continue
        name = None
        for f2, _, v2 in _fields(lbuf):
            if f2 == 1:
                name = bytes(v2).decode()
                break
        out.append((name, bytes(lbuf)))
    return out


def join_layers(layers):
    return b"".join(_len_field(3, raw) for _, raw in layers)


def read_layer(raw):
    """Decode a layer keeping integer geometry: features carry rings in tile units."""
    layer = {"name": None, "extent": 4096, "version": 2, "keys": [], "values": [], "features": []}
    for f2, _, v2 in _fields(memoryview(raw)):
        if f2 == 1:
            layer["name"] = bytes(v2).decode()
        elif f2 == 2:
            fid, tags, gtype, geom = None, [], 0, []
            for f3, _, v3 in _fields(v2):
                if f3 == 1:
                    fid = v3
                elif f3 == 2:
                    tags = _packed(v3)
                elif f3 == 3:
                    gtype = v3
                elif f3 == 4:
                    geom = _packed(v3)
            layer["features"].append({"id": fid, "tags": tags, "type": gtype, "rings": _rings(geom)})
        elif f2 == 3:
            layer["keys"].append(bytes(v2).decode())
        elif f2 == 4:
            layer["values"].append(bytes(v2))
        elif f2 == 5:
            layer["extent"] = v2
        elif f2 == 15:
            layer["version"] = v2
    return layer


def value_of(layer, idx):
    return _value(memoryview(layer["values"][idx]))


def encode_value(v):
    if isinstance(v, bool):
        return _key(7, 0) + _varint_bytes(int(v))
    if isinstance(v, int):
        return (_key(5, 0) + _varint_bytes(v)) if v >= 0 else (_key(6, 0) + _varint_bytes(_zz(v)))
    if isinstance(v, float):
        return _key(3, 1) + struct.pack("<d", v)
    return _len_field(1, str(v).encode())


def ring_area2(ring):
    """Twice the signed area in tile units (y down: exterior rings are positive)."""
    pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:] + pts[:1]))


def polygons(rings):
    """Group rings into [exterior, *holes] polygons by winding."""
    out = []
    for r in rings:
        a = ring_area2(r)
        if a > 0 or not out:
            out.append([r])
        elif a < 0:
            out[-1].append(r)
    return out


def encode_polygon_geometry(polys):
    cmds, cx, cy = [], 0, 0
    for poly in polys:
        for ring in poly:
            pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
            if len(pts) < 3:
                continue
            x, y = pts[0]
            cmds += [(1 & 7) | (1 << 3), _zz(x - cx), _zz(y - cy)]
            cx, cy = x, y
            cmds.append((2 & 7) | ((len(pts) - 1) << 3))
            for x, y in pts[1:]:
                cmds += [_zz(x - cx), _zz(y - cy)]
                cx, cy = x, y
            cmds.append(7 | (1 << 3))
    return cmds


def write_layer(name, extent, version, features):
    """features: [{'props': {..}, 'polys': [[ring, *holes], ...]}] (polygon layers)."""
    keys, kidx, vals, vidx = [], {}, [], {}
    fbufs = []
    for f in features:
        tags = []
        for k, v in f["props"].items():
            if v is None:
                continue
            if k not in kidx:
                kidx[k] = len(keys)
                keys.append(k)
            ev = encode_value(v)
            if ev not in vidx:
                vidx[ev] = len(vals)
                vals.append(ev)
            tags += [kidx[k], vidx[ev]]
        geom = encode_polygon_geometry(f["polys"])
        if not geom:
            continue
        fb = _len_field(2, _packed_bytes(tags)) + _key(3, 0) + _varint_bytes(3) + _len_field(4, _packed_bytes(geom))
        fbufs.append(fb)
    out = _key(15, 0) + _varint_bytes(version) + _len_field(1, name.encode())
    out += b"".join(_len_field(2, fb) for fb in fbufs)
    out += b"".join(_len_field(3, k.encode()) for k in keys)
    out += b"".join(_len_field(4, v) for v in vals)
    out += _key(5, 0) + _varint_bytes(extent)
    return out

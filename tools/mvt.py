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

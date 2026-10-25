/* City buildings for the MapLibre renderer: a WebGL2 custom layer that draws every
   OpenStreetMap building from the baked vector tiles with

     • real massing: walls and roofs from the footprint; small houses get a gable roof
       fitted to their oriented bounding box, larger buildings a flat roof,
     • procedural facades in world metres (so they line up across tile seams): punched
       windows, ribbon glazing, curtain walls, storefronts, industrial cladding, per
       building class and a per-building variant; glass reflects the sky and catches the
       sun, and at night a share of windows is lit,
     • roofing materials (shingle courses, membrane, gravel, rooftop plant),
     • a sun light from the simulation clock with sky/ground ambient and ambient occlusion
       at the base of walls,
     • real shadows: a shadow map rendered from the sun each time the view or the clock
       changes, applied to the buildings themselves and to the ground around them.

   It reads the same tiles MapLibre loads (twinmap.js hands over a copy of each one) and
   draws the tiles MapLibre currently shows, so coverage and level of detail match the
   rest of the map. Without WebGL2 or local tiles the style's fill-extrusion layers are
   kept instead. */
(function (root) {
  const EARTH = 2 * Math.PI * 6371008.8;
  const CLASS = { residential: 0, commercial: 1, industrial: 2, civic: 3, hospital: 4 };
  const OTHER = 5;
  const FILL_LAYERS = ['building-3d', 'building-roof', 'facility-3d', 'facility-roof'];
  const SHADOW_SIZE = 4096;

  // ── Vector tile decoding (building layer only) ─────────────────────────────
  function decodeBuildings(buf) {
    const b = new Uint8Array(buf);
    let p = 0;
    const varint = () => { let v = 0, s = 1, c; do { c = b[p++]; v += (c & 0x7f) * s; s *= 128; } while (c >= 0x80); return v; };
    const skip = (w) => { if (w === 0) varint(); else if (w === 1) p += 8; else if (w === 2) { const n = varint(); p += n; } else if (w === 5) p += 4; };
    const utf8 = new TextDecoder();
    const out = [];
    while (p < b.length) {
      const tag = varint(), f = tag >> 3, w = tag & 7;
      if (f !== 3 || w !== 2) { skip(w); continue; }
      const len = varint(), end = p + len;
      let name = '', extent = 4096;
      const keys = [], values = [], feats = [];
      while (p < end) {
        const t2 = varint(), f2 = t2 >> 3, w2 = t2 & 7;
        if (f2 === 1 && w2 === 2) { const n = varint(); name = utf8.decode(b.subarray(p, p + n)); p += n; }
        else if (f2 === 2 && w2 === 2) { const n = varint(); feats.push([p, p + n]); p += n; }
        else if (f2 === 3 && w2 === 2) { const n = varint(); keys.push(utf8.decode(b.subarray(p, p + n))); p += n; }
        else if (f2 === 4 && w2 === 2) {
          const n = varint(), ve = p + n;
          let v = null;
          while (p < ve) {
            const t3 = varint(), f3 = t3 >> 3, w3 = t3 & 7;
            if (f3 === 1) { const m = varint(); v = utf8.decode(b.subarray(p, p + m)); p += m; }
            else if (f3 === 2) { v = new DataView(buf, p, 4).getFloat32(0, true); p += 4; }
            else if (f3 === 3) { v = new DataView(buf, p, 8).getFloat64(0, true); p += 8; }
            else if (f3 === 4 || f3 === 5) v = varint();
            else if (f3 === 6) { const z = varint(); v = z % 2 ? -(z + 1) / 2 : z / 2; }
            else if (f3 === 7) v = !!varint();
            else skip(w3);
          }
          values.push(v);
        } else if (f2 === 5 && w2 === 0) extent = varint();
        else skip(w2);
      }
      p = end;
      if (name !== 'building') continue;
      for (const [s, e] of feats) {
        const props = {};
        let type = 0, geom = null;
        const save = p;
        p = s;
        while (p < e) {
          const t2 = varint(), f2 = t2 >> 3, w2 = t2 & 7;
          if (f2 === 2 && w2 === 2) { const n = varint(), te = p + n; while (p < te) { const k = varint(), v = varint(); props[keys[k]] = values[v]; } }
          else if (f2 === 3 && w2 === 0) type = varint();
          else if (f2 === 4 && w2 === 2) { const n = varint(), ge = p + n; geom = []; while (p < ge) geom.push(varint()); }
          else skip(w2);
        }
        p = save;
        if (type !== 3 || !geom) continue;
        out.push({ props, rings: decodeRings(geom) });
      }
      return { extent, features: out };
    }
    return { extent: 4096, features: out };
  }
  function decodeRings(g) {
    const rings = [];
    let x = 0, y = 0, i = 0, ring = null;
    while (i < g.length) {
      const cmd = g[i] & 7, n = g[i] >> 3;
      i++;
      if (cmd === 1 || cmd === 2) {
        for (let k = 0; k < n; k++) {
          const dx = g[i++], dy = g[i++];
          x += dx % 2 ? -(dx + 1) / 2 : dx / 2;
          y += dy % 2 ? -(dy + 1) / 2 : dy / 2;
          if (cmd === 1) { ring = []; rings.push(ring); }
          ring.push(x, y);
        }
      }
    }
    return rings;
  }
  const area2 = (r) => { let a = 0; for (let i = 0, n = r.length; i < n; i += 2) { const j = (i + 2) % n; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return a; };
  // Group rings into polygons: exterior rings have positive area (y down), holes follow.
  function polygons(rings) {
    const polys = [];
    for (const r of rings) {
      if (r.length < 6) continue;
      if (area2(r) > 0 || !polys.length) polys.push([r]); else polys[polys.length - 1].push(r);
    }
    return polys;
  }

  // ── Mesh building ──────────────────────────────────────────────────────────
  // Vertex: position in tile units (float32 x2) + [z, base, eave, info] (uint16 x4,
  // heights in decimetres). info = class | variant << 3 | roofKind << 8 | wallDir << 9.
  // wallDir (0–127 over 180°) is set on the bottom vertex that starts each wall, which is
  // the last (provoking) vertex of both of that wall's triangles, so the flat varying gives
  // every facade fragment one exact direction. Screen-space derivatives jitter up close,
  // and that jitter times positions kilometres from the origin scrambles the window grid.
  function MeshBuilder() {
    let pos = new Float32Array(1 << 15), dat = new Uint16Array(1 << 16), idx = new Uint32Array(1 << 16);
    let nv = 0, ni = 0;
    const grow = () => {
      if ((nv + 8) * 2 > pos.length) { const a = new Float32Array(pos.length * 2); a.set(pos); pos = a; const d = new Uint16Array(dat.length * 2); d.set(dat); dat = d; }
    };
    return {
      v(x, y, z, base, eave, info) {
        grow();
        pos[nv * 2] = x; pos[nv * 2 + 1] = y;
        const o = nv * 4;
        dat[o] = Math.max(0, Math.min(65535, Math.round(z * 10)));
        dat[o + 1] = Math.max(0, Math.min(65535, Math.round(base * 10)));
        dat[o + 2] = Math.max(0, Math.min(65535, Math.round(eave * 10)));
        dat[o + 3] = info;
        return nv++;
      },
      t(a, b, c) {
        if (ni + 3 > idx.length) { const a2 = new Uint32Array(idx.length * 2); a2.set(idx); idx = a2; }
        idx[ni++] = a; idx[ni++] = b; idx[ni++] = c;
      },
      get count() { return ni; },
      done() { return { pos: pos.slice(0, nv * 2), dat: dat.slice(0, nv * 4), idx: idx.slice(0, ni), nv, ni }; },
    };
  }

  function hash2(a, b) { let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; }

  // Oriented bounding box of a ring (min-area box over edge directions).
  function obb(r, n) {
    let best = null;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      let ax = r[j * 2] - r[i * 2], ay = r[j * 2 + 1] - r[i * 2 + 1];
      const L = Math.hypot(ax, ay);
      if (L < 1e-6) continue;
      ax /= L; ay /= L;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let k = 0; k < n; k++) {
        const x = r[k * 2], y = r[k * 2 + 1];
        const u = x * ax + y * ay, v = -x * ay + y * ax;
        if (u < a0) a0 = u; if (u > a1) a1 = u; if (v < b0) b0 = v; if (v > b1) b1 = v;
      }
      const area = (a1 - a0) * (b1 - b0);
      if (!best || area < best.area) best = { area, ax, ay, a0, a1, b0, b1 };
    }
    if (!best) return null;
    // Long axis = ridge direction.
    if (best.b1 - best.b0 > best.a1 - best.a0) {
      best = { area: best.area, ax: -best.ay, ay: best.ax, a0: best.b0, a1: best.b1, b0: -best.a1, b1: -best.a0 };
    }
    return best;
  }

  // Edges along the tile border are clipping artefacts, not walls (E null: never).
  const isBoundary = (x1, y1, x2, y2, E) => E != null && ((x1 === x2 && (x1 <= 0 || x1 >= E)) || (y1 === y2 && (y1 <= 0 || y1 >= E)));
  // Wall direction bits for info (tile y points south, world y north).
  function wallBits(x1, y1, x2, y2) {
    let a = Math.atan2(y1 - y2, x2 - x1);
    if (a < 0) a += Math.PI;
    return (Math.round((a / Math.PI) * 128) % 128) << 9;
  }
  // A wall quad as two triangles that both end on bot[i] (see MeshBuilder).
  const wall = (M, bi, bj, ti, tj) => { M.t(bj, tj, bi); M.t(tj, ti, bi); };

  // Add one building polygon (rings in tile units, open) to the mesh.
  // g = [x0, y0, scale]: tile units → global z14 units, for a per-building variant.
  function addBuilding(M, poly, props, E, mpu, g) {
    if (props.hide_3d === true) return;
    const H = +(props.render_height ?? props.h ?? 6) || 6;
    const H0 = +(props.render_min_height ?? props.mh ?? 0) || 0;
    const cls = CLASS[props.class ?? props.c] ?? OTHER;
    const outer = poly[0], n = outer.length / 2;
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { cx += outer[i * 2]; cy += outer[i * 2 + 1]; }
    const gx = Math.floor((g[0] + cx / n * g[2]) / 12), gy = Math.floor((g[1] + cy / n * g[2]) / 12);
    const variant = hash2(gx * 31 + cls, gy * 17 + Math.round(H * 2)) % 32;
    const areaM = Math.abs(area2(outer)) / 2 * mpu * mpu;
    const houseLike = (cls === CLASS.residential || cls === OTHER) && H <= 12 && poly.length === 1 && n <= 48 && areaM > 30 && areaM < 520 && variant % 9 !== 0;
    let box = houseLike ? obb(outer, n) : null;
    if (box && (box.b1 - box.b0) * mpu < 4) box = null;
    if (!box) { addFlat(M, poly, H, H0, cls | (variant << 3), E); return; }
    addGable(M, outer, n, H, H0, cls | (variant << 3) | (1 << 8), E, mpu, box, variant);
  }

  function addFlat(M, poly, H, H0, info, E) {
    const flat = [], holes = [], tops = [];
    for (const r of poly) {
      if (flat.length) holes.push(flat.length / 2);
      const n = r.length / 2, bot = [], top = [];
      for (let i = 0; i < n; i++) {
        const x = r[i * 2], y = r[i * 2 + 1], j = (i + 1) % n;
        bot.push(M.v(x, y, H0, H0, H, info | wallBits(x, y, r[j * 2], r[j * 2 + 1])));
        top.push(M.v(x, y, H, H0, H, info));
        flat.push(x, y);
      }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (isBoundary(r[i * 2], r[i * 2 + 1], r[j * 2], r[j * 2 + 1], E)) continue;
        wall(M, bot[i], bot[j], top[i], top[j]);
      }
      tops.push(...top);
    }
    const tri = root.earcut(flat, holes.length ? holes : null, 2);
    for (let k = 0; k < tri.length; k += 3) M.t(tops[tri[k]], tops[tri[k + 1]], tops[tri[k + 2]]);
  }

  // Gable roof along the oriented box's long axis: the ring is split at the ridge line,
  // each half is a plane rising from the eave to the ridge, end walls become gables.
  function addGable(M, r, n, H, H0, info, E, mpu, box, variant) {
    const { ax, ay, b0, b1 } = box;
    const mid = (b0 + b1) / 2, half = (b1 - b0) / 2;
    const pitch = [0.5, 0.58, 0.67, 0.75][variant & 3]; // rise per run (≈27–37°)
    const rise = Math.min(4.2, Math.max(1.1, half * mpu * pitch));
    const eave = Math.max(2.8, H - rise * 0.55);
    const ridge = eave + rise;
    const dOf = (x, y) => (-x * ay + y * ax) - mid;
    // Insert ridge crossings into the ring.
    const pts = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x1 = r[i * 2], y1 = r[i * 2 + 1], x2 = r[j * 2], y2 = r[j * 2 + 1];
      const d1 = dOf(x1, y1), d2 = dOf(x2, y2);
      pts.push([x1, y1, d1, i]);
      if ((d1 < 0 && d2 > 0) || (d1 > 0 && d2 < 0)) {
        const t = d1 / (d1 - d2);
        pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 0, -1]);
      }
    }
    const zOf = (d) => ridge - rise * Math.min(1, Math.abs(d) / half);
    const m = pts.length, bot = [], top = [];
    for (let i = 0; i < m; i++) {
      const [x, y, d] = pts[i], b = pts[(i + 1) % m];
      bot.push(M.v(x, y, H0, H0, eave, info | wallBits(x, y, b[0], b[1])));
      top.push(M.v(x, y, zOf(d), H0, eave, info));
    }
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const a = pts[i], b = pts[j];
      // Boundary edges are only skipped between original vertices.
      if (a[3] >= 0 && b[3] >= 0 && isBoundary(a[0], a[1], b[0], b[1], E)) continue;
      wall(M, bot[i], bot[j], top[i], top[j]);
    }
    for (const side of [1, -1]) {
      const sel = [];
      for (let i = 0; i < m; i++) if (pts[i][2] * side >= -1e-6) sel.push(i);
      if (sel.length < 3) continue;
      const flat = [];
      for (const i of sel) flat.push(pts[i][0], pts[i][1]);
      const tri = root.earcut(flat, null, 2);
      for (let k = 0; k < tri.length; k += 3) M.t(top[sel[tri[k]]], top[sel[tri[k + 1]]], top[sel[tri[k + 2]]]);
    }
  }

  function tileLat(z, y) { const n = Math.PI - (2 * Math.PI * (y + 0.5)) / 2 ** z; return Math.atan(Math.sinh(n)); }

  function meshTile(key, buf) {
    const [z, x, y] = key.split('/').map(Number);
    const { extent: E, features } = decodeBuildings(buf);
    if (!features.length) return null;
    const mpu = (EARTH * Math.cos(tileLat(z, y))) / (2 ** z * E);
    const M = MeshBuilder();
    const sc = 2 ** (14 - z), g = [x * E * sc, y * E * sc, sc];
    for (const f of features) for (const poly of polygons(f.rings)) addBuilding(M, poly, f.props, E, mpu, g);
    return M.count ? { z, x, y, E, ...M.done() } : null;
  }

  // Footprints lifted from the tiles at hero sites, meshed in their z14 tile's frame.
  function meshSites(geo) {
    const out = [];
    const z = 14, n = 2 ** z, E = 4096;
    for (const s of geo.sites || []) {
      if (!s.footprints || !s.footprints.length) continue;
      const [lng, lat] = s.footprints[0].g[0][0];
      const tx = Math.floor(((lng + 180) / 360) * n);
      const ty = Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
      const mpu = (EARTH * Math.cos(tileLat(z, ty))) / (n * E);
      const M = MeshBuilder();
      for (const fp of s.footprints) {
        const poly = fp.g.map((ring) => {
          const r = [];
          const m = ring.length - (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? 1 : 0);
          for (let k = 0; k < m; k++) {
            const [lo, la] = ring[k];
            r.push((((lo + 180) / 360) * n - tx) * E, (((1 - Math.asinh(Math.tan((la * Math.PI) / 180)) / Math.PI) / 2) * n - ty) * E);
          }
          // GeoJSON exteriors are counter-clockwise in lng/lat, i.e. clockwise with y down.
          if ((area2(r) > 0) !== (ring === fp.g[0])) for (let a = 0, b = r.length - 2; a < b; a += 2, b -= 2) { [r[a], r[b]] = [r[b], r[a]]; [r[a + 1], r[b + 1]] = [r[b + 1], r[a + 1]]; }
          return r;
        });
        addBuilding(M, poly, { h: fp.h, mh: fp.mh, c: fp.c }, null, mpu, [tx * E, ty * E, 1]);
      }
      if (M.count) out.push({ fi: s.fi, z, x: tx, y: ty, E, ...M.done() });
    }
    return out;
  }

  // ── Shaders ────────────────────────────────────────────────────────────────
  const VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a_data;
uniform mat4 u_matrix;
uniform mat4 u_world;
uniform mat4 u_light;
uniform float u_grow;
out vec3 v_world;
out vec4 v_light;
out float v_depth;
flat out vec3 v_data;
void main() {
  vec4 p = vec4(a_pos, a_data.x * 0.1 * u_grow, 1.0);
  gl_Position = u_matrix * p;
  v_world = (u_world * p).xyz;
  v_light = u_light * p;
  v_depth = gl_Position.w;
  v_data = vec3(a_data.y * 0.1 * u_grow, a_data.z * 0.1 * u_grow, a_data.w);
}`;

  const FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 v_world;
in vec4 v_light;
in float v_depth;
flat in vec3 v_data;
uniform vec3 u_cam;
uniform vec3 u_sunDir;
uniform vec3 u_sun;
uniform vec3 u_sky;
uniform vec3 u_ground;
uniform vec3 u_zenith;
uniform vec3 u_horizon;
uniform vec3 u_fog;
uniform vec2 u_fogRange;
uniform float u_night;
uniform float u_exposure;
uniform float u_shadowOn;
uniform float u_shadowTexel;
uniform sampler2DShadow u_shadow;
out vec4 fragColor;

float h12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), f.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
// Anti-aliased box: 1 inside [a, b] of a repeating cell coordinate t (cells of 1).
float band(float t, float a, float b, float w) { return smoothstep(a - w, a + w, t) - smoothstep(b - w, b + w, t); }

float shadowAt(vec4 lp) {
  if (u_shadowOn < 0.5) return 1.0;
  vec3 p = lp.xyz / lp.w * 0.5 + 0.5;
  float edge = max(abs(p.x - 0.5), abs(p.y - 0.5)) * 2.0;
  if (edge > 1.0 || p.z > 1.0) return 1.0;
  float s = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
    s += texture(u_shadow, vec3(p.xy + vec2(float(i), float(j)) * u_shadowTexel * 1.25, p.z - 0.0009));
  s /= 9.0;
  return mix(s, 1.0, smoothstep(0.82, 1.0, edge));
}

vec3 palette(int cls, float v) {
  int k = int(mod(v, 8.0));
  if (cls == 0 || cls == 5) {
    vec3 c[8] = vec3[8](vec3(0.80,0.77,0.71), vec3(0.88,0.87,0.84), vec3(0.62,0.58,0.53), vec3(0.55,0.36,0.28),
                        vec3(0.66,0.63,0.58), vec3(0.50,0.55,0.58), vec3(0.73,0.66,0.55), vec3(0.45,0.43,0.41));
    return c[k];
  }
  if (cls == 1) { vec3 c[8] = vec3[8](vec3(0.66,0.65,0.62), vec3(0.42,0.46,0.50), vec3(0.72,0.68,0.61), vec3(0.32,0.34,0.37),
                                     vec3(0.58,0.60,0.62), vec3(0.75,0.74,0.71), vec3(0.50,0.47,0.43), vec3(0.62,0.55,0.48)); return c[k]; }
  if (cls == 2) { vec3 c[4] = vec3[4](vec3(0.60,0.63,0.64), vec3(0.72,0.70,0.66), vec3(0.48,0.51,0.54), vec3(0.62,0.58,0.50)); return c[k / 2]; }
  if (cls == 3) { vec3 c[4] = vec3[4](vec3(0.55,0.37,0.29), vec3(0.76,0.72,0.64), vec3(0.66,0.62,0.56), vec3(0.60,0.47,0.38)); return c[k / 2]; }
  vec3 c[2] = vec3[2](vec3(0.84,0.84,0.81), vec3(0.78,0.80,0.79)); return c[k / 4];
}

void main() {
  vec3 N = normalize(cross(dFdx(v_world), dFdy(v_world)));
  vec3 V = normalize(u_cam - v_world);
  if (dot(N, V) < 0.0) N = -N;
  float info = v_data.z;
  int cls = int(mod(info, 8.0));
  float variant = floor(mod(info / 8.0, 32.0));
  bool pitched = mod(floor(info / 256.0), 2.0) > 0.5;
  float base = v_data.x, eave = v_data.y;
  float hb = v_world.z - base;
  float seed = variant * 7.31 + float(cls) * 3.7;

  vec3 albedo; vec3 emit = vec3(0.0);
  float glass = 0.0; float rough = 0.85;
  vec3 wall = palette(cls, variant);
  if (N.z > 0.25) {
    // ── Roof ──
    if (pitched) {
      vec3 sh[4] = vec3[4](vec3(0.20,0.20,0.21), vec3(0.27,0.22,0.19), vec3(0.19,0.21,0.24), vec3(0.32,0.30,0.28));
      albedo = sh[int(mod(variant, 4.0))];
      vec2 slope = normalize(N.xy + 1e-5);
      float s = dot(v_world.xy, slope) / 0.32;
      float w = fwidth(s);
      float course = 1.0 - 0.22 * band(fract(s), 0.0, 0.12, w) * (1.0 - smoothstep(0.3, 0.8, w));
      float tab = h12(floor(vec2(dot(v_world.xy, vec2(-slope.y, slope.x)) / 0.9, floor(s))));
      albedo *= course * (0.9 + 0.2 * tab);
    } else {
      vec3 rf[4] = vec3[4](vec3(0.50,0.51,0.50), vec3(0.36,0.37,0.36), vec3(0.22,0.23,0.24), vec3(0.58,0.59,0.58));
      albedo = rf[int(mod(variant, 4.0))];
      if (cls == 0) albedo *= 0.7;
      // Weathering: smooth patches at two scales, offset per building so roofs differ.
      vec2 rp = v_world.xy + seed * 13.7;
      float rw = fwidth(rp.x);
      float n = vnoise(rp / 11.0) * 0.6 + vnoise(rp / 3.1) * 0.4 * (1.0 - smoothstep(0.4, 1.2, rw));
      albedo *= 0.9 + 0.2 * n;
      // Rooftop plant on larger buildings: units of varied size and placement in cells of a
      // per-building size, each with a short shadow away from the sun; small vents between.
      if (eave - base > 7.0) {
        float cs = 6.0 + mod(variant, 4.0);
        vec2 c6 = rp / cs; vec2 id = floor(c6), f = fract(c6);
        float r1 = h12(id + 17.0), r2 = h12(id * 1.31 + 4.1), r3 = h12(id * 0.77 + 9.3);
        vec2 sz = vec2(0.2 + 0.32 * r2, 0.16 + 0.28 * r3);
        vec2 o = vec2(0.08 + (0.84 - sz.x) * r3, 0.08 + (0.84 - sz.y) * r2);
        float w = fwidth(c6.x), fade = 1.0 - smoothstep(0.1, 0.3, w);
        float has = step(0.82, r1) * fade;
        float unit = band(f.x, o.x, o.x + sz.x, w) * band(f.y, o.y, o.y + sz.y, w);
        vec2 sd = -u_sunDir.xy / max(u_sunDir.z, 0.35) * 1.4 / cs;
        float drop = band(f.x - sd.x, o.x, o.x + sz.x, w) * band(f.y - sd.y, o.y, o.y + sz.y, w);
        albedo *= 1.0 - 0.45 * has * drop * (1.0 - unit) * clamp(u_sun.g, 0.0, 1.0);
        albedo = mix(albedo, vec3(0.52, 0.53, 0.54), has * unit);
        vec2 c2 = rp / 2.3 + 0.5; vec2 f2 = fract(c2); float w2 = fwidth(c2.x);
        float vent = step(0.965, h12(floor(c2) + 3.3)) * band(f2.x, 0.36, 0.64, w2) * band(f2.y, 0.36, 0.64, w2);
        albedo = mix(albedo, albedo * 1.25, vent * (1.0 - smoothstep(0.2, 0.5, w2)) * (1.0 - has * unit));
      }
    }
  } else {
    // ── Facade ── (direction and normal from the wall's flat direction bits)
    albedo = wall;
    float th = floor(info / 512.0) * (3.14159265 / 128.0);
    vec2 dir = vec2(cos(th), sin(th));
    N = vec3(dir.y, -dir.x, 0.0);
    if (dot(N, V) < 0.0) N = -N;
    float u = dot(v_world.xy, dir);
    float top = eave - base;
    float fh = 3.0, colW = 3.2, wx0 = 0.32, wx1 = 0.68, wy0 = 0.3, wy1 = 0.78, gf = 0.0;
    float lit = 0.32;
    bool ribbon = false, cladding = false;
    if (cls == 0 || cls == 5) {
      if (pitched || top < 10.0) { colW = 2.8 + mod(variant, 3.0) * 0.6; wx0 = 0.3; wx1 = 0.7; wy0 = 0.3; wy1 = 0.76; }
      else { fh = 2.95; colW = 2.6 + mod(variant, 3.0) * 0.4; wx0 = 0.22; wx1 = 0.78; wy0 = 0.28; wy1 = 0.8; }
      lit = 0.4;
      // Siding courses.
      float s = v_world.z / 0.22, w = fwidth(s);
      if (mod(variant, 8.0) < 3.0 || mod(variant, 8.0) == 5.0) albedo *= 1.0 - 0.08 * band(fract(s), 0.0, 0.18, w) * (1.0 - smoothstep(0.3, 0.8, w));
    } else if (cls == 1) {
      fh = 3.9; gf = 4.6; lit = 0.22;
      if (top > 24.0 || mod(variant, 3.0) == 0.0) { ribbon = true; colW = 1.5; wx0 = 0.04; wx1 = 0.96; wy0 = 0.18; wy1 = 0.94; }
      else { colW = 2.4; wx0 = 0.12; wx1 = 0.88; wy0 = 0.25; wy1 = 0.85; }
    } else if (cls == 2) {
      fh = 6.0; colW = 6.0; cladding = true; lit = 0.12;
    } else if (cls == 3) {
      fh = 4.2; colW = 3.4; wx0 = 0.3; wx1 = 0.7; wy0 = 0.22; wy1 = 0.78; lit = 0.25;
    } else {
      fh = 4.0; colW = 1.6; ribbon = true; wx0 = 0.05; wx1 = 0.95; wy0 = 0.28; wy1 = 0.82; lit = 0.55;
    }
    float win = 0.0, frame = 0.0, far = 0.0, cover = 0.0;
    vec2 cell;
    if (cladding) {
      // Vertical ribbed metal panels, a clerestory band and loading doors.
      float r = u / 0.3, w = fwidth(r);
      albedo *= 1.0 - 0.1 * band(fract(r), 0.0, 0.35, w) * (1.0 - smoothstep(0.3, 0.8, w));
      float t = (hb - (top - 2.2)) / 1.0;
      float cu = u / 3.0, cw = fwidth(cu);
      win = band(t, 0.0, 1.0, fwidth(t)) * band(fract(cu), 0.08, 0.92, cw);
      cell = vec2(floor(cu), 99.0);
      far = smoothstep(0.35, 0.8, max(cw, fwidth(t)));
      cover = 0.12;
      float du = fract(u / 14.0), dw = fwidth(u / 14.0);
      float door = band(du, 0.4, 0.68, dw) * (1.0 - smoothstep(4.3, 4.3 + fwidth(hb), hb)) * step(top, 12.0) * step(0.5, h12(vec2(floor(u / 14.0), variant)));
      albedo = mix(albedo, albedo * 0.55, door);
    } else {
      float hy = hb - gf;
      float fy = (gf > 0.0 && hb < gf) ? hb / gf : fract(hy / fh);
      float fl = (gf > 0.0 && hb < gf) ? -1.0 : floor(hy / fh);
      float cu = u / colW;
      float wu = fwidth(cu), wv = fwidth(gf > 0.0 && hb < gf ? hb / gf : hy / fh);
      float y0 = wy0, y1 = wy1, x0 = wx0, x1 = wx1;
      if (gf > 0.0 && hb < gf) { y0 = 0.08; y1 = 0.86; x0 = 0.03; x1 = 0.97; }
      win = band(fract(cu), x0, x1, wu) * band(fy, y0, y1, wv);
      // Keep the parapet and gables solid.
      win *= 1.0 - smoothstep(top - 0.9, top - 0.9 + fwidth(hb), hb);
      if (pitched) win *= 1.0 - smoothstep(top, top + 0.01, hb);
      frame = band(fract(cu), x0 - 0.035, x1 + 0.035, wu) * band(fy, y0 - 0.04, y1 + 0.04, wv) - win;
      if (ribbon) frame = max(frame, band(fract(u / 1.5), 0.0, 0.05, fwidth(u / 1.5)) * win);
      cell = vec2(floor(cu), fl);
      // Once windows shrink below a couple of pixels the pattern fades into its average.
      far = smoothstep(0.35, 0.8, max(wu, wv));
      cover = (x1 - x0) * (y1 - y0) * 0.9;
      frame *= 1.0 - far;
    }
    glass = mix(win, cover, far);
    // Glass: dark interior, sky reflection, sun glint, lit rooms at night.
    vec3 R = reflect(-V, N);
    float F = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec3 env = R.z > 0.0 ? mix(u_horizon, u_zenith, pow(R.z, 0.55)) : mix(u_horizon * 0.6, u_ground, min(1.0, -R.z * 3.0));
    float rnd = mix(h12(cell * vec2(1.7, 3.1) + seed + floor(u / 900.0)), 0.5, far);
    vec3 interior = lin(vec3(0.10, 0.12, 0.14)) * (0.7 + 0.6 * rnd);
    vec3 glassCol = interior * (1.0 - F) + env * (0.18 + 0.82 * F);
    glassCol += u_sun * pow(max(dot(R, u_sunDir), 0.0), 220.0) * 3.0 * F;
    // Lit rooms: per window up close; far away a dim average, since a sparse scatter of lit
    // windows reads darker than its mean and a uniform glow would read as a lit wall.
    float onC = step(h12(cell * vec2(2.3, 1.9) + seed * 1.3), lit) * (0.55 + 0.6 * h12(cell + 2.1));
    vec3 warmC = mix(vec3(1.0, 0.72, 0.42), vec3(0.85, 0.9, 1.0), step(0.8, h12(cell + 5.3)));
    emit = mix(warmC * onC * win, vec3(0.97, 0.76, 0.52) * lit * 0.85 * cover * 0.4, far) * 0.9 * u_night;
    albedo = mix(albedo, albedo * 0.6, clamp(frame, 0.0, 1.0));
    // Lit glass is handled as emission + reflection below.
    vec3 Lw = normalize(u_sunDir);
    float ndl = max(dot(N, Lw), 0.0);
    float sh = shadowAt(v_light);
    float ao = mix(0.42, 1.0, smoothstep(0.0, 4.5, hb)) * mix(1.0, 0.9, smoothstep(top - 0.6, top, hb));
    vec3 amb = mix(u_ground, u_sky, 0.5 + 0.5 * N.z) * ao;
    vec3 diffuse = lin(albedo) * 0.8 * (u_sun * ndl * sh + amb);
    // Street lighting washes the lower storeys at night.
    diffuse += lin(albedo) * u_night * vec3(1.0, 0.66, 0.36) * 0.16 * (1.0 - smoothstep(0.0, 8.0, hb));
    vec3 col = mix(diffuse, glassCol * mix(1.0, 0.35 + 0.65 * sh, step(0.001, ndl)), glass) + emit;
    float fog = smoothstep(u_fogRange.x, u_fogRange.y, v_depth) * 0.55;
    col = mix(col, u_fog, fog);
    fragColor = vec4(pow(aces(col * u_exposure), vec3(1.0 / 2.2)), 1.0);
    return;
  }
  // Roof lighting
  vec3 Lr = normalize(u_sunDir);
  float ndl = max(dot(N, Lr), 0.0);
  float sh = shadowAt(v_light);
  vec3 amb = mix(u_ground, u_sky, 0.5 + 0.5 * N.z);
  vec3 col = lin(albedo) * 0.8 * (u_sun * ndl * sh + amb);
  float fog = smoothstep(u_fogRange.x, u_fogRange.y, v_depth) * 0.55;
  col = mix(col, u_fog, fog);
  fragColor = vec4(pow(aces(col * u_exposure), vec3(1.0 / 2.2)), 1.0);
}`;

  const VS_DEPTH = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a_data;
uniform mat4 u_light;
void main() { gl_Position = u_light * vec4(a_pos, a_data.x * 0.1, 1.0); }`;
  const FS_DEPTH = `#version 300 es
precision mediump float;
out vec4 c;
void main() { c = vec4(1.0); }`;

  // Ground shadow: a quad over the shadow region, dark where the sun is blocked.
  const VS_GROUND = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
uniform mat4 u_matrix;
uniform mat4 u_light;
out vec4 v_light;
void main() { vec4 p = vec4(a_pos, 0.0, 1.0); gl_Position = u_matrix * p; v_light = u_light * p; }`;
  const FS_GROUND = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec4 v_light;
uniform sampler2DShadow u_shadow;
uniform float u_strength;
uniform float u_shadowTexel;
out vec4 fragColor;
void main() {
  vec3 p = v_light.xyz / v_light.w * 0.5 + 0.5;
  float edge = max(abs(p.x - 0.5), abs(p.y - 0.5)) * 2.0;
  if (edge > 1.0) discard;
  float s = 0.0;
  for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++)
    s += texture(u_shadow, vec3(p.xy + vec2(float(i), float(j)) * u_shadowTexel, p.z - 0.0006));
  s /= 25.0;
  float a = (1.0 - s) * u_strength * (1.0 - smoothstep(0.8, 1.0, edge));
  fragColor = vec4(0.0, 0.0, 0.0, a);
}`;

  // ── Small matrix helpers (column-major, float64) ───────────────────────────
  function mul(a, b) {
    const o = new Float64Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }
  function invert(m) {
    const a = m, o = new Float64Array(16);
    const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4];
    const b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
    const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12];
    const b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1 / det;
    o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
    o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
    o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
    o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
    o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
    o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
    o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
    o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
    return o;
  }
  const f32 = (m) => new Float32Array(m);

  function install(tm, geo, opts = {}) {
    const { map } = tm;
    if (tm.mode !== 'maplibre' || !tm.onTile) return null;
    const gl0 = map.painter && map.painter.context && map.painter.context.gl;
    const isGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl0 instanceof WebGL2RenderingContext;
    if (!isGL2 || !root.earcut || opts.enabled === false) return null;
    // Software rasterisers (headless browsers, blocklisted GPUs) get a smaller shadow map.
    const dbg = gl0.getExtension('WEBGL_debug_renderer_info');
    const software = /swiftshader|llvmpipe|software/i.test(dbg ? gl0.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '');
    const wantShadows = opts.shadows !== false;

    const lat0 = geo.center[1] * Math.PI / 180;
    const M0 = EARTH * Math.cos(lat0); // metres per mercator unit (world frame scale)
    const ox = (geo.center[0] + 180) / 360;
    const oy = (1 - Math.asinh(Math.tan(lat0)) / Math.PI) / 2;
    const meshes = new Map(); // "z/x/y" → mesh
    const queue = [];
    let sites = [], hiddenSite = -1;
    let gl = null, prog = null, depthProg = null, groundProg = null, groundBuf = null, groundVao = null;
    let fbo = null, depthTex = null, shadowSize = SHADOW_SIZE;
    let light = null, lightKey = '', shadowOn = false, frameTiles = [], frameSig = '', shadowPasses = 0;
    let sun = { dir: [0.3, -0.6, 0.74], color: [2.2, 2.1, 1.95], sky: [0.3, 0.34, 0.4], ground: [0.1, 0.09, 0.08], zenith: [0.04, 0.07, 0.12], horizon: [0.2, 0.25, 0.3], fog: [0.1, 0.12, 0.15], night: 0, exposure: 0.8, shadow: 0.45 };

    // Mesh tiles a few at a time so loading never blocks a frame for long.
    let pumping = false;
    function pump() {
      if (pumping) return;
      pumping = true;
      const step = () => {
        const t0 = performance.now();
        while (queue.length && performance.now() - t0 < 10) {
          const [key, buf] = queue.shift();
          try { const m = meshTile(key, buf); if (m) meshes.set(key, m); } catch (e) { console.warn('building mesh failed', key, e); }
        }
        map.triggerRepaint();
        if (queue.length) setTimeout(step, 0); else pumping = false;
      };
      setTimeout(step, 0);
    }

    function compile(vs, fs) {
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'a_pos'); gl.bindAttribLocation(p, 1, 'a_data');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
      return { p, u };
    }
    function upload(m) {
      if (m.vao) return m.vao;
      m.vao = gl.createVertexArray();
      gl.bindVertexArray(m.vao);
      const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const db = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, db); gl.bufferData(gl.ARRAY_BUFFER, m.dat, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.UNSIGNED_SHORT, false, 0, 0);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      m.bufs = [pb, db, ib];
      m.pos = m.dat = m.idx = null;
      return m.vao;
    }

    // Tile (units, metres up) → mercator, and → world metres around the city centre.
    function tileToMerc(m, mzu) {
      const span = 1 / 2 ** m.z, s = span / m.E;
      return new Float64Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, mzu, 0, m.x * span, m.y * span, 0, 1]);
    }
    function tileToWorld(m) {
      const span = 1 / 2 ** m.z, s = (span / m.E) * M0;
      return new Float64Array([s, 0, 0, 0, 0, -s, 0, 0, 0, 0, 1, 0, (m.x * span - ox) * M0, -(m.y * span - oy) * M0, 0, 1]);
    }
    const worldToMerc = (mzu) => new Float64Array([1 / M0, 0, 0, 0, 0, -1 / M0, 0, 0, 0, 0, mzu, 0, ox, oy, 0, 1]);

    function visibleMeshes() {
      const out = [];
      const sc = map.style && map.style.sourceCaches && map.style.sourceCaches.omt;
      const seen = new Set();
      if (sc && sc.getVisibleCoordinates) {
        for (const id of sc.getVisibleCoordinates()) {
          const c = id.canonical, key = `${c.z}/${c.x}/${c.y}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const m = meshes.get(key);
          if (m) out.push(m);
        }
      }
      for (const s of sites) if (s.fi !== hiddenSite) out.push(s);
      return out;
    }

    // Orthographic sun view over the area around the map centre.
    function lightMatrix() {
      const c = map.getCenter(), z = map.getZoom();
      const cx = ((c.lng + 180) / 360 - ox) * M0;
      const cy = -((1 - Math.asinh(Math.tan(c.lat * Math.PI / 180)) / Math.PI) / 2 - oy) * M0;
      const R = Math.min(5200, Math.max(260, 700 * 2 ** (16 - z) * (1 + map.getPitch() / 90)));
      // Push the region forward along the view direction, where the pitched view reaches.
      const b = map.getBearing() * Math.PI / 180, fwd = R * 0.35 * Math.min(1, map.getPitch() / 50);
      const px = cx + Math.sin(b) * fwd, py = cy + Math.cos(b) * fwd;
      const L = sun.dir;
      // Re-render the shadow map only when the region, the sun or the drawn tiles change.
      const key = [Math.round(px / (R / 64)), Math.round(py / (R / 64)), Math.round(R), L.map((v) => v.toFixed(3)).join(','), frameSig].join('|');
      if (key === lightKey && light) return light;
      lightKey = key;
      // View basis: forward = -L, up = projection of north (or east) onto the view plane.
      const f = [-L[0], -L[1], -L[2]];
      let up = Math.abs(f[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
      const d = up[0] * f[0] + up[1] * f[1] + up[2] * f[2];
      up = [up[0] - d * f[0], up[1] - d * f[1], up[2] - d * f[2]];
      const ul = Math.hypot(...up); up = up.map((v) => v / ul);
      const rt = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]];
      const eye = [px, py, 0];
      const dot = (a, e) => a[0] * e[0] + a[1] * e[1] + a[2] * e[2];
      const view = new Float64Array([rt[0], up[0], -f[0], 0, rt[1], up[1], -f[1], 0, rt[2], up[2], -f[2], 0, -dot(rt, eye), -dot(up, eye), dot(f, eye), 1]);
      const depth = R + 900;
      const n = -depth, fa = depth;
      const ortho = new Float64Array([1 / R, 0, 0, 0, 0, 1 / R, 0, 0, 0, 0, -2 / (fa - n), 0, 0, 0, -(fa + n) / (fa - n), 1]);
      light = { vp: mul(ortho, view), R, dirty: true };
      return light;
    }

    function ensureShadowTarget() {
      if (fbo) return;
      shadowSize = Math.min(opts.shadowSize || (software ? 2048 : SHADOW_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE));
      depthTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, depthTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, shadowSize, shadowSize);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
      gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { fbo = null; console.warn('shadow framebuffer incomplete'); }
    }

    const growOf = (z) => Math.max(0, Math.min(1, (z - 12.9) / 0.4));

    const layer = {
      id: 'city-buildings', type: 'custom', renderingMode: '3d',
      onAdd(m, g) {
        gl = g;
        prog = compile(VS, FS);
        depthProg = compile(VS_DEPTH, FS_DEPTH);
        groundProg = compile(VS_GROUND, FS_GROUND);
        groundVao = gl.createVertexArray();
        gl.bindVertexArray(groundVao);
        groundBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, groundBuf);
        gl.bufferData(gl.ARRAY_BUFFER, 8 * 4, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
      },
      prerender(g) {
        frameTiles = map.getZoom() >= 12.9 ? visibleMeshes() : [];
        shadowOn = wantShadows && sun.shadow > 0.01 && frameTiles.length > 0;
        if (!shadowOn) return;
        ensureShadowTarget();
        if (!fbo) { shadowOn = false; return; }
        frameSig = frameTiles.map((m) => m.fi != null ? 's' + m.fi : m.z + '/' + m.x + '/' + m.y).join(',');
        const L = lightMatrix();
        if (!L.dirty) return;
        L.dirty = false;
        shadowPasses++;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, shadowSize, shadowSize);
        gl.colorMask(false, false, false, false);
        gl.depthMask(true);
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthRange(0, 1);
        gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE);
        gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3.0);
        gl.useProgram(depthProg.p);
        for (const m of frameTiles) {
          gl.uniformMatrix4fv(depthProg.u.u_light, false, f32(mul(L.vp, tileToWorld(m))));
          gl.bindVertexArray(upload(m));
          gl.drawElements(gl.TRIANGLES, m.ni, gl.UNSIGNED_INT, 0);
        }
        gl.bindVertexArray(null);
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.colorMask(true, true, true, true);
      },
      render(g, matrix) {
        if (!frameTiles.length) return;
        const mm = matrix && matrix.length === 16 ? matrix : matrix.defaultProjectionData.mainMatrix;
        const merc = Float64Array.from(mm);
        const center = map.getCenter();
        const mzu = 1 / (EARTH * Math.cos(center.lat * Math.PI / 180));
        const grow = growOf(map.getZoom());
        const L = shadowOn ? lightMatrix() : null;
        // Camera position in world metres, from the inverse of world → clip.
        const w2c = mul(merc, worldToMerc(mzu));
        const inv = invert(w2c);
        let cam = [0, 0, 1e4];
        if (inv) { const x = inv[8], y = inv[9], z = inv[10], w = inv[11]; if (Math.abs(w) > 1e-12) cam = [x / w, y / w, z / w]; }
        const ctc = map.transform && map.transform.cameraToCenterDistance || 1000;

        // Ground shadows first, blended over the basemap.
        if (L && sun.shadow > 0.01) {
          gl.bindVertexArray(groundVao);
          // Region corners from the light frustum footprint on the ground (z = 0).
          const ilv = invert(L.vp);
          const pts = [];
          for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            // A ray through the light frustum at (sx, sy) meets z = 0.
            const p0 = mulVec(ilv, [sx, sy, -1, 1]), p1 = mulVec(ilv, [sx, sy, 1, 1]);
            const a = [p0[0] / p0[3], p0[1] / p0[3], p0[2] / p0[3]], bb = [p1[0] / p1[3], p1[1] / p1[3], p1[2] / p1[3]];
            const t = a[2] / (a[2] - bb[2]);
            pts.push(a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t);
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, groundBuf);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(pts));
          gl.useProgram(groundProg.p);
          gl.uniformMatrix4fv(groundProg.u.u_matrix, false, f32(w2c));
          gl.uniformMatrix4fv(groundProg.u.u_light, false, f32(L.vp));
          gl.uniform1f(groundProg.u.u_strength, sun.shadow);
          gl.uniform1f(groundProg.u.u_shadowTexel, 1 / shadowSize);
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, depthTex);
          gl.uniform1i(groundProg.u.u_shadow, 0);
          gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.depthMask(false);
          gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
          gl.bindVertexArray(null);
        }

        gl.useProgram(prog.p);
        const u = prog.u;
        gl.disable(gl.BLEND);
        gl.depthMask(true);
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.CULL_FACE);
        gl.uniform3fv(u.u_cam, cam);
        gl.uniform3fv(u.u_sunDir, sun.dir);
        gl.uniform3fv(u.u_sun, sun.color);
        gl.uniform3fv(u.u_sky, sun.sky);
        gl.uniform3fv(u.u_ground, sun.ground);
        gl.uniform3fv(u.u_zenith, sun.zenith);
        gl.uniform3fv(u.u_horizon, sun.horizon);
        gl.uniform3fv(u.u_fog, sun.fog);
        gl.uniform2f(u.u_fogRange, ctc * 1.3, ctc * 4.5);
        gl.uniform1f(u.u_night, sun.night);
        gl.uniform1f(u.u_exposure, sun.exposure);
        gl.uniform1f(u.u_grow, grow);
        gl.uniform1f(u.u_shadowOn, L ? 1 : 0);
        gl.uniform1f(u.u_shadowTexel, 1 / shadowSize);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, depthTex || null);
        gl.uniform1i(u.u_shadow, 0);
        for (const m of frameTiles) {
          const t2m = tileToMerc(m, mzu);
          gl.uniformMatrix4fv(u.u_matrix, false, f32(mul(merc, t2m)));
          const t2w = tileToWorld(m);
          gl.uniformMatrix4fv(u.u_world, false, f32(t2w));
          gl.uniformMatrix4fv(u.u_light, false, f32(L ? mul(L.vp, t2w) : new Float64Array(16)));
          gl.bindVertexArray(upload(m));
          gl.drawElements(gl.TRIANGLES, m.ni, gl.UNSIGNED_INT, 0);
        }
        gl.bindVertexArray(null);
      },
    };
    function mulVec(m, v) {
      return [0, 1, 2, 3].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3]);
    }

    try {
      map.addLayer(layer, map.getLayer('building-3d') ? 'building-3d' : undefined);
    } catch (e) {
      // A driver that rejects the shaders keeps the style's fill-extrusion buildings.
      console.warn('City buildings unavailable:', e && e.message ? e.message : e);
      if (map.getLayer(layer.id)) map.removeLayer(layer.id);
      return null;
    }
    tm.onTile((key, buf) => {
      if (meshes.has(key) || queue.some((q) => q[0] === key)) return;
      queue.push([key, buf]);
      pump();
    });
    sites = meshSites(geo);
    for (const id of FILL_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
    root.TWIN.style.BUILDING_LAYERS.splice(0, Infinity, 'building-ao', 'city-buildings');

    // ── Daylight ──
    const SKY = { // sRGB → linear, matching style.js
      day: ['#20324a', '#56697f'], dawn: ['#1d2540', '#9a7464'], dusk: ['#1c2036', '#a8664c'], night: ['#06080d', '#18202f'],
    };
    const lin = (hex) => [1, 3, 5].map((k) => Math.pow(parseInt(hex.slice(k, k + 2), 16) / 255, 2.2));
    const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
    const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    function applyDaylight(dl) {
      const { sun: s, phase } = dl;
      const el = s.elevation, r = Math.PI / 180;
      const day = smooth(-6, 14, el);
      const warm = (1 - smooth(3, 28, el)) * smooth(-4, 2, el);
      const up = el > 0;
      const az = (up ? s.azimuth : 200) * r, e = Math.max(up ? el : 38, 3) * r;
      const dir = [Math.sin(az) * Math.cos(e), Math.cos(az) * Math.cos(e), Math.sin(e)];
      const sunI = up ? smooth(-0.5, 10, el) * 2.6 : 0.05;
      const sunC = up ? mix([1.0, 0.95, 0.88], [1.0, 0.62, 0.36], warm) : [0.55, 0.65, 0.9];
      const [zen, hor] = SKY[phase].map(lin);
      sun = {
        dir,
        color: sunC.map((v) => v * sunI),
        sky: mix([0.012, 0.016, 0.028], mix([0.30, 0.35, 0.42], [0.32, 0.27, 0.30], warm), day),
        ground: mix([0.006, 0.006, 0.008], [0.11, 0.10, 0.09], day),
        zenith: zen.map((v) => v * 2.4), horizon: hor.map((v) => v * 2.2),
        fog: hor.map((v) => v * 0.9),
        night: 1 - smooth(-8, 6, el),
        // Muted daylight next to the dark basemap; night opens up for the lit windows.
        exposure: 0.36 + 0.46 * (1 - day),
        shadow: up ? 0.62 * smooth(0, 8, el) : 0,
      };
      lightKey = '';
      map.triggerRepaint();
    }
    tm.onDaylight(applyDaylight);

    return {
      hideSite(i) { hiddenSite = i == null ? -1 : i; lightKey = ''; map.triggerRepaint(); },
      get tiles() { return meshes.size; },
      get stats() { let tris = 0; for (const m of frameTiles) tris += m.ni / 3; return { tiles: frameTiles.length, tris: Math.round(tris), meshed: meshes.size, queued: queue.length, shadows: shadowOn ? shadowSize : 0, shadowPasses }; },
    };
  }

  root.TWIN.buildings = { install, _test: { decodeBuildings, meshTile } };
})(typeof window !== 'undefined' ? window : globalThis);

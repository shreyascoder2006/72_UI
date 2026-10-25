/* Facility hero models, authored at real-world scale (metres).

   Local frame: +x along the facility's long axis (rotated to its real heading at
   runtime), +y up, +z toward the street front, origin at the facility point on the
   ground. Geometry is merged into one mesh per material; textured materials are CC0
   Poly Haven PBR sets whose UVs are laid out in metres from world position, so brick
   courses and panel joints run continuously across a building at their true size. */

// Texture sets (Poly Haven, CC0) with their real-world tile size in metres.
export const TEXTURED = {
  slab: { tex: 'concrete_slab_wall', size: 2.3, color: '#e4e0d8' },
  stone: { tex: 'concrete_pavement', size: 1.8, color: '#d8d3ca' },
  plaster: { tex: 'white_plaster_02', size: 1.0, color: '#e9e6df' },
  brick: { tex: 'red_brick_03', size: 1.0 },
  shutter: { tex: 'painted_metal_shutter', size: 2.0, color: '#d9dcdf' },
  louver: { tex: 'painted_metal_shutter', size: 0.9, color: '#6f767d' },
  whiteLouver: { tex: 'painted_metal_shutter', size: 0.5, color: '#f4f4f2' },
  roof: { tex: 'bitumen', size: 7 },
  apron: { tex: 'concrete_floor_02', size: 2.0 },
  fbrick: { tex: 'factory_brick', size: 1.5 },
  tin: { tex: 'corrugated_iron', size: 1.12 },
  gravel: { tex: 'gravel', size: 2.0, color: '#a2abb3' },
  dbrick: { tex: 'brick_wall_10', size: 1.9 },
  grass: { tex: 'sparse_grass', size: 2.0, color: '#b9c2a6' },
  lawn: { tex: 'leafy_grass', size: 2.0, color: '#aab79a' },
  asphalt: { tex: 'asphalt_02', size: 3.0, color: '#8a8a88' },
  concrete: { tex: 'concrete_wall_008', size: 2.71 },
};
// Textures drawn by the build page: decals are fitted to their face, chain-link tiles.
export const GENERATED = {
  helipad: { fit: true, cutout: true }, emergency: { fit: true }, emsSign: { fit: true },
  chainlink: { size: 0.75, alpha: true },
};
// Untextured physically based finishes.
export const PLAIN = {
  glass: { color: '#5b6e80', metalness: 0.6, roughness: 0.05 },
  glassLit: { color: '#536678', metalness: 0.55, roughness: 0.07, emissive: '#000000', night: '#ffcf8a' },
  mullion: { color: '#a0a8b0', metalness: 0.85, roughness: 0.32 },
  trim: { color: '#d7d9db', metalness: 0.1, roughness: 0.6 },
  steel: { color: '#a3aab1', metalness: 0.9, roughness: 0.36 },
  darkSteel: { color: '#3b4046', metalness: 0.75, roughness: 0.45 },
  tank: { color: '#66746c', metalness: 0.35, roughness: 0.55 },
  porcelain: { color: '#7f6f63', metalness: 0.0, roughness: 0.28 },
  white: { color: '#e8eaeb', metalness: 0.05, roughness: 0.45 },
  beige: { color: '#c9c3b4', metalness: 0.2, roughness: 0.55 },
  red: { color: '#b4262c', metalness: 0.1, roughness: 0.45 },
  black: { color: '#121416', metalness: 0.3, roughness: 0.6 },
  yellow: { color: '#d7ad2c', metalness: 0.1, roughness: 0.5 },
  rubber: { color: '#151515', metalness: 0.0, roughness: 0.9 },
  paint: { color: '#f2f2ef', metalness: 0.0, roughness: 0.75 },
  solar: { color: '#14203a', metalness: 0.6, roughness: 0.18 },
  foliage: { color: '#2e3d2b', metalness: 0.0, roughness: 0.85 },
  bark: { color: '#4a3c30', metalness: 0.0, roughness: 0.9 },
  lensRed: { color: '#3a0606', emissive: '#ff2a1f', emissiveIntensity: 2.2 },
  lensAmber: { color: '#2e1c02', emissive: '#ffae1a', emissiveIntensity: 0.15 },
  lensGreen: { color: '#022110', emissive: '#18e07a', emissiveIntensity: 0.15 },
  lamp: { color: '#2a2a28', emissive: '#ffe2b0', emissiveIntensity: 0.0, night: '#ffe2b0' },
  signRed: { color: '#7a0d10', emissive: '#ff3036', emissiveIntensity: 1.0 },
  signPanel: { color: '#1a1c1f', metalness: 0.4, roughness: 0.5 },
  green: { color: '#1f5b39', metalness: 0.2, roughness: 0.5 },
};
const CAR_COLORS = ['#20242a', '#5a5f66', '#8d9196', '#c9ccd0', '#2c3a4f', '#5b1f22', '#e2e3e1', '#3d4334', '#1b1d20', '#6d6250'];

export function createKit(THREE, mergeGeometries, mergeVertices) {
  class Builder {
    constructor() { this.parts = []; }
    add(mat, geo, m) { if (m) geo.applyMatrix4(m); this.parts.push({ mat, geo }); return this; }
    mat4(x, y, z, ry = 0, rx = 0, rz = 0) {
      const m = new THREE.Matrix4();
      m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1));
      return m;
    }
    // Axis-aligned box with its base at y.
    box(mat, w, h, d, x, y, z, ry = 0) { return this.add(mat, new THREE.BoxGeometry(w, h, d), this.mat4(x, y + h / 2, z, ry)); }
    // Box spanning two corners in plan (x0..x1, z0..z1) and y0..y1.
    span(mat, x0, x1, y0, y1, z0, z1) {
      return this.box(mat, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), (x0 + x1) / 2, Math.min(y0, y1), (z0 + z1) / 2);
    }
    cyl(mat, r0, r1, h, x, y, z, seg = 16, rx = 0, rz = 0, ry = 0) {
      const g = new THREE.CylinderGeometry(r1, r0, h, seg);
      g.translate(0, h / 2, 0);
      return this.add(mat, g, this.mat4(x, y, z, ry, rx, rz));
    }
    // Cylinder between two points.
    rod(mat, a, b, r, seg = 8) {
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
      const len = A.distanceTo(B);
      const g = new THREE.CylinderGeometry(r, r, len, seg);
      g.translate(0, len / 2, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
      const m = new THREE.Matrix4().compose(A, q, new THREE.Vector3(1, 1, 1));
      return this.add(mat, g, m);
    }
    sphere(mat, r, x, y, z, sx = 1, sy = 1, sz = 1, seg = 12) {
      const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1));
      g.scale(sx, sy, sz);
      return this.add(mat, g, this.mat4(x, y, z));
    }
    // Decal quad (PlaneGeometry faces +z before rotation) that keeps its own 0..1 UVs.
    decal(mat, w, h, x, y, z, ry = 0, rx = 0) { return this.add(mat, new THREE.PlaneGeometry(w, h), this.mat4(x, y, z, ry, rx)); }
    // Flat quad lying on the ground (or at height y).
    ground(mat, x0, x1, z0, z1, y = 0.03, thick = 0.06) { return this.span(mat, x0, x1, y - thick, y, z0, z1); }
    merge(mats) {
      const byMat = new Map();
      for (const p of this.parts) {
        let g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        if (!(GENERATED[p.mat] && GENERATED[p.mat].fit)) boxUV(g);
        if (!byMat.has(p.mat)) byMat.set(p.mat, []);
        byMat.get(p.mat).push(g);
      }
      const group = new THREE.Group();
      for (const [key, geos] of byMat) {
        const merged = mergeGeometries(geos, false);
        const def = TEXTURED[key] || GENERATED[key];
        const uv = merged.attributes.uv;
        if (def && !def.fit) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / def.size, uv.getY(i) / def.size);
        const mesh = new THREE.Mesh(mergeVertices ? mergeVertices(merged, 1e-4) : merged, mats[key]);
        mesh.name = key;
        mesh.castShadow = !['grass', 'lawn', 'gravel', 'asphalt', 'apron', 'paint'].includes(key);
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      return group;
    }
  }

  // World-space box mapping in metres: walls use (horizontal, height), flats use (x, z).
  function boxUV(g) {
    const pos = g.attributes.position, nor = g.attributes.normal;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (ny >= nx && ny >= nz) { uv[2 * i] = x; uv[2 * i + 1] = z; }
      else if (nx >= nz) { uv[2 * i] = z; uv[2 * i + 1] = y; }
      else { uv[2 * i] = x; uv[2 * i + 1] = y; }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  // ── Reusable elements ────────────────────────────────────────────────────
  // Curtain-wall bands on the four faces of a block: glass strip per floor with mullions.
  function windowBands(b, { x0, x1, z0, z1, y0, floors, fh, sill = 0.9, head = 3.0, pitch = 1.5, glass = 'glassLit', faces = 'nsew', fin = 0.12 }) {
    const W = x1 - x0, D = z1 - z0, out = 0.06;
    for (let f = 0; f < floors; f++) {
      const ya = y0 + f * fh + sill, yb = y0 + f * fh + head;
      const sides = [];
      if (faces.includes('s')) sides.push(['x', x0, x1, z1 + out / 2, 1]);
      if (faces.includes('n')) sides.push(['x', x0, x1, z0 - out / 2, -1]);
      if (faces.includes('e')) sides.push(['z', z0, z1, x1 + out / 2, 1]);
      if (faces.includes('w')) sides.push(['z', z0, z1, x0 - out / 2, -1]);
      for (const [axis, a0, a1, c] of sides) {
        const L = a1 - a0;
        if (axis === 'x') b.span(glass, a0 + 0.3, a1 - 0.3, ya, yb, c - out / 2, c + out / 2);
        else b.span(glass, c - out / 2, c + out / 2, ya, yb, a0 + 0.3, a1 - 0.3);
        const n = Math.max(1, Math.round((L - 0.6) / pitch));
        for (let k = 0; k <= n; k++) {
          const a = a0 + 0.3 + ((L - 0.6) * k) / n;
          if (axis === 'x') b.span('mullion', a - 0.05, a + 0.05, ya - 0.05, yb + 0.05, c - fin, c + fin);
          else b.span('mullion', c - fin, c + fin, ya - 0.05, yb + 0.05, a - 0.05, a + 0.05);
        }
        // transom at mid height and sill flashing
        if (axis === 'x') { b.span('mullion', a0 + 0.3, a1 - 0.3, ya - 0.08, ya, c - fin, c + fin); b.span('mullion', a0 + 0.3, a1 - 0.3, yb, yb + 0.08, c - fin, c + fin); }
        else { b.span('mullion', c - fin, c + fin, ya - 0.08, ya, a0 + 0.3, a1 - 0.3); b.span('mullion', c - fin, c + fin, yb, yb + 0.08, a0 + 0.3, a1 - 0.3); }
      }
    }
  }
  // Punched windows (frame + recessed glass) along one face.
  function punched(b, { axis, a0, a1, c, dir, y0, floors, fh, w = 1.4, h = 1.6, sill = 1.0, pitch = 3.2, glass = 'glassLit' }) {
    const n = Math.max(1, Math.floor((a1 - a0) / pitch));
    const start = (a0 + a1) / 2 - ((n - 1) * pitch) / 2;
    for (let f = 0; f < floors; f++) {
      const ya = y0 + f * fh + sill;
      for (let k = 0; k < n; k++) {
        const a = start + k * pitch;
        if (axis === 'x') {
          b.span(glass, a - w / 2, a + w / 2, ya, ya + h, c - 0.02 * dir, c + 0.02 * dir);
          b.span('trim', a - w / 2 - 0.08, a + w / 2 + 0.08, ya - 0.12, ya, c, c + 0.12 * dir);
          b.span('trim', a - w / 2 - 0.08, a + w / 2 + 0.08, ya + h, ya + h + 0.08, c, c + 0.06 * dir);
          b.span('trim', a - 0.03, a + 0.03, ya, ya + h, c, c + 0.05 * dir);
        } else {
          b.span(glass, c - 0.02 * dir, c + 0.02 * dir, ya, ya + h, a - w / 2, a + w / 2);
          b.span('trim', c, c + 0.12 * dir, ya - 0.12, ya, a - w / 2 - 0.08, a + w / 2 + 0.08);
          b.span('trim', c, c + 0.06 * dir, ya + h, ya + h + 0.08, a - w / 2 - 0.08, a + w / 2 + 0.08);
          b.span('trim', c, c + 0.05 * dir, ya, ya + h, a - 0.03, a + 0.03);
        }
      }
    }
  }
  function parapet(b, mat, x0, x1, z0, z1, y, h = 1.0, t = 0.35, cap = 'trim') {
    b.span(mat, x0, x1, y, y + h, z0, z0 + t); b.span(mat, x0, x1, y, y + h, z1 - t, z1);
    b.span(mat, x0, x0 + t, y, y + h, z0, z1); b.span(mat, x1 - t, x1, y, y + h, z0, z1);
    b.span(cap, x0 - 0.05, x1 + 0.05, y + h, y + h + 0.08, z0 - 0.05, z0 + t + 0.05); b.span(cap, x0 - 0.05, x1 + 0.05, y + h, y + h + 0.08, z1 - t - 0.05, z1 + 0.05);
    b.span(cap, x0 - 0.05, x0 + t + 0.05, y + h, y + h + 0.08, z0, z1); b.span(cap, x1 - t - 0.05, x1 + 0.05, y + h, y + h + 0.08, z0, z1);
  }
  function car(b, x, z, ry, color, len = 4.6) {
    const w = 1.82, k = len / 4.6;
    const m = (lx, ly, lz) => { const c = Math.cos(ry), s = Math.sin(ry); return [x + lx * c + lz * s, ly, z - lx * s + lz * c]; };
    const part = (mat, l, h, wd, lx, ly, lz) => { const p = m(lx, ly, lz); b.box(mat, l, h, wd, p[0], p[1], p[2], ry); };
    part(color, 4.4 * k, 0.62, w, 0, 0.32, 0);
    part(color, 2.3 * k, 0.5, w - 0.16, -0.2 * k, 0.94, 0);
    part('glass', 2.15 * k, 0.4, w - 0.1, -0.2 * k, 0.98, 0);
    for (const [lx, lz] of [[1.4, 0.82], [1.4, -0.82], [-1.4, 0.82], [-1.4, -0.82]]) { const p = m(lx * k, 0, lz); b.cyl('rubber', 0.33, 0.33, 0.24, p[0], p[1] + 0.33, p[2], 12, Math.PI / 2, 0, ry); }
  }
  function ambulance(b, x, z, ry) {
    const m = (lx, lz) => { const c = Math.cos(ry), s = Math.sin(ry); return [x + lx * c + lz * s, z - lx * s + lz * c]; };
    const part = (mat, l, h, w, lx, ly, lz) => { const p = m(lx, lz); b.box(mat, l, h, w, p[0], ly, p[1], ry); };
    part('white', 3.9, 2.15, 2.3, -0.9, 0.55, 0);           // patient module
    part('red', 3.92, 0.28, 2.32, -0.9, 1.25, 0);            // stripe
    part('white', 1.9, 1.2, 2.05, 1.95, 0.55, 0);            // cab
    part('glass', 0.9, 0.55, 2.0, 2.3, 1.15, 0);             // windscreen
    part('red', 0.4, 0.16, 1.6, 1.4, 2.72, 0);               // light bar
    part('lensRed', 0.18, 0.12, 0.4, -2.85, 2.55, 0.85);
    part('lensRed', 0.18, 0.12, 0.4, -2.85, 2.55, -0.85);
    for (const [lx, lz] of [[1.9, 1.0], [1.9, -1.0], [-1.9, 1.0], [-1.9, -1.0]]) { const p = m(lx, lz); b.cyl('rubber', 0.4, 0.4, 0.28, p[0], 0.4, p[1], 12, Math.PI / 2, 0, ry); }
  }
  function tree(b, x, z, h = 8, seed = 1) {
    const r = (k) => { const s = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
    b.cyl('bark', 0.22, 0.16, h * 0.42, x, 0, z, 8);
    for (let k = 0; k < 4; k++) {
      const s = h * (0.22 + 0.1 * r(k));
      b.sphere('foliage', s, x + (r(k + 5) - 0.5) * h * 0.25, h * (0.55 + 0.16 * k / 3), z + (r(k + 9) - 0.5) * h * 0.25, 1, 0.82, 1, 10);
    }
  }
  function lightPole(b, x, z, h = 9, ry = 0) {
    b.cyl('darkSteel', 0.12, 0.08, h, x, 0, z, 10);
    const ax = x + Math.cos(ry) * 1.2, az = z - Math.sin(ry) * 1.2;
    b.rod('darkSteel', [x, h - 0.2, z], [ax, h - 0.05, az], 0.05);
    b.box('darkSteel', 0.75, 0.16, 0.38, ax, h - 0.2, az, ry);
    b.box('lamp', 0.6, 0.03, 0.28, ax, h - 0.23, az, ry);
  }
  function fence(b, x0, x1, z0, z1, h = 2.4, gate = null) {
    const runs = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
    for (const [ax, az, bx, bz] of runs) {
      const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 3);
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
        if (gate && Math.abs(x - gate[0]) < gate[2] && Math.abs(z - gate[1]) < gate[2] && k !== 0 && k !== n) continue;
        b.cyl('steel', 0.05, 0.05, h + 0.4, x, 0, z, 8);
      }
      b.rod('steel', [ax, h, az], [bx, h, bz], 0.03);
      b.rod('steel', [ax, h + 0.25, az], [bx, h + 0.25, bz], 0.008);
      b.rod('steel', [ax, h + 0.4, az], [bx, h + 0.4, bz], 0.008);
      // chain-link fabric (alpha-masked mesh texture)
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, ang = Math.atan2(-(bz - az), bx - ax);
      const g = new THREE.PlaneGeometry(L, h);
      g.translate(0, h / 2, 0);
      b.add('chainlink', g, b.mat4(mx, 0, mz, ang));
    }
  }
  function insulatorStack(b, x, y, z, h = 1.6, r = 0.16, discs = 9) {
    b.cyl('porcelain', 0.07, 0.07, h, x, y, z, 10);
    for (let k = 0; k < discs; k++) b.cyl('porcelain', r, r * 0.8, 0.05, x, y + 0.12 + (k * (h - 0.24)) / (discs - 1), z, 14);
  }
  function lattice(b, x, z, h, w = 1.2) {
    const c = [[-w / 2, -w / 2], [w / 2, -w / 2], [w / 2, w / 2], [-w / 2, w / 2]];
    for (const [dx, dz] of c) b.box('steel', 0.12, h, 0.12, x + dx, 0, z + dz);
    const seg = Math.round(h / 1.6);
    for (let s = 0; s < seg; s++) {
      const y0 = (s * h) / seg, y1 = ((s + 1) * h) / seg;
      for (let i = 0; i < 4; i++) {
        const [ax, az] = c[i], [bx, bz] = c[(i + 1) % 4];
        b.rod('steel', [x + ax, y0, z + az], [x + bx, y1, z + bz], 0.035, 4);
        b.rod('steel', [x + ax, y1, z + az], [x + bx, y1, z + bz], 0.03, 4);
      }
    }
  }
  function signalHead(b, x, y, z, ry, sections = 3) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    let p = at(0, 0);
    b.box('yellow', 0.72, 0.36 * sections + 0.36, 0.04, p[0], y - 0.18, p[1], ry);           // retroreflective border
    p = at(0, 0.03); b.box('black', 0.62, 0.36 * sections + 0.26, 0.05, p[0], y - 0.13, p[1], ry); // backplate
    p = at(0, 0.18); b.box('black', 0.34, 0.36 * sections, 0.3, p[0], y, p[1], ry);
    const lens = ['lensRed', 'lensAmber', 'lensGreen'];
    for (let k = 0; k < sections; k++) {
      const ly = y + 0.36 * (sections - 1 - k) + 0.18;
      const q = at(0, 0.34);
      b.cyl(lens[k], 0.13, 0.13, 0.03, q[0], ly, q[1], 16, Math.PI / 2, 0, ry);
      const v = at(0, 0.42); b.box('black', 0.3, 0.04, 0.16, v[0], ly + 0.15, v[1], ry); // visor
    }
  }

  // ── Facilities ───────────────────────────────────────────────────────────
  function hospital() {
    const b = new Builder();
    // Site: plaza, drives, parking, lawns.
    b.ground('asphalt', -58, 58, -44, 44, 0.03);
    b.ground('lawn', -44, 44, 24, 31, 0.05);
    b.ground('stone', -12, 12, 22, 34, 0.06);
    b.ground('lawn', -44, -26, -40, -30, 0.05); b.ground('lawn', 26, 44, -40, -30, 0.05);
    for (let k = 0; k < 18; k++) { b.ground('paint', -56 + k * 2.8, -56 + k * 2.8 + 0.12, 34, 40, 0.06, 0.01); b.ground('paint', 6 + k * 2.8, 6 + k * 2.8 + 0.12, 34, 40, 0.06, 0.01); }
    for (let k = 0; k < 9; k++) { b.ground('paint', -56, -50.5, -38 + k * 2.8, -38 + k * 2.8 + 0.12, 0.06, 0.01); b.ground('paint', 50.5, 56, -38 + k * 2.8, -38 + k * 2.8 + 0.12, 0.06, 0.01); }
    // Podium (2 floors) in stone cladding with ribbon glazing.
    const P = { x0: -40, x1: 40, z0: -26, z1: 22 };
    b.span('stone', P.x0, P.x1, 0, 9.6, P.z0, P.z1);
    windowBands(b, { ...P, y0: 0, floors: 2, fh: 4.8, sill: 0.6, head: 3.6, pitch: 1.6 });
    b.span('roof', P.x0 + 0.3, P.x1 - 0.3, 9.6, 9.65, P.z0 + 0.3, P.z1 - 0.3);
    parapet(b, 'stone', P.x0, P.x1, P.z0, P.z1, 9.6, 1.0);
    // Main tower (7 floors) and wing (4 floors) on the podium.
    const T = { x0: -30, x1: 18, z0: -15, z1: 6 };
    b.span('slab', T.x0, T.x1, 9.6, 37.6, T.z0, T.z1);
    windowBands(b, { ...T, y0: 9.6, floors: 7, fh: 4.0, sill: 1.0, head: 3.2, pitch: 1.5 });
    for (const x of [T.x0 - 0.2, T.x1 + 0.2]) b.span('slab', x - 0.4, x + 0.4, 9.6, 38.4, T.z0 - 0.6, T.z1 + 0.6);
    b.span('roof', T.x0 + 0.3, T.x1 - 0.3, 37.6, 37.65, T.z0 + 0.3, T.z1 - 0.3);
    parapet(b, 'slab', T.x0, T.x1, T.z0, T.z1, 37.6, 1.1);
    const Wg = { x0: 21, x1: 37, z0: -24, z1: 14 };
    b.span('plaster', Wg.x0, Wg.x1, 9.6, 25.6, Wg.z0, Wg.z1);
    windowBands(b, { ...Wg, y0: 9.6, floors: 4, fh: 4.0, sill: 1.0, head: 3.0, pitch: 1.6 });
    b.span('roof', Wg.x0 + 0.3, Wg.x1 - 0.3, 25.6, 25.65, Wg.z0 + 0.3, Wg.z1 - 0.3);
    parapet(b, 'plaster', Wg.x0, Wg.x1, Wg.z0, Wg.z1, 25.6, 1.0);
    // Mechanical penthouse with louvers, cooling towers.
    b.span('louver', -27, -9, 37.6, 42.4, -12, 2);
    b.span('trim', -27.2, -8.8, 42.4, 42.6, -12.2, 2.2);
    for (let k = 0; k < 3; k++) {
      const x = -6 + k * 4.4;
      b.span('beige', x - 1.8, x + 1.8, 37.6, 41.4, -13, -9.4);
      b.cyl('darkSteel', 1.3, 1.3, 0.6, x, 41.4, -11.2, 20);
    }
    for (let k = 0; k < 4; k++) b.span('beige', 24 + k * 3.2, 26.2 + k * 3.2, 25.6, 27.4, -20, -17.5);
    // Helipad on steel frame over the east end of the tower.
    for (const [dx, dz] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) b.cyl('steel', 0.22, 0.22, 3.4, 9 + dx, 37.6, -4.5 + dz, 10);
    b.cyl('darkSteel', 9.2, 9.2, 0.5, 9, 40.6, -4.5, 40);
    b.decal('helipad', 17.6, 17.6, 9, 41.12, -4.5, 0, -Math.PI / 2);
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; b.box('lensGreen', 0.25, 0.12, 0.25, 9 + Math.cos(a) * 8.9, 41.1, -4.5 + Math.sin(a) * 8.9); }
    // Main entrance canopy and glass vestibule (front, +z).
    b.span('trim', -9, 9, 4.4, 4.9, 22, 30);
    for (const x of [-8.5, 8.5]) for (const z of [26, 29.5]) b.cyl('steel', 0.18, 0.18, 4.4, x, 0, z, 10);
    b.span('glass', -5, 5, 0, 3.6, 22, 24.5);
    // Emergency department canopy on the west end with lit sign and ambulance bays.
    b.span('trim', -56, -40, 4.6, 5.2, -14, 2);
    for (const z of [-13.5, -6, 1.5]) b.cyl('steel', 0.2, 0.2, 4.6, -55.5, 0, z, 10);
    b.span('signPanel', -56.2, -55.8, 5.2, 6.4, -13, 1);
    b.decal('emergency', 12.2, 0.88, -56.24, 5.8, -6, -Math.PI / 2);
    b.ground('apron', -58, -40, -16, 4, 0.06);
    ambulance(b, -49, -10, Math.PI / 2);
    ambulance(b, -49, -2.5, Math.PI / 2);
    // Cars in the lots.
    let n = 0;
    for (let k = 0; k < 17; k++) if ((k * 7) % 5 !== 0) car(b, -54.6 + k * 2.8, 37, Math.PI / 2, 'car' + (n++ % CAR_COLORS.length));
    for (let k = 0; k < 17; k++) if ((k * 3) % 4 !== 1) car(b, 7.4 + k * 2.8, 37, Math.PI / 2, 'car' + (n++ % CAR_COLORS.length));
    for (let k = 0; k < 8; k++) if (k % 3 !== 2) car(b, 53.2, -36.6 + k * 2.8, 0, 'car' + (n++ % CAR_COLORS.length));
    // Trees along the front and light poles.
    for (let k = 0; k < 8; k++) tree(b, -40 + k * 11.4, 28.5, 7.5 + (k % 3), k + 1);
    for (const x of [-30, 0, 30]) lightPole(b, x, 41, 9, Math.PI / 2);
    return b;
  }

  function ems() {
    const b = new Builder();
    b.ground('lawn', -24, 24, -18, 20, 0.03);
    b.ground('apron', -15, 8, 6, 20, 0.05);
    b.ground('asphalt', 8, 22, 6, 20, 0.05);
    // Apparatus bay hall.
    b.span('brick', -14, 8, 0, 7.4, -8, 6);
    const doors = [-9.6, -3.2, 3.2];
    for (const x of doors) {
      b.span('shutter', x - 2.2, x + 2.2, 0, 4.8, 5.95, 6.02);
      b.span('trim', x - 2.45, x + 2.45, 4.8, 5.05, 6, 6.15);
      b.span('trim', x - 2.45, x - 2.2, 0, 4.8, 6, 6.15);
      b.span('trim', x + 2.2, x + 2.45, 0, 4.8, 6, 6.15);
      b.span('glassLit', x - 1.9, x + 1.9, 5.5, 6.6, 6.0, 6.06);
      b.cyl('yellow', 0.12, 0.12, 1.1, x - 2.7, 0, 6.6, 10); b.cyl('yellow', 0.12, 0.12, 1.1, x + 2.7, 0, 6.6, 10);
    }
    b.span('roof', -13.7, 7.7, 7.4, 7.45, -7.7, 5.7);
    parapet(b, 'brick', -14, 8, -8, 6, 7.4, 0.8, 0.3, 'concrete');
    // Two-storey quarters and office.
    b.span('brick', 8, 19, 0, 7.0, -8, 4);
    punched(b, { axis: 'x', a0: 8, a1: 19, c: 4, dir: 1, y0: 0, floors: 2, fh: 3.4, pitch: 3.0 });
    punched(b, { axis: 'z', a0: -8, a1: 4, c: 19, dir: 1, y0: 0, floors: 2, fh: 3.4, pitch: 3.0 });
    b.span('glassLit', 10.5, 12.5, 0, 2.7, 4.0, 4.06);
    b.span('trim', 9.8, 13.2, 2.9, 3.15, 4, 5.6);
    b.span('roof', 8.3, 18.7, 7.0, 7.05, -7.7, 3.7);
    parapet(b, 'brick', 8, 19, -8, 4, 7.0, 0.8, 0.3, 'concrete');
    b.span('signPanel', 9, 18, 7.9, 9.1, 3.75, 3.95);
    b.decal('emsSign', 8.4, 0.88, 13.5, 8.5, 3.97, 0);
    // Rooftop units, flagpole, vehicles.
    b.span('beige', -8, -4.5, 7.4, 8.8, -4, -1.5); b.span('beige', 11, 13.5, 7.0, 8.2, -5, -3);
    b.cyl('steel', 0.08, 0.05, 10, 20.5, 0, 12, 10);
    ambulance(b, -9.6, 11.5, -Math.PI / 2);
    ambulance(b, -3.2, 11.5, -Math.PI / 2);
    car(b, 12, 15, Math.PI / 2, 'car0'); car(b, 15, 15, Math.PI / 2, 'car3'); car(b, 18, 15, Math.PI / 2, 'car6');
    tree(b, -20, -12, 8, 3); tree(b, -20, 12, 7, 5); tree(b, 22, -12, 8.5, 7);
    lightPole(b, 21, 7, 8, Math.PI);
    return b;
  }

  function pump() {
    const b = new Builder();
    b.ground('gravel', -16, 16, -12, 13, 0.03);
    b.ground('apron', -7, 7, 4.5, 8, 0.05);
    // Brick pump house with gable roof.
    const hw = 6, hd = 4.5, eave = 5.0, ridge = 7.3;
    b.span('fbrick', -hw, hw, 0, eave, -hd, hd);
    const gable = new THREE.Shape([new THREE.Vector2(-hd, 0), new THREE.Vector2(hd, 0), new THREE.Vector2(0, ridge - eave)]);
    for (const x of [-hw, hw - 0.3]) {
      const g = new THREE.ExtrudeGeometry(gable, { depth: 0.3, bevelEnabled: false });
      g.rotateY(Math.PI / 2);
      b.add('fbrick', g, b.mat4(x + (x < 0 ? 0 : 0.3), eave, 0));
    }
    const slope = Math.atan2(ridge - eave, hd), L = Math.hypot(hd + 0.5, ridge - eave + 0.35);
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(2 * hw + 0.8, 0.08, L);
      b.add('tin', g, b.mat4(0, eave + (ridge - eave) / 2 + 0.05, side * (hd + 0.5) / 2 - side * 0.05, 0, side * slope));
    }
    b.box('darkSteel', 2 * hw + 0.8, 0.12, 0.3, 0, ridge + 0.02, 0);
    b.span('darkSteel', -1.2, 1.2, 0, 2.4, 4.5, 4.58);
    b.span('louver', -5, -3, 2.6, 3.8, 4.5, 4.56); b.span('louver', 3, 5, 2.6, 3.8, 4.5, 4.56);
    b.span('louver', 6.0, 6.06, 1.6, 3.4, -2, 2);
    // Wet well with grating and discharge piping.
    b.span('concrete', 8.5, 14, 0, 0.9, -3.5, 3.5);
    b.span('darkSteel', 8.8, 13.7, 0.9, 0.96, -3.2, 3.2);
    for (let k = 0; k < 18; k++) b.span('steel', 8.9 + k * 0.27, 8.95 + k * 0.27, 0.96, 1.0, -3.1, 3.1);
    for (const z of [-1.5, 1.5]) {
      b.rod('steel', [6, 1.0, z], [9.5, 1.0, z], 0.32, 16);
      b.cyl('steel', 0.42, 0.42, 0.12, 6.4, 0.58, z, 16, 0, Math.PI / 2);
      b.cyl('steel', 0.32, 0.32, 1.6, 10.5, 0, z, 16);
    }
    // Standby generator and fuel tank.
    b.span('beige', -14, -9.5, 0, 2.3, 5, 7.2);
    b.span('louver', -13.6, -10, 0.6, 1.9, 7.2, 7.25);
    b.cyl('darkSteel', 0.12, 0.12, 1.0, -10.5, 2.3, 6.1, 10);
    b.cyl('white', 0.75, 0.75, 3.2, -12.5, 0.75, -6, 20, 0, Math.PI / 2);
    b.span('concrete', -14.5, -10.5, 0, 0.15, -7.2, -4.8);
    fence(b, -15, 15, -11, 12, 2.2, [0, 12, 2.5]);
    lightPole(b, 14, -9, 7, Math.PI);
    return b;
  }

  function substation() {
    const b = new Builder();
    b.ground('gravel', -28, 28, -21, 21, 0.03);
    // Control house.
    b.span('dbrick', -25, -15, 0, 4.2, 10, 17);
    b.span('roof', -24.8, -15.2, 4.2, 4.25, 10.2, 16.8);
    parapet(b, 'dbrick', -25, -15, 10, 17, 4.2, 0.5, 0.25, 'concrete');
    b.span('darkSteel', -21, -19.8, 0, 2.3, 9.94, 10);
    b.span('beige', -16, -15.2, 1.6, 2.6, 13, 14.5);
    // Transformers with radiator banks, conservator and bushings.
    for (const tx of [-7, 8]) {
      b.span('concrete', tx - 4, tx + 4, 0, 0.3, -9, -1);
      b.span('tank', tx - 2, tx + 2, 0.3, 3.6, -6.8, -3.2);
      for (const side of [-1, 1]) for (let k = 0; k < 12; k++) {
        const x = tx - 1.65 + k * 0.3;
        b.span('tank', x - 0.03, x + 0.03, 0.8, 3.3, side > 0 ? -3.2 : -8.2, side > 0 ? -1.8 : -6.8);
      }
      b.cyl('tank', 0.5, 0.5, 3.4, tx + 1.7, 4.6, -5, 20, 0, Math.PI / 2);
      b.rod('tank', [tx + 1.7, 3.6, -5], [tx + 1.7, 4.2, -5], 0.08);
      for (let k = 0; k < 3; k++) {
        insulatorStack(b, tx - 1.2 + k * 1.2, 3.6, -5.6, 2.2, 0.17, 10);
        insulatorStack(b, tx - 1.0 + k * 1.0, 3.6, -3.8, 1.1, 0.12, 6);
      }
      b.span('darkSteel', tx - 1.6, tx + 1.6, 0.5, 1.3, -8.6, -8.2);
    }
    // Incoming-line dead-end structure: two lattice towers with a beam and insulator strings.
    lattice(b, -12, -18, 15);
    lattice(b, 12, -18, 15);
    b.span('steel', -12.6, 12.6, 14.4, 15.2, -18.4, -17.6);
    for (let k = 0; k < 3; k++) {
      const x = -7 + k * 7;
      for (let d = 0; d < 7; d++) b.cyl('porcelain', 0.15, 0.13, 0.06, x, 13.2 - d * 0.18, -18, 12);
      b.rod('steel', [x, 13.0, -18], [x, 9.5, -12], 0.03, 6);
      b.rod('steel', [x, 13.0, -18], [x, 14.2, -24], 0.03, 6);
    }
    // Bus frames with post insulators and rigid bus.
    for (const x of [-16, 0, 16]) {
      b.box('steel', 0.3, 9, 0.3, x, 0, -12.5); b.box('steel', 0.3, 9, 0.3, x, 0, -11.5);
      b.span('steel', x - 0.2, x + 0.2, 8.6, 9.0, -12.6, -11.4);
    }
    for (let k = 0; k < 3; k++) {
      const z = -12.8 + k * 0.8;
      for (const x of [-16, -8, 0, 8, 16]) insulatorStack(b, x, 9.0, z, 0.9, 0.11, 5);
      b.rod('steel', [-16, 9.95, z], [16, 9.95, z], 0.06, 10);
    }
    // Dead-tank breakers.
    for (let k = 0; k < 4; k++) {
      const x = -15 + k * 10;
      b.span('steel', x - 1.2, x + 1.2, 0, 1.8, 4.2, 4.6);
      b.cyl('tank', 0.55, 0.55, 2.8, x - 1.4, 2.4, 4.4, 18, 0, Math.PI / 2);
      for (const dx of [-0.8, 0.8]) insulatorStack(b, x + dx, 2.9, 4.4, 1.3, 0.12, 7);
      b.span('beige', x + 1.5, x + 2.3, 1.2, 2.6, 4.0, 4.8);
    }
    for (const x of [-20, 20]) b.span('concrete', x - 0.4, x + 0.4, 0.03, 0.12, -16, 14);
    b.span('concrete', -20, 20, 0.03, 0.12, 7.5, 8.3);
    fence(b, -27, 27, -20, 20, 2.4, [0, 20, 3]);
    for (const [x, z] of [[-26, -19], [26, 19]]) lightPole(b, x, z, 9, x < 0 ? 0 : Math.PI);
    return b;
  }

  function traffic() {
    const b = new Builder();
    const W = 10; // half road width (m)
    // Crosswalks, stop bars (on the street surface).
    for (const [axis, sgn] of [['x', 1], ['x', -1], ['z', 1], ['z', -1]]) {
      for (let k = -7; k <= 7; k++) {
        const a = k * 1.25;
        if (axis === 'x') b.ground('paint', sgn * (W + 1) - 1.6, sgn * (W + 1) + 1.6, a - 0.3, a + 0.3, 0.05, 0.01);
        else b.ground('paint', a - 0.3, a + 0.3, sgn * (W + 1) - 1.6, sgn * (W + 1) + 1.6, 0.05, 0.01);
      }
      if (axis === 'x') b.ground('paint', sgn * (W + 3.6) - 0.25, sgn * (W + 3.6) + 0.25, sgn > 0 ? -W : 0.3, sgn > 0 ? -0.3 : W, 0.05, 0.01);
      else b.ground('paint', sgn > 0 ? 0.3 : -W, sgn > 0 ? W : -0.3, sgn * (W + 3.6) - 0.25, sgn * (W + 3.6) + 0.25, 0.05, 0.01);
    }
    for (let k = -1; k <= 1; k += 2) { b.ground('yellow', -W - 6, -W - 3, k * 0.12 - 0.06, k * 0.12 + 0.06, 0.05, 0.01); b.ground('yellow', W + 3, W + 6, k * 0.12 - 0.06, k * 0.12 + 0.06, 0.05, 0.01); }
    // Mast-arm poles on two corners, arms reaching over the approaches.
    const masts = [[W + 3, W + 3, Math.PI, 13], [-W - 3, -W - 3, 0, 13]];
    for (const [px, pz, ry, L] of masts) {
      b.cyl('steel', 0.26, 0.17, 8.2, px, 0, pz, 14);
      b.cyl('concrete', 0.6, 0.6, 0.35, px, 0, pz, 16);
      const ex = px + Math.cos(ry) * L, ez = pz;
      b.rod('steel', [px, 6.6, pz], [ex, 6.9, ez], 0.12, 12);
      b.rod('steel', [px, 7.8, pz], [px + Math.cos(ry) * 3.2, 6.75, pz], 0.05, 8);
      for (let k = 0; k < 3; k++) {
        const sx = px + Math.cos(ry) * (4 + k * 3.6);
        signalHead(b, sx, 5.6, pz, ry === 0 ? Math.PI / 2 : -Math.PI / 2, 3);
      }
      b.box('green', 2.2, 0.45, 0.05, px + Math.cos(ry) * 2.4, 6.15, pz + 0.2, 0);
      // luminaire
      b.rod('steel', [px, 8.0, pz], [px + Math.cos(ry) * 2.6, 8.4, pz - Math.sign(pz) * 1.2], 0.06, 8);
      b.box('darkSteel', 0.8, 0.18, 0.4, px + Math.cos(ry) * 2.6, 8.25, pz - Math.sign(pz) * 1.2, 0);
      b.box('lamp', 0.6, 0.03, 0.3, px + Math.cos(ry) * 2.6, 8.22, pz - Math.sign(pz) * 1.2, 0);
    }
    // Pedestal signals and push buttons on the other corners.
    for (const [px, pz] of [[W + 3, -W - 3], [-W - 3, W + 3]]) {
      b.cyl('steel', 0.1, 0.1, 3.6, px, 0, pz, 10);
      signalHead(b, px, 3.2, pz, px > 0 ? -Math.PI / 2 : Math.PI / 2, 3);
      b.box('black', 0.35, 0.45, 0.25, px, 2.2, pz + Math.sign(-pz) * 0.2, 0);
    }
    // CCTV pole with a PTZ dome, controller cabinet.
    const cx = -W - 4, cz = W + 4.5;
    b.cyl('steel', 0.2, 0.12, 11, cx, 0, cz, 12);
    b.rod('steel', [cx, 10.4, cz], [cx + 1.4, 10.4, cz - 1.4], 0.06, 8);
    b.box('white', 0.45, 0.3, 0.45, cx + 1.4, 10.1, cz - 1.4, 0);
    b.sphere('black', 0.22, cx + 1.4, 10.05, cz - 1.4, 1, 1, 1, 14);
    b.span('concrete', W + 4, W + 6.4, 0, 0.2, W + 4, W + 5.6);
    b.span('beige', W + 4.4, W + 6, 0.2, 1.9, W + 4.3, W + 5.3);
    b.span('beige', W + 4.3, W + 6.1, 1.9, 1.98, W + 4.2, W + 5.4);
    // Corner sidewalk pads.
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.ground('stone', sx * (W + 1.6), sx * (W + 7), sz * (W + 1.6), sz * (W + 7), 0.07);
    return b;
  }

  function weather() {
    const b = new Builder();
    b.ground('lawn', -7, 7, -7, 7, 0.04);
    b.ground('gravel', -1, 1, 7, 9, 0.05);
    b.span('concrete', -1.2, 1.2, 0, 0.25, -1.2, 1.2);
    // Triangular lattice mast, 10 m.
    const r = 0.26, H = 10;
    const leg = (k) => [Math.cos((k / 3) * Math.PI * 2) * r, Math.sin((k / 3) * Math.PI * 2) * r];
    for (let k = 0; k < 3; k++) { const [x, z] = leg(k); b.rod('steel', [x, 0.25, z], [x * 0.7, H, z * 0.7], 0.022, 6); }
    for (let s = 0; s < 22; s++) {
      const y0 = 0.25 + (s * (H - 0.25)) / 22, y1 = 0.25 + ((s + 1) * (H - 0.25)) / 22, t0 = 1 - 0.3 * (y0 / H), t1 = 1 - 0.3 * (y1 / H);
      for (let k = 0; k < 3; k++) {
        const [ax, az] = leg(k), [bx, bz] = leg((k + 1) % 3);
        b.rod('steel', [ax * t0, y0, az * t0], [bx * t1, y1, bz * t1], 0.008, 4);
      }
    }
    // Crossarm with cup anemometer and vane, lightning rod.
    b.rod('steel', [-1.0, H, 0], [1.0, H, 0], 0.025, 8);
    b.cyl('steel', 0.02, 0.02, 0.6, 1.0, H, 0, 8);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      b.rod('steel', [1.0, H + 0.6, 0], [1.0 + Math.cos(a) * 0.28, H + 0.6, Math.sin(a) * 0.28], 0.008, 4);
      b.sphere('black', 0.06, 1.0 + Math.cos(a) * 0.28, H + 0.6, Math.sin(a) * 0.28, 1, 0.8, 1, 10);
    }
    b.cyl('steel', 0.02, 0.02, 0.5, -1.0, H, 0, 8);
    b.box('darkSteel', 0.5, 0.18, 0.02, -1.15, H + 0.45, 0, 0);
    b.sphere('darkSteel', 0.05, -0.8, H + 0.5, 0, 1, 1, 1, 8);
    b.cyl('steel', 0.012, 0.004, 1.4, 0, H, 0, 6);
    // Radiation shield for temperature/humidity at 2 m.
    b.rod('steel', [0, 2.0, 0], [0.7, 2.0, 0], 0.02, 6);
    for (let k = 0; k < 7; k++) b.cyl('white', 0.11, 0.09, 0.03, 0.7, 1.75 + k * 0.06, 0, 16);
    // Stevenson screen on its stand.
    for (const [dx, dz] of [[-0.45, -0.3], [0.45, -0.3], [-0.45, 0.3], [0.45, 0.3]]) b.box('white', 0.06, 1.0, 0.06, -3.5 + dx, 0, 3 + dz);
    b.span('whiteLouver', -4.1, -2.9, 1.0, 1.85, 2.55, 3.45);
    b.box('white', 1.35, 0.06, 1.05, -3.5, 1.85, 3);
    b.box('white', 1.25, 0.12, 0.95, -3.5, 1.91, 3);
    // Rain gauge, solar panel, logger enclosure.
    b.cyl('steel', 0.04, 0.04, 0.8, 3.5, 0, 3.5, 8);
    b.cyl('white', 0.11, 0.11, 0.42, 3.5, 0.8, 3.5, 18);
    b.cyl('steel', 0.04, 0.04, 2.2, 3.5, 0, -3.5, 8);
    b.add('solar', new THREE.BoxGeometry(1.0, 0.04, 0.7), b.mat4(3.5, 2.3, -3.5, 0, -0.6, 0));
    b.span('white', -0.3, 0.3, 1.0, 1.55, 0.3, 0.5);
    fence(b, -6.5, 6.5, -6.5, 6.5, 1.8, [0, 6.5, 1.2]);
    return b;
  }

  return { Builder, hospital, ems, pump, substation, traffic, weather, CAR_COLORS };
}

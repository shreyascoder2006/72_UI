/* The CASCADE twin, loaded in Node for the WhatsApp backend.

   Loads the same engine files the site runs (window.TWIN namespace), builds one engine
   per city, and answers location questions against the crisis registry at the backend's
   simulated clock. Nothing here is a real-time feed: every alert comes from the
   simulated scenario and is labelled as such by the caller. */
const path = require('path');

global.window = global.window || global;
window.TWIN = window.TWIN || {};
const SRC = path.join(__dirname, '../../src/js');
for (const f of ['core', 'data/geodata', 'data/geodata_nagpur', 'engine/scenarios', 'engine/engine', 'engine/analytics', 'engine/population', 'engine/interventions', 'engine/comms']) {
  require(path.join(SRC, f + '.js'));
}
const T = window.TWIN, C = T.core;
const GEOS = window.TWIN_GEOS;
const FOOT_M = 700; // the CAP polygon's radius around each member (comms.cap)
const SEV_RANK = { Extreme: 3, Severe: 2, Moderate: 1 };

const scenariosFor = (city) => Object.values(T.scenarios).filter((s) => !s.cities || s.cities.includes(city));
const DEFAULT_SCEN = { nagpur: 'monsoon2023' };

const engines = new Map(); // `${city}|${scenario}` → engine with analytics
function engine(city, scenario) {
  const key = `${city}|${scenario}`;
  if (!engines.has(key)) {
    const geo = GEOS[city];
    const e = T.engine.create(geo, { scenario });
    const pop = T.population.create(geo);
    e.analytics = T.analytics.create(e, pop.modeled ? { peopleFor: pop.peopleFor } : {});
    e.geo = geo;
    engines.set(key, e);
  }
  return engines.get(key);
}
function scenarioOf(city, id) {
  const list = scenariosFor(city);
  return list.find((s) => s.id === id) || list.find((s) => s.id === DEFAULT_SCEN[city]) || list[0];
}

// ── Geometry ─────────────────────────────────────────────────────────────
function metres(a, b) { // [lng, lat]
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function inside(p, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
function cityAt(lngLat) {
  for (const [id, g] of Object.entries(GEOS)) {
    const [x0, y0, x1, y1] = g.extent;
    if (lngLat[0] >= x0 - 0.05 && lngLat[0] <= x1 + 0.05 && lngLat[1] >= y0 - 0.05 && lngLat[1] <= y1 + 0.05) return id;
  }
  return null;
}
// A place name typed by the user: a district label or a facility's district or name.
function placeNamed(text) {
  const q = text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (q.length < 3) return null;
  let best = null;
  for (const [city, g] of Object.entries(GEOS)) {
    const cands = [
      ...(g.districts || []).map((d) => ({ name: d.name, lngLat: d.lngLat })),
      ...g.facilities.map((f) => ({ name: f.district, lngLat: f.lngLat })),
    ];
    for (const c of cands) {
      if (!c.name) continue;
      const n = c.name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (n.length >= 3 && (` ${q} `.includes(` ${n} `) || q === n)) {
        if (!best || n.length > best.len) best = { city, name: titleCase(c.name), lngLat: c.lngLat, len: n.length };
      }
    }
  }
  return best;
}
const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());

// ── Crisis registry at a simulated time ──────────────────────────────────
function snapshot(city, scenario, t) {
  const e = engine(city, scenario), k = e.kOf(t), tk = k * e.DT;
  const reg = e.analytics.crises(k);
  const alerts = reg.list.map((c) => ({
    c, g: T.comms.grade(c, tk),
    ring: T.comms.footprint(c.members.map((i) => e.F[i].lngLat), FOOT_M),
  })).sort((a, b) => SEV_RANK[b.g.severity] - SEV_RANK[a.g.severity] || a.g.eta - b.g.eta);
  return { e, k, t: tk, geo: e.geo, alerts };
}
// Where a point stands against the alert areas: inside one, near one, or clear.
function assess(snap, lngLat) {
  const F = snap.e.F;
  const rows = snap.alerts.map((a) => {
    const near = Math.min(...a.c.members.map((i) => metres(lngLat, F[i].lngLat)));
    return { a, inside: inside(lngLat, a.ring), near };
  });
  const within = rows.filter((r) => r.inside);
  const close = rows.filter((r) => !r.inside && r.near <= FOOT_M + 1500).sort((x, y) => x.near - y.near);
  // The facilities closest to the point, with their modeled state now.
  const R = snap.e.now.subarray(snap.k * snap.e.N, (snap.k + 1) * snap.e.N);
  const nearby = F.map((f, i) => ({ i, f, d: metres(lngLat, f.lngLat), r: R[i] })).filter((x) => x.f.type !== 'weather').sort((x, y) => x.d - y.d).slice(0, 3);
  return { within, close, nearby, status: within.length ? 'unsafe' : close.length ? 'caution' : 'clear' };
}

// The cascade behind one crisis: when each member crossed (or is forecast to cross)
// HIGH RISK and CRITICAL, and which upstream facility drives it most.
function cascadeOf(snap, c) {
  const e = snap.e, F = e.F, mem = new Set(c.members);
  const seq = e.cascade(snap.k).filter((s) => mem.has(s.i)).sort((a, b) => a.t - b.t);
  const driver = (i) => {
    let best = null;
    try { for (const d of e.explain(snap.k, i).drivers) if (d.kind === 'edge' && (!best || d.value > best.value)) best = d; } catch (err) { /* no drivers */ }
    return best && best.value > 0.01 ? { ...F[best.from], mechanism: best.mechanism } : null;
  };
  return seq.map((s) => ({ ...s, f: F[s.i], from: driver(s.i) }));
}

module.exports = { T, C, GEOS, FOOT_M, SEV_RANK, engine, scenarioOf, scenariosFor, snapshot, assess, cascadeOf, cityAt, placeNamed, metres };

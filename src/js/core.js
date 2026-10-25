/* Shared namespace, risk vocabulary, seeded randomness and small helpers.
   Every module is a classic script that attaches itself to window.TWIN, so the
   app runs from file://, a static server, or a sandboxed frame without a bundler. */
(function (root) {
  const TWIN = (root.TWIN = root.TWIN || {});

  // ── Risk states ──────────────────────────────────────────────────────────
  const STATES = [
    { key: 'normal',   label: 'NORMAL',    min: 0.0 },
    { key: 'watch',    label: 'WATCH',     min: 0.35 },
    { key: 'high',     label: 'HIGH RISK', min: 0.55 },
    { key: 'critical', label: 'CRITICAL',  min: 0.75 },
  ];
  const CRIT = 0.75;
  function stateOf(r) {
    if (r >= 0.75) return STATES[3];
    if (r >= 0.55) return STATES[2];
    if (r >= 0.35) return STATES[1];
    return STATES[0];
  }
  // Risk colors, shared by CSS (via tokens), the map and the canvas charts.
  const RISK_HEX = { normal: '#3fb27f', watch: '#e2b93b', high: '#ee8a2a', critical: '#e5484d' };
  function riskColor(r) { return RISK_HEX[stateOf(r).key]; }

  const TYPES = {
    drainage: { label: 'Drainage', short: 'DRN', layer: 'drainage' },
    traffic:  { label: 'Traffic',  short: 'TRF', layer: 'traffic' },
    power:    { label: 'Power',    short: 'PWR', layer: 'power' },
    hospital: { label: 'Hospital & EMS', short: 'HSP', layer: 'hospital' },
    weather:  { label: 'Weather',  short: 'WX',  layer: 'weather' },
  };

  // ── Seeded randomness ────────────────────────────────────────────────────
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash3(a, b, c) {
    let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d);
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  // Smooth value noise in time, in [-1, 1], knots every `span` steps.
  function tnoise(seedA, seedB, k, span) {
    const k0 = Math.floor(k / span), f = k / span - k0;
    const a = hash3(seedA, seedB, k0) * 2 - 1, b = hash3(seedA, seedB, k0 + 1) * 2 - 1;
    const s = f * f * (3 - 2 * f);
    return a + (b - a) * s;
  }
  function gauss(rand) {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ── Math ─────────────────────────────────────────────────────────────────
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));
  const bump = (t, mu, sd) => Math.exp(-0.5 * ((t - mu) / sd) ** 2);
  function quantile(sortedPairs, q) {
    // sortedPairs: [[value, weight]] sorted by value, weights summing to 1
    let acc = 0;
    for (const [v, w] of sortedPairs) { acc += w; if (acc >= q) return v; }
    return sortedPairs.length ? sortedPairs[sortedPairs.length - 1][0] : NaN;
  }

  // ── Geography ────────────────────────────────────────────────────────────
  const R_EARTH = 6371008.8;
  function haversine(a, b) {
    const toR = Math.PI / 180;
    const dLat = (b[1] - a[1]) * toR, dLon = (b[0] - a[0]) * toR;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R_EARTH * Math.asin(Math.sqrt(s));
  }
  function bearing(a, b) {
    const toR = Math.PI / 180;
    const y = Math.sin((b[0] - a[0]) * toR) * Math.cos(b[1] * toR);
    const x = Math.cos(a[1] * toR) * Math.sin(b[1] * toR) - Math.sin(a[1] * toR) * Math.cos(b[1] * toR) * Math.cos((b[0] - a[0]) * toR);
    return (Math.atan2(y, x) * 180) / Math.PI;
  }
  // Measure a polyline once so points can be sampled along it by distance.
  function measure(path) {
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + haversine(path[i - 1], path[i]));
    return { path, cum, total: cum[cum.length - 1] };
  }
  function along(m, d) {
    const { path, cum, total } = m;
    if (d <= 0) return { p: path[0], b: bearing(path[0], path[1] || path[0]) };
    if (d >= total) { const n = path.length; return { p: path[n - 1], b: bearing(path[n - 2] || path[n - 1], path[n - 1]) }; }
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
    const t = (d - cum[lo]) / (cum[hi] - cum[lo] || 1);
    const a = path[lo], b = path[hi];
    return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], b: bearing(a, b) };
  }

  // ── Formatting ───────────────────────────────────────────────────────────
  const pct = (x, d = 0) => (x * 100).toFixed(d) + '%';
  const fmtT = (t) => 'T+' + (Math.round(t * 10) / 10).toFixed(1) + 'h';
  function fmtDur(h) {
    if (!isFinite(h)) return '—';
    if (h < 1) return Math.round(h * 60) + ' min';
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return mm ? `${hh}h ${String(mm).padStart(2, '0')}m` : `${hh}h`;
  }
  function clockAt(t0, t) {
    const d = new Date(new Date(t0).getTime() + t * 3600e3);
    // Render in America/New_York regardless of the viewer's zone.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', weekday: 'short', day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d).reduce((o, p) => ((o[p.type] = p.value), o), {});
    return { day: `${parts.weekday} ${parts.day} ${parts.month}`.toUpperCase(), time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`, hour: (+parts.hour % 24) + +parts.minute / 60 };
  }

  TWIN.core = {
    STATES, CRIT, stateOf, RISK_HEX, riskColor, TYPES,
    mulberry32, hash3, tnoise, gauss,
    clamp, lerp, sigmoid, bump, quantile,
    haversine, bearing, measure, along,
    pct, fmtT, fmtDur, clockAt,
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* Infrastructure and cascade layers on top of the basemap.

   Static geometry is built once from TWIN_GEO. Each segment, pond, service area and
   overlay carries the indices and weights of the facilities that drive it, so a time
   change only swaps one literal array of facility risks into each layer's paint
   expressions; no GeoJSON is re-uploaded except the small flows/arcs sources. */
(function (root) {
  const { RISK_HEX, haversine } = root.TWIN.core;
  const G = root.TWIN.geom;
  const BEFORE = 'building-3d';
  const FLOW_HEX = { water: '#58a6f0', traffic: '#f0a23a', cascade: '#f2575c' };

  const fc = (features) => ({ type: 'FeatureCollection', features });
  const line = (coords, props) => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } });
  const poly = (ring, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } });
  const point = (c, props) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: c } });

  function install(map, geo, opts = {}) {
    const F = geo.facilities, N = F.length, PAD = N;
    const lat = geo.center[1];
    const frame = G.frame(geo.center);
    const isType = (t) => F.map((f, i) => (f.type === t ? i : -1)).filter((i) => i >= 0);
    const drainIdx = isType('drainage'), trafficIdx = isType('traffic'), powerIdx = isType('power');
    const mid = (g) => g[Math.floor(g.length / 2)];

    function nearest(list, p, maxD) {
      let best = PAD, bd = Infinity;
      for (const i of list) { const d = haversine(p, F[i].lngLat); if (d < bd) { bd = d; best = i; } }
      return bd <= maxD ? { i: best, d: bd } : { i: PAD, d: Infinity };
    }
    const infl = (arr, n) => { const o = {}; for (let q = 0; q < n; q++) { o['f' + q] = arr[q] ? arr[q][0] : PAD; o['w' + q] = arr[q] ? arr[q][1] : 0; } return o; };

    // ── Static sources ──
    const drn = fc(geo.drainage.map((s) => line(s.g, { m: s.m, ...infl(s.i, 2) })));
    const basins = fc(geo.basins.map((b) => poly(b.g, infl(b.i, 1))));
    const cor = fc(geo.corridors.map((s) => {
      const p = mid(s.g);
      const t = nearest(trafficIdx, p, 750), d = nearest(drainIdx, p, 420);
      return line(s.g, {
        c: s.c, ...infl(s.i, 3),
        tf: t.i, tw: t.i === PAD ? 0 : Math.exp(-t.d / 420),
        df: d.i, dw: d.i === PAD ? 0 : Math.exp(-d.d / 220),
      });
    }));
    const subs = fc(geo.substations.map((s) => {
      const n = nearest(powerIdx, s.lngLat, 1e9);
      return point(s.lngLat, { mon: s.fac != null ? 1 : 0, f: n.i, w: s.fac != null ? 1 : Math.exp(-n.d / 2600), v: s.voltage });
    }));
    const cov = fc(geo.substations.filter((s) => s.cell.length > 3).map((s) => {
      const n = nearest(powerIdx, s.lngLat, 1e9);
      return poly(s.cell, { f: n.i, w: s.fac != null ? 1 : Math.exp(-n.d / 2600) });
    }));
    const hsp = fc(F.map((f, i) => (f.type === 'hospital' && f.beds ? point(f.lngLat, { fi: i, beds: f.beds }) : null)).filter(Boolean));
    // Flood extents: buffered creek reaches near each gauge.
    const floods = [];
    for (const s of geo.drainage) {
      const top = s.i[0];
      if (!top || top[1] < 0.32) continue;
      const f = F[top[0]];
      const d = G.nearestDist(s.g, f.lngLat);
      if (d > 1100) continue;
      const ring = G.bufferLine(s.g, s.m ? 26 : 13, frame);
      if (ring) floods.push(poly(ring, { df: top[0], w: Math.min(1, top[1] * 1.2) * Math.exp(-d / 900) }));
    }
    const districts = fc(geo.districts.map((d) => point(d.lngLat, { name: d.name })));

    const add = (id, src) => map.addSource(id, { type: 'geojson', data: src, tolerance: 0.2 });
    add('drn', drn); add('basin', basins); add('cor', cor); add('sub', subs); add('cov', cov); add('hsp', hsp);
    add('flood', fc(floods)); add('flows', fc([])); add('arcs', fc([])); add('districts', districts); add('sel', fc([])); add('hl', fc([]));

    // ── Images ──
    for (const [k, hex] of Object.entries(FLOW_HEX)) map.addImage('chev-' + k, chevron(hex), { pixelRatio: 2 });
    map.addImage('hatch', hatch(), { pixelRatio: 2 });

    // ── Layers ──
    const R0 = new Array(N + 1).fill(0.1);
    const L = (spec, before = BEFORE) => map.addLayer(spec, before);
    const meters = (m) => G.metersExpr(lat, m);

    L({ id: 'cov-fill', type: 'fill', source: 'cov', paint: { 'fill-color': '#b39af0', 'fill-opacity': 0.06 } });
    L({ id: 'cov-line', type: 'line', source: 'cov', paint: { 'line-color': '#7d6bb0', 'line-width': 0.8, 'line-opacity': 0.35, 'line-dasharray': [3, 2] } });
    L({ id: 'outage', type: 'fill', source: 'cov', paint: { 'fill-pattern': 'hatch', 'fill-opacity': 0 } });
    L({ id: 'basin-fill', type: 'fill', source: 'basin', paint: { 'fill-color': '#2f7fbf', 'fill-opacity': 0.35 } });
    L({ id: 'drn-line', type: 'line', source: 'drn', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#2f7fbf', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, ['case', ['==', ['get', 'm'], 1], 1.1, 0.5], 17, ['case', ['==', ['get', 'm'], 1], 4, 1.8]], 'line-opacity': 0.85 } });
    L({ id: 'cor-line', type: 'line', source: 'cor', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#3fb27f', 'line-opacity': 0.75,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['match', ['get', 'c'], 'motorway', 1.4, 'trunk', 1.2, 'primary', 1, 0.7], 17, ['match', ['get', 'c'], 'motorway', 6, 'trunk', 5, 'primary', 4, 3]] } });
    // AR ground overlays
    L({ id: 'ar-cong', type: 'line', source: 'cor', filter: ['!=', ['get', 'tf'], PAD], layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ee8a2a', 'line-width': meters(['match', ['get', 'c'], 'motorway', 30, 'trunk', 24, 20]), 'line-opacity': 0, 'line-blur': 1.5 } });
    L({ id: 'flood-fill', type: 'fill', source: 'flood', paint: { 'fill-color': '#3f8fdc', 'fill-opacity': 0 } });
    L({ id: 'flood-edge', type: 'line', source: 'flood', paint: { 'line-color': '#e5484d', 'line-width': 1, 'line-opacity': 0, 'line-blur': 0.6 } });
    L({ id: 'ar-flood', type: 'line', source: 'cor', filter: ['!=', ['get', 'df'], PAD], layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#3f8fdc', 'line-width': meters(['match', ['get', 'c'], 'motorway', 32, 'trunk', 26, 22]), 'line-opacity': 0, 'line-blur': 1 } });
    L({ id: 'ar-flood-edge', type: 'line', source: 'cor', filter: ['!=', ['get', 'df'], PAD],
      paint: { 'line-color': '#e5484d', 'line-width': 1.4, 'line-opacity': 0, 'line-dasharray': [2, 1.5] } });
    L({ id: 'hsp-ring', type: 'circle', source: 'hsp',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, ['+', 5, ['*', 0.3, ['sqrt', ['get', 'beds']]]], 16, ['+', 18, ['*', 2.2, ['sqrt', ['get', 'beds']]]]],
        'circle-color': '#3fb27f', 'circle-opacity': 0.12, 'circle-stroke-width': 1.2, 'circle-stroke-color': '#3fb27f', 'circle-stroke-opacity': 0.7,
        'circle-pitch-alignment': 'map', 'circle-pitch-scale': 'map',
      } });
    L({ id: 'sub-pt', type: 'circle', source: 'sub', filter: ['==', ['get', 'mon'], 0],
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2, 16, 5], 'circle-color': '#b39af0', 'circle-opacity': 0.85, 'circle-stroke-color': '#0b0d10', 'circle-stroke-width': 1, 'circle-pitch-alignment': 'map' } });
    L({ id: 'hl', type: 'line', source: 'hl', paint: { 'line-color': '#ffffff', 'line-width': 2.2, 'line-opacity': 0, 'line-blur': 1 } });
    // Cascade flows
    L({ id: 'flows-glow', type: 'line', source: 'flows', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['match', ['get', 'kind'], 'water', FLOW_HEX.water, 'traffic', FLOW_HEX.traffic, FLOW_HEX.cascade],
        'line-width': ['+', 4, ['*', 10, ['get', 'flow']]], 'line-blur': 6, 'line-opacity': ['+', 0.12, ['*', 0.4, ['get', 'flow']]] } });
    L({ id: 'flows-dash', type: 'line', source: 'flows', layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': ['match', ['get', 'kind'], 'water', '#a9d3ff', 'traffic', '#ffd08a', '#ffb0b2'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.4, 17, 3.2], 'line-opacity': 0.9, 'line-dasharray': [0, 4, 3] } });
    L({ id: 'flows-arrow', type: 'symbol', source: 'flows',
      layout: {
        'symbol-placement': 'line', 'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 11, 60, 17, 140],
        'icon-image': ['concat', 'chev-', ['get', 'kind']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.42, 14, 0.7, 17, 1.15],
        'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': ['+', 0.55, ['*', 0.45, ['get', 'flow']]] } });

    // Above the buildings
    map.addLayer({ id: 'arcs-confirmed', type: 'line', source: 'arcs', filter: ['==', ['get', 'status'], 'confirmed'], layout: { visibility: 'none', 'line-cap': 'round' },
      paint: { 'line-color': '#79a7e3', 'line-width': ['+', 0.8, ['*', 4, ['get', 'mean']]], 'line-opacity': ['case', ['==', ['get', 'active'], 1], 0.95, 0.55] } });
    map.addLayer({ id: 'arcs-candidate', type: 'line', source: 'arcs', filter: ['==', ['get', 'status'], 'candidate'], layout: { visibility: 'none' },
      paint: { 'line-color': '#8a939e', 'line-width': 1, 'line-opacity': 0.45, 'line-dasharray': [2, 2] } });
    map.addLayer({ id: 'arcs-pruned', type: 'line', source: 'arcs', filter: ['==', ['get', 'status'], 'pruned'], layout: { visibility: 'none' },
      paint: { 'line-color': '#e5484d', 'line-width': 1, 'line-opacity': 0.4, 'line-dasharray': [0.6, 2.2] } });
    map.addLayer({ id: 'sel-ring', type: 'circle', source: 'sel',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 10, 17, 34], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.4, 'circle-stroke-opacity': 0.85, 'circle-pitch-alignment': 'map' } });
    map.addLayer({ id: 'district-label', type: 'symbol', source: 'districts', maxzoom: 15.2,
      layout: { 'text-field': ['get', 'name'], 'text-font': opts.labelFont || ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9, 15, 11.5], 'text-letter-spacing': 0.36, 'text-allow-overlap': false },
      paint: { 'text-color': 'rgba(196,206,220,0.4)', 'text-halo-color': 'rgba(8,10,12,0.75)', 'text-halo-width': 0.8, 'text-halo-blur': 0.6 } });

    // ── Visibility groups ──
    const GROUPS = {
      drainage: ['drn-line', 'basin-fill', 'flood-fill', 'flood-edge', 'ar-flood', 'ar-flood-edge'],
      traffic: ['cor-line', 'ar-cong'],
      power: ['cov-fill', 'cov-line', 'outage', 'sub-pt'],
      hospital: ['hsp-ring'],
      flows: ['flows-glow', 'flows-dash', 'flows-arrow'],
      arcs: ['arcs-confirmed', 'arcs-candidate', 'arcs-pruned'],
      labels: ['road-label', 'district-label'],
      buildings: ['building-3d'],
    };
    function setGroup(key, on) {
      for (const id of GROUPS[key] || []) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    }

    // ── Updates ──
    const riskRamp = (v) => ['interpolate', ['linear'], v, 0.34, RISK_HEX.normal, 0.36, RISK_HEX.watch, 0.54, RISK_HEX.watch, 0.56, RISK_HEX.high, 0.74, RISK_HEX.high, 0.76, RISK_HEX.critical];
    const ramp01 = (v, a, b) => ['min', 1, ['max', 0, ['/', ['-', v, a], b - a]]];

    function update(R, ctx) {
      const lit = ['literal', Array.from(R).concat([0])];
      const at = (key) => ['at', ['get', key], lit];
      const exc = (key, base) => ['max', 0, ['-', at(key), base]];

      // Traffic: class baseline scaled by time of day, plus nearby facility stress.
      const cong = ['+', ['*', ['match', ['get', 'c'], 'motorway', 0.24, 'trunk', 0.22, 'primary', 0.19, 0.15], ctx.diurnal],
        ['*', 1.2, ['+', ['*', ['get', 'w0'], exc('f0', 0.22)], ['*', ['get', 'w1'], exc('f1', 0.22)], ['*', ['get', 'w2'], exc('f2', 0.22)]]]];
      map.setPaintProperty('cor-line', 'line-color', ['interpolate', ['linear'], cong, 0.3, '#2b8a62', 0.42, RISK_HEX.watch, 0.58, RISK_HEX.high, 0.72, RISK_HEX.critical]);
      map.setPaintProperty('cor-line', 'line-opacity', ['interpolate', ['linear'], cong, 0.3, 0.45, 0.45, 0.85, 0.7, 1]);

      // Drainage capacity
      const cap = ['+', 0.16, ['*', 1.05, ['+', ['*', ['get', 'w0'], exc('f0', 0.08)], ['*', ['get', 'w1'], exc('f1', 0.08)]]]];
      const capColor = ['interpolate', ['linear'], cap, 0.3, '#2a6fa8', 0.45, '#3f93d8', 0.55, RISK_HEX.watch, 0.68, RISK_HEX.high, 0.8, RISK_HEX.critical];
      map.setPaintProperty('drn-line', 'line-color', capColor);
      const bcap = ['+', 0.16, ['*', 1.05, ['*', ['get', 'w0'], exc('f0', 0.08)]]];
      map.setPaintProperty('basin-fill', 'fill-color', ['interpolate', ['linear'], bcap, 0.3, '#2a6fa8', 0.45, '#3f93d8', 0.55, RISK_HEX.watch, 0.68, RISK_HEX.high, 0.8, RISK_HEX.critical]);

      // Power service areas and outage hatching
      const pv = ['+', 0.22, ['*', ['get', 'w'], ['-', at('f'), 0.22]]];
      map.setPaintProperty('cov-fill', 'fill-color', riskRamp(pv));
      map.setPaintProperty('cov-fill', 'fill-opacity', ['interpolate', ['linear'], pv, 0.5, 0.025, 0.6, 0.08, 0.78, 0.18]);
      map.setPaintProperty('outage', 'fill-opacity', ['*', 0.6, ramp01(pv, 0.62, 0.88)]);

      // Hospitals
      map.setPaintProperty('hsp-ring', 'circle-color', riskRamp(at('fi')));
      map.setPaintProperty('hsp-ring', 'circle-stroke-color', riskRamp(at('fi')));
      map.setPaintProperty('hsp-ring', 'circle-opacity', ['interpolate', ['linear'], at('fi'), 0.4, 0.1, 0.8, 0.24]);

      // AR ground overlays
      map.setPaintProperty('ar-cong', 'line-color', riskRamp(at('tf')));
      map.setPaintProperty('ar-cong', 'line-opacity', ['*', 0.5, ['get', 'tw'], ramp01(at('tf'), 0.5, 0.78)]);
      map.setPaintProperty('ar-flood', 'line-opacity', ['*', 0.62, ['get', 'dw'], ramp01(at('df'), 0.5, 0.8)]);
      map.setPaintProperty('ar-flood-edge', 'line-opacity', ['*', 0.9, ['get', 'dw'], ramp01(at('df'), 0.68, 0.85)]);
      map.setPaintProperty('flood-fill', 'fill-opacity', ['*', 0.5, ['get', 'w'], ramp01(at('df'), 0.45, 0.85)]);
      map.setPaintProperty('flood-edge', 'line-opacity', ['*', 0.6, ['get', 'w'], ramp01(at('df'), 0.7, 0.9)]);

      // Flows and arcs
      map.getSource('flows').setData(fc(ctx.flows.map((f) => line(f.path, { kind: f.kind, flow: f.flow }))));
      if (ctx.arcs) map.getSource('arcs').setData(fc(ctx.arcs.map((a) => line(a.path, { status: a.status, mean: a.mean, active: a.active ? 1 : 0 }))));
    }

    function select(i) {
      map.getSource('sel').setData(fc(i == null ? [] : [point(F[i].lngLat, {})]));
    }

    // Briefly outline the ground footprint driven by facility i (alert click).
    let hlAnim = 0;
    function highlight(i) {
      const feats = [];
      for (const f of cor.features) if (f.properties.df === i || f.properties.tf === i) feats.push(f);
      for (const f of floods) if (f.properties.df === i) feats.push({ ...f, geometry: { type: 'LineString', coordinates: f.geometry.coordinates[0] } });
      map.getSource('hl').setData(fc(feats));
      const t0 = performance.now();
      cancelAnimationFrame(hlAnim);
      const step = (t) => {
        const e = (t - t0) / 1000;
        if (e > 4.2) { map.setPaintProperty('hl', 'line-opacity', 0); return; }
        map.setPaintProperty('hl', 'line-opacity', 0.25 + 0.65 * Math.abs(Math.sin(e * 3.2)) * Math.max(0, 1 - e / 4.2));
        hlAnim = requestAnimationFrame(step);
      };
      hlAnim = requestAnimationFrame(step);
    }

    // Marching dashes along active flows.
    const DASH = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];
    let dashStep = -1;
    function tick(now) {
      const s = Math.floor(now / 60) % DASH.length;
      if (s !== dashStep && map.getLayer('flows-dash')) { dashStep = s; map.setPaintProperty('flows-dash', 'line-dasharray', DASH[s]); }
    }

    update(R0, { diurnal: 1, flows: [], arcs: [] });
    return { update, setGroup, select, highlight, tick, FLOW_HEX };
  }

  function chevron(hex) {
    const W = 48, H = 48, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.shadowColor = hex; g.shadowBlur = 8;
    g.fillStyle = hex;
    g.beginPath();
    g.moveTo(8, 12); g.lineTo(26, 12); g.lineTo(40, 24); g.lineTo(26, 36); g.lineTo(8, 36); g.lineTo(22, 24); g.closePath();
    g.globalAlpha = 0.95; g.fill();
    return g.getImageData(0, 0, W, H);
  }
  function hatch() {
    const S = 24, c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(229,72,77,0.10)'; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(229,72,77,0.55)'; g.lineWidth = 2.2;
    for (let o = -S; o <= S; o += 8) { g.beginPath(); g.moveTo(o, S); g.lineTo(o + S, 0); g.stroke(); }
    return g.getImageData(0, 0, S, S);
  }

  root.TWIN.layers = { install, FLOW_HEX };
})(typeof window !== 'undefined' ? window : globalThis);

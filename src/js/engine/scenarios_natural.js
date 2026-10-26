/* Twenty natural-calamity scenarios, added to the catalogue in scenarios.js.

   Each one is a different way for a city to fail, chosen so that no two produce the
   same dashboard. A scenario differs from its neighbours along four axes:

     dominant system   which system takes the first and heaviest load — drainage,
                       power, telecom, traffic, EMS or hospitals. A hailstorm and a
                       river flood are both weather, and they load opposite ends of
                       the city.
     onset and shape   how fast it arrives and how long it stays: a derecho is forty
                       minutes, an ice storm is two days, a drought is the whole window.
     footprint         city-wide, a corridor, a catchment, or scattered points.
     cascade or not    whether stress circulates through the learned links (Cascade-R
                       above 1) or simply arrives from the hazard and leaves.

   Nothing here changes the engine. A scenario supplies rain (mm/h), heat and wind
   (0..1) at a site, and may add non-weather stress per facility through `extra` — the
   same four channels scenarios.js already uses. Geography is kept honest: Raleigh gets
   Piedmont hazards (tropical remnants, ice, derechos, tornadoes), Nagpur gets Vidarbha
   ones (monsoon depressions, pre-monsoon heat, hail, lightning, dust, dam releases).
   Every one is a modeled scenario, not a reconstruction of a specific event. */
(function (root) {
  const T = root.TWIN;
  const { bump, gauss, clamp } = T.core;
  const S = T.scenarios;

  const MODELED = {
    kind: 'modeled', label: 'Modeled scenario',
    note: 'The hazard, sensor streams, citizen reports and outcomes are simulated. Facilities, streets and rivers are real (OpenStreetMap).',
  };

  // ── Shapes ────────────────────────────────────────────────────────────────
  // Asymmetric pulse: fast rise, slower tail — a rain band as a gauge sees it.
  const pulse = (t, mu, sd) => { const z = (t - mu) / sd; return z < 0 ? Math.exp(-0.5 * z * z) : Math.exp(-0.5 * (z / 1.45) ** 2); };
  const lognorm = (r, s) => Math.exp(gauss(r) * s);
  // A flat-topped window with soft edges: the shape of a sustained event.
  const plateau = (t, t0, dur, edge = 1.5) => {
    if (t < t0 - edge * 2 || t > t0 + dur + edge * 2) return 0;
    const up = clamp((t - t0 + edge) / (2 * edge), 0, 1);
    const dn = clamp((t0 + dur + edge - t) / (2 * edge), 0, 1);
    return Math.min(up, dn);
  };
  // Hours since local midnight, for anything with a daily rhythm.
  const hod = (t) => ((t % 24) + 24) % 24;

  const R_EARTH = 6371008.8;
  function offsetKm(a, b) {
    const kx = (Math.PI / 180) * R_EARTH * Math.cos((a[1] * Math.PI) / 180) / 1000, ky = (Math.PI / 180) * R_EARTH / 1000;
    return [(b[0] - a[0]) * kx, (b[1] - a[1]) * ky];
  }
  // Spatial weights. `near` is a disc, `corridor` a line, `scatter` several discs.
  const near = (c, lngLat, km) => { const [x, y] = offsetKm(c, lngLat); return Math.exp(-(x * x + y * y) / (2 * km * km)); };
  function corridor(a, b, lngLat, km) {
    const [ax, ay] = offsetKm(a, b), [px, py] = offsetKm(a, lngLat);
    const L2 = ax * ax + ay * ay;
    const u = L2 ? clamp((px * ax + py * ay) / L2, 0, 1) : 0;
    const dx = px - u * ax, dy = py - u * ay;
    return Math.exp(-(dx * dx + dy * dy) / (2 * km * km));
  }
  const scatter = (pts, lngLat, km) => pts.reduce((m, c) => Math.max(m, near(c, lngLat, km)), 0);

  // The two cities' centres, used to place footprints relative to the built-up area.
  const CENTRE = { raleigh: [-78.6382, 35.7796], nagpur: [79.0882, 21.1458] };
  const ctr = (f) => (f.lngLat[0] < 0 ? CENTRE.raleigh : CENTRE.nagpur);

  // Every scenario here is weather-shaped at the top and may add `extra` below it.
  // order 1 keeps the whole set below the original catalogue in the scenario menu, so
  // adding twenty entries never changes which scenario a city opens on.
  const base = (o) => ({ provenance: MODELED, order: 1, heat: () => 0, wind: () => 0, rain: () => 0, ...o });

  const NATURAL = {};
  const def = (id, o) => { NATURAL[id] = base({ id, ...o }); };

  // ══ Raleigh · Piedmont North Carolina ════════════════════════════════════

  // 1. The slow mover. A landfalling system decays inland and stalls; the harm is
  //    duration, not intensity. Drainage saturates, then everything downstream of it.
  def('hurricane', {
    label: 'Hurricane remnant, stalled inland',
    blurb: 'A landfalling tropical system decays over the Piedmont and slows to walking pace. Three rain bands in thirty hours on ground that never drains between them.',
    cities: ['raleigh'], liveNow: 26, heading: 25,
    hazardLabel: { drainage: 'Sustained rainfall', traffic: 'Standing water', ems: 'Storm call volume' },
    sample(r, truth) {
      if (truth) return { t1: 18, a1: 21, s1: 3.2, t2: 31, a2: 26, s2: 3.6, t3: 44, a3: 18, s3: 3.0, v: 9, bg: 2.2, gx: 0.2, gy: 0.3 };
      return {
        t1: 18 + gauss(r) * 3, a1: 19 * lognorm(r, 0.3), s1: 2.8 + r() * 1.0,
        t2: 31 + gauss(r) * 4, a2: 23 * lognorm(r, 0.35), s2: 3.0 + r() * 1.2,
        t3: 44 + gauss(r) * 5, a3: 15 * lognorm(r, 0.4), s3: 2.6 + r() * 1.0,
        v: 6 + r() * 7, bg: 1.5 + r() * 1.4, gx: gauss(r) * 0.22, gy: gauss(r) * 0.22,
      };
    },
    rain(p, s, c, t) {
      const lag = s / p.v;
      const spatial = clamp(1 + p.gx * c / 8 + p.gy * s / 8, 0.6, 1.6);
      const v = p.a1 * pulse(t - lag, p.t1, p.s1) + p.a2 * pulse(t - lag, p.t2, p.s2) + p.a3 * pulse(t - lag, p.t3, p.s3);
      return (v + p.bg * plateau(t, p.t1 - 4, p.t3 - p.t1 + 10, 4)) * spatial;
    },
    wind(p, s, c, t) { return clamp(0.55 * plateau(t, p.t1 - 2, p.t3 - p.t1 + 8, 3), 0, 1); },
  });

  // 2. No flood at all. Freezing rain loads conductors until they come down; the city
  //    goes dark with dry streets, which is a cascade the drainage model never sees.
  def('icestorm', {
    label: 'Freezing rain and ice accretion',
    blurb: 'A shallow cold wedge holds below freezing while warm air rides over it. Ice loads lines and trees for a day and a half; the grid, not the drains, is what fails.',
    cities: ['raleigh'], liveNow: 29, heading: 300,
    hazardLabel: { power: 'Ice loading on conductors', telecom: 'Site power loss', traffic: 'Black ice', ems: 'Fall and collision calls' },
    sample(r, truth) {
      if (truth) return { t0: 20, dur: 30, acc: 0.86, thaw: 54, rr: 2.4, sev: 0.9 };
      return { t0: 20 + gauss(r) * 3, dur: 22 + r() * 14, acc: 0.55 + r() * 0.4, thaw: 52 + gauss(r) * 6, rr: 1.6 + r() * 1.6, sev: 0.6 + r() * 0.45 };
    },
    // Light precipitation only: it freezes on contact rather than running off.
    rain(p, s, c, t) { return p.rr * plateau(t, p.t0, p.dur, 2) * 0.55; },
    heat: () => 0,
    wind(p, s, c, t) { return clamp(0.3 * plateau(t, p.t0 + 6, p.dur * 0.6, 3), 0, 1); },
    // Accreted ice integrates over the event and only sheds after the thaw.
    extra(p, f, kind, st, t) {
      const load = clamp((t - p.t0) / Math.max(1, p.dur), 0, 1) * p.acc * (t > p.thaw ? Math.max(0, 1 - (t - p.thaw) / 8) : 1);
      if (load <= 0) return 0;
      if (kind === 'power') return 0.74 * load * p.sev;
      if (kind === 'telecom') return 0.92 * load * p.sev;   // masts and their batteries go first
      if (kind === 'traffic') return 0.45 * load;
      if (kind === 'ems') return 0.3 * load;
      if (kind === 'hospital') return 0.16 * load;
      return 0;
    },
  });

  // 3. Forty minutes. A derecho crosses at 90 km/h: by the time it is confirmed it is
  //    already past, so the whole decision is pre-emptive or not at all.
  def('derecho', {
    label: 'Derecho — straight-line wind',
    blurb: 'A bow echo crosses the city in under an hour at 90 km/h. Almost no rain accumulates; the damage is wind on poles, trees and rooftop telecom.',
    cities: ['raleigh'], liveNow: 32, heading: 265,
    hazardLabel: { power: 'Wind damage to distribution', telecom: 'Mast and backhaul damage', traffic: 'Debris and signals out', ems: 'Trapped-person calls' },
    sample(r, truth) {
      if (truth) return { tp: 34.2, w: 0.94, s1: 0.45, v: 90, rr: 15, rec: 14 };
      return { tp: 34 + gauss(r) * 1.6, w: 0.62 + r() * 0.38, s1: 0.3 + r() * 0.35, v: 70 + r() * 35, rr: 8 + r() * 14, rec: 9 + r() * 12 };
    },
    rain(p, s, c, t) { return p.rr * pulse(t - s / p.v, p.tp, p.s1); },
    wind(p, s, c, t) { return clamp(p.w * pulse(t - s / p.v, p.tp, p.s1), 0, 1); },
    // The gust passes in minutes; what follows is a long restoration tail.
    extra(p, f, kind, st, t) {
      const hit = pulse(t - st.s / p.v, p.tp, p.s1);
      const after = t > p.tp ? Math.max(0, 1 - (t - p.tp) / p.rec) : 0;
      const dmg = Math.max(hit, after * 0.75) * p.w;
      if (kind === 'power') return 0.72 * dmg;
      if (kind === 'telecom') return 0.6 * dmg;
      if (kind === 'traffic') return 0.5 * hit + 0.3 * after;
      if (kind === 'ems') return 0.45 * dmg;
      return 0;
    },
  });

  // 4. A line, not a disc. Everything on the track is destroyed and everything 2 km
  //    away is untouched, which is the hardest footprint for a city-wide index to see.
  def('tornado', {
    label: 'Tornado outbreak, one long track',
    blurb: 'A supercell drops a long-track tornado across the southwest of the city. Total loss in a corridor a few hundred metres wide, nothing either side of it.',
    cities: ['raleigh'], liveNow: 28, heading: 230,
    track: [[-78.72, 35.72], [-78.56, 35.84]],
    hazardLabel: { power: 'Structural destruction', telecom: 'Structural destruction', traffic: 'Impassable corridor', ems: 'Search and rescue', hospital: 'Trauma surge' },
    sample(r, truth) {
      if (truth) return { tp: 30.5, w: 0.98, wid: 0.9, rr: 32, s1: 0.6, rec: 26 };
      return { tp: 30.5 + gauss(r) * 2.2, w: 0.7 + r() * 0.3, wid: 0.6 + r() * 0.8, rr: 20 + r() * 22, s1: 0.4 + r() * 0.5, rec: 18 + r() * 16 };
    },
    rain(p, s, c, t) { return p.rr * pulse(t, p.tp - 0.5, p.s1); },
    wind(p, s, c, t) { return clamp(0.8 * pulse(t, p.tp, p.s1 * 0.7), 0, 1); },
    extra(p, f, kind, st, t) {
      if (t < p.tp - 1) return 0;
      const [a, b] = NATURAL.tornado.track;
      const w = corridor(a, b, f.lngLat, p.wid);
      if (w < 0.03) return 0;
      const sev = (t < p.tp + 1 ? 1 : Math.max(0.35, 1 - (t - p.tp) / p.rec)) * p.w * w;
      if (kind === 'hospital') return 0.5 * sev;         // trauma arrives at hospitals off the track
      if (kind === 'ems') return 0.85 * sev;
      if (kind === 'power' || kind === 'telecom') return 0.9 * sev;
      if (kind === 'traffic') return 0.8 * sev;
      return 0.3 * sev;
    },
  });

  // 5. The one you can see coming. Upstream release and snowmelt arrive as a wave on a
  //    schedule; the test is whether anyone acts during the lead time they are given.
  def('riverflood', {
    label: 'Upstream release and spring melt',
    blurb: 'Reservoir releases upstream meet a melting snowpack. Local rainfall is unremarkable; the river crests thirty hours after the release and the flood is entirely in the floodplain.',
    cities: ['raleigh'], liveNow: 22, heading: 40,
    hazardLabel: { drainage: 'River stage from upstream', traffic: 'Floodplain road closures' },
    sample(r, truth) {
      if (truth) return { rel: 14, lag: 30, crest: 0.95, wide: 9, rr: 3.0, t1: 20 };
      return { rel: 14 + gauss(r) * 2, lag: 26 + r() * 10, crest: 0.6 + r() * 0.4, wide: 6 + r() * 6, rr: 1.8 + r() * 2.2, t1: 20 + gauss(r) * 4 };
    },
    rain(p, s, c, t) { return p.rr * pulse(t, p.t1, 3.0); },
    // The wave itself: a broad crest arriving long after the cause, on low ground only.
    extra(p, f, kind, st, t) {
      const stage = p.crest * Math.exp(-0.5 * ((t - p.rel - p.lag) / p.wide) ** 2);
      if (stage < 0.02) return 0;
      const low = kind === 'drainage' || kind === 'pump' ? 1 : kind === 'traffic' ? 0.55 : kind === 'ems' ? 0.2 : 0.08;
      return stage * low;
    },
  });

  // 6. No water anywhere. Four days of extreme heat and humidity: the load is on
  //    hospitals, ambulances and the grid, and drainage never moves at all.
  def('heatdome', {
    label: 'Extended heat dome and humidity',
    blurb: 'A stationary upper ridge holds for four days with overnight lows that never recover. Cooling demand climbs each day; heat illness and the grid peak together in the late afternoon.',
    cities: ['raleigh'], liveNow: 34, heading: 180,
    hazardLabel: { power: 'Cooling demand and derating', hospital: 'Heat illness admissions', ems: 'Heat call volume', telecom: 'Cabinet temperature' },
    sample(r, truth) {
      if (truth) return { peak: 0.95, ramp: 0.17, hum: 0.85, night: 0.52 };
      return { peak: 0.7 + r() * 0.3, ramp: 0.09 + r() * 0.12, hum: 0.55 + r() * 0.4, night: 0.3 + r() * 0.3 };
    },
    rain: () => 0,
    heat(p, t) {
      const diurnal = p.night + (1 - p.night) * bump(hod(t), 16.0, 3.9);
      return clamp((p.peak - 0.15 + p.ramp * (t / 24)) * diurnal * (0.8 + 0.2 * p.hum), 0, 1);
    },
    wind: () => 0.05,
    extra(p, f, kind, st, t) {
      const h = clamp((p.peak - 0.15 + p.ramp * (t / 24)) * (p.night + (1 - p.night) * bump(hod(t), 16.0, 3.9)), 0, 1);
      if (kind === 'hospital') return 0.42 * Math.pow(h, 1.8);   // admissions rise faster than the index
      if (kind === 'ems') return 0.38 * Math.pow(h, 1.7);
      if (kind === 'power') return 0.3 * Math.pow(h, 2.0);
      return 0;
    },
  });

  // 7. Ten minutes of damage and two days of consequence. Hail destroys exposed plant —
  //    rooftop telecom, transformer radiators, solar — and leaves the roads fine.
  def('hail', {
    label: 'Severe hailstorm',
    blurb: 'A single supercell drops golf-ball hail along a narrow swath. Rooftop telecom, transformer cooling and vehicles take the damage; the drains barely notice.',
    cities: ['raleigh'], liveNow: 27, heading: 250,
    hazardLabel: { telecom: 'Hail damage to rooftop plant', power: 'Transformer cooling damage', traffic: 'Vehicle damage and debris' },
    sample(r, truth) {
      if (truth) return { tp: 29.0, sz: 1.0, s1: 0.55, v: 38, cx: 0.5, wid: 7.5, rr: 48, rec: 30 };
      return { tp: 29 + gauss(r) * 1.8, sz: 0.7 + r() * 0.35, s1: 0.4 + r() * 0.35, v: 26 + r() * 22, cx: gauss(r) * 2.5, wid: 5.5 + r() * 4, rr: 32 + r() * 24, rec: 22 + r() * 16 };
    },
    rain(p, s, c, t) {
      const focus = Math.exp(-0.5 * ((c - p.cx) / p.wid) ** 2);
      return p.rr * pulse(t - s / p.v, p.tp, p.s1) * focus;
    },
    wind(p, s, c, t) { return clamp(0.5 * pulse(t - s / p.v, p.tp, p.s1), 0, 1); },
    extra(p, f, kind, st, t) {
      const focus = Math.exp(-0.5 * ((st.c - p.cx) / p.wid) ** 2);
      if (focus < 0.05) return 0;
      const hit = pulse(t - st.s / p.v, p.tp, p.s1);
      const after = t > p.tp ? Math.max(0, 1 - (t - p.tp) / p.rec) : 0;
      const dmg = Math.max(hit, after * 0.8) * p.sz * focus;
      if (kind === 'telecom') return 0.95 * dmg;
      if (kind === 'power') return 0.8 * dmg;
      if (kind === 'traffic') return 0.6 * dmg;
      if (kind === 'ems') return 0.35 * dmg;
      return 0;
    },
  });

  // 8. A hazard with no physical damage at all. Smoke from distant fires loads only the
  //    hospitals, which makes it the cleanest test that the model is not just a flood map.
  def('wildfiresmoke', {
    label: 'Wildfire smoke intrusion',
    blurb: 'Smoke from fires hundreds of kilometres away settles over the city under a subsidence inversion for two days. Nothing is damaged; respiratory admissions climb and visibility closes roads.',
    cities: ['raleigh'], liveNow: 30, heading: 200,
    hazardLabel: { hospital: 'Respiratory admissions', ems: 'Breathing-difficulty calls', traffic: 'Visibility' },
    sample(r, truth) {
      if (truth) return { t0: 18, dur: 34, pm: 0.92, inv: 0.8, clear: 3 };
      return { t0: 18 + gauss(r) * 4, dur: 24 + r() * 18, pm: 0.55 + r() * 0.4, inv: 0.5 + r() * 0.45, clear: 2 + r() * 4 };
    },
    rain: () => 0,
    heat(p, t) { return clamp(0.2 * plateau(t, p.t0, p.dur, 3), 0, 1); },
    extra(p, f, kind, st, t) {
      // Concentration follows the inversion: worst overnight and at dawn, thinner by afternoon.
      const night = 0.55 + 0.45 * (1 - bump(hod(t), 15, 5));
      const conc = p.pm * plateau(t, p.t0, p.dur, p.clear) * (0.6 + 0.4 * p.inv) * night;
      if (conc < 0.02) return 0;
      if (kind === 'hospital') return 0.6 * conc;
      if (kind === 'ems') return 0.45 * conc;
      if (kind === 'traffic') return 0.25 * conc;
      return 0;
    },
  });

  // 9. Cold, not heat. Demand peaks at dawn instead of dusk, the roads fail before the
  //    grid, and ambulances are the binding constraint rather than hospital beds.
  def('wintersnow', {
    label: 'Snowstorm and hard freeze',
    blurb: 'Eight inches of snow, then three nights below freezing. Heating demand peaks before dawn, untreated roads strand ambulances, and water mains begin to break on the third day.',
    cities: ['raleigh'], liveNow: 31, heading: 290,
    hazardLabel: { traffic: 'Snow and ice on roads', power: 'Heating demand', ems: 'Access and collision calls', drainage: 'Main breaks' },
    sample(r, truth) {
      if (truth) return { t0: 22, fall: 10, cold: 44, dep: 0.9, dem: 0.82, mains: 0.55, rr: 2.8 };
      return { t0: 22 + gauss(r) * 3, fall: 7 + r() * 7, cold: 34 + r() * 16, dep: 0.55 + r() * 0.4, dem: 0.5 + r() * 0.4, mains: 0.25 + r() * 0.45, rr: 1.8 + r() * 1.8 };
    },
    rain(p, s, c, t) { return p.rr * plateau(t, p.t0, p.fall, 1.5) * 0.4; },
    wind(p, s, c, t) { return clamp(0.35 * plateau(t, p.t0, p.fall, 2), 0, 1); },
    extra(p, f, kind, st, t) {
      const lying = clamp((t - p.t0) / Math.max(1, p.fall), 0, 1) * (t < p.t0 + p.fall + p.cold ? 1 : 0.3) * p.dep;
      const freeze = plateau(t, p.t0 + p.fall, p.cold, 3);
      const dawn = 0.45 + 0.55 * bump(hod(t), 6.5, 2.6);   // heating demand peaks before dawn
      if (kind === 'traffic') return 0.68 * lying;
      if (kind === 'ems') return 0.52 * lying;
      if (kind === 'power') return 0.6 * p.dem * freeze * dawn;
      if (kind === 'drainage' || kind === 'pump') return 0.4 * p.mains * clamp((t - p.t0 - p.fall - 18) / 20, 0, 1);
      if (kind === 'hospital') return 0.2 * lying;
      return 0;
    },
  });

  // 10. The slowest one in the set. Nothing crosses in a hurry; the interest is whether
  //     the forecast can hold a trend over three days without a single sharp event.
  def('flashdrought', {
    label: 'Flash drought and water scarcity',
    blurb: 'Six weeks without meaningful rain, then a hot, dry, windy spell that empties the soil in days. Raw-water intakes drop, treatment throughput falls, and the grid loses its hydro margin.',
    cities: ['raleigh'], liveNow: 36, heading: 170,
    hazardLabel: { drainage: 'Raw-water intake level', power: 'Lost hydro margin', hospital: 'Heat and air quality' },
    sample(r, truth) {
      if (truth) return { sev: 0.88, ramp: 0.019, heat0: 0.6, wind0: 0.45, snap: 58 };
      return { sev: 0.55 + r() * 0.4, ramp: 0.01 + r() * 0.018, heat0: 0.35 + r() * 0.35, wind0: 0.25 + r() * 0.35, snap: 50 + r() * 18 };
    },
    rain: () => 0,
    heat(p, t) { return clamp((p.heat0 + p.ramp * t) * (0.4 + 0.6 * bump(hod(t), 15.5, 4.2)), 0, 1); },
    wind(p, s, c, t) { return clamp(p.wind0 * (0.5 + 0.5 * bump(hod(t), 14, 5)), 0, 1); },
    extra(p, f, kind, st, t) {
      const dry = clamp(p.sev * (0.35 + t / 110), 0, 1);
      if (kind === 'drainage' || kind === 'pump') return 0.55 * dry;   // low water is still a drainage-system failure
      if (kind === 'power') return 0.35 * dry * (t > p.snap ? 1.25 : 1);
      if (kind === 'hospital') return 0.22 * dry;
      return 0;
    },
  });

  // ══ Nagpur · Vidarbha, inland central India ══════════════════════════════

  // 11. The region's ordinary disaster. A Bay of Bengal depression tracks inland and
  //     rains on the whole city for three days — wide, not sharp.
  def('depression', {
    label: 'Monsoon depression tracking inland',
    blurb: 'A depression crosses the coast and tracks west-northwest over Vidarbha. No cloudburst, but three days of 15–25 mm/h over the whole catchment, which is how the Nag and the Pili fill from behind.',
    cities: ['nagpur'], liveNow: 30, heading: 290,
    hazardLabel: { drainage: 'Catchment-wide rainfall', traffic: 'Waterlogging', ems: 'Access delays' },
    sample(r, truth) {
      if (truth) return { t1: 16, a1: 17, s1: 4.0, t2: 34, a2: 22, s2: 4.4, t3: 52, a3: 14, s3: 3.6, v: 14, bg: 2.6, gx: 0.15, gy: 0.2 };
      return {
        t1: 16 + gauss(r) * 3.5, a1: 15 * lognorm(r, 0.3), s1: 3.4 + r() * 1.2,
        t2: 34 + gauss(r) * 4.5, a2: 19 * lognorm(r, 0.34), s2: 3.6 + r() * 1.4,
        t3: 52 + gauss(r) * 5, a3: 12 * lognorm(r, 0.4), s3: 3.0 + r() * 1.2,
        v: 10 + r() * 9, bg: 1.8 + r() * 1.6, gx: gauss(r) * 0.2, gy: gauss(r) * 0.2,
      };
    },
    rain(p, s, c, t) {
      const lag = s / p.v;
      const spatial = clamp(1 + p.gx * c / 9 + p.gy * s / 9, 0.7, 1.45);
      const v = p.a1 * pulse(t - lag, p.t1, p.s1) + p.a2 * pulse(t - lag, p.t2, p.s2) + p.a3 * pulse(t - lag, p.t3, p.s3);
      return (v + p.bg * plateau(t, p.t1 - 5, p.t3 - p.t1 + 12, 5)) * spatial;
    },
    wind(p, s, c, t) { return clamp(0.35 * plateau(t, p.t1, p.t3 - p.t1 + 6, 4), 0, 1); },
  });

  // 12. Nagpur in May. 47 °C is not unusual here, and the binding constraint is the
  //     grid and the wards, not a drop of water anywhere.
  def('heatwave47', {
    label: 'Pre-monsoon heat wave, 47 °C',
    blurb: 'Five days of severe heat before the monsoon arrives, with night temperatures above 30 °C. Cooling demand derates the transformers that serve the hospitals taking heatstroke cases.',
    cities: ['nagpur'], liveNow: 38, heading: 250,
    hazardLabel: { power: 'Cooling demand and derating', hospital: 'Heatstroke admissions', ems: 'Collapse calls', telecom: 'Cabinet temperature' },
    sample(r, truth) {
      if (truth) return { peak: 0.72, ramp: 0.28, night: 0.5, dust: 0.3, brk: 0 };
      return { peak: 0.5 + r() * 0.26, ramp: 0.16 + r() * 0.16, night: 0.32 + r() * 0.26, dust: r() * 0.4, brk: r() < 0.25 ? 1 : 0 };
    },
    rain(p, s, c, t) { return p.brk ? 11 * pulse(t, 60, 1.4) : 0; },   // an occasional pre-monsoon thundershower
    heat(p, t) {
      const diurnal = p.night + (1 - p.night) * bump(hod(t), 15.5, 3.4);
      const relief = p.brk && t > 60 ? 0.7 : 1;
      return clamp((p.peak - 0.12 + p.ramp * (t / 24)) * diurnal * relief, 0, 1);
    },
    wind(p, s, c, t) { return clamp(p.dust * bump(hod(t), 16, 4), 0, 1); },
    extra(p, f, kind, st, t) {
      const h = clamp((p.peak - 0.12 + p.ramp * (t / 24)) * (p.night + (1 - p.night) * bump(hod(t), 15.5, 3.4)), 0, 1);
      if (kind === 'hospital') return 0.5 * Math.pow(h, 1.9);
      if (kind === 'ems') return 0.44 * Math.pow(h, 1.8);
      if (kind === 'power') return 0.38 * Math.pow(h, 2.1);
      if (kind === 'telecom') return 0.22 * Math.pow(h, 2.0);
      return 0;
    },
  });

  // 13. Out of season and therefore unwatched. February hail in Vidarbha arrives when
  //     nobody is running a flood desk, which is the point of including it.
  def('hailvidarbha', {
    label: 'Unseasonal hailstorm, February',
    blurb: 'A western disturbance interacts with returning moisture and drops hail across the district in late February. The flood desk is stood down for the season; the damage is to exposed plant and to the ambulances that cannot move through it.',
    cities: ['nagpur'], liveNow: 26, heading: 285,
    hazardLabel: { telecom: 'Hail damage to rooftop plant', power: 'Insulator and radiator damage', traffic: 'Debris and hail cover', ems: 'Injury calls' },
    sample(r, truth) {
      if (truth) return { tp: 28.5, sz: 1.0, s1: 0.6, v: 32, cx: -0.8, wid: 8.0, rr: 40, rec: 32, t2: 46, a2: 16 };
      return { tp: 28.5 + gauss(r) * 2, sz: 0.7 + r() * 0.35, s1: 0.45 + r() * 0.4, v: 22 + r() * 20, cx: gauss(r) * 3, wid: 6 + r() * 4, rr: 26 + r() * 20, rec: 24 + r() * 16, t2: 46 + gauss(r) * 5, a2: 8 + r() * 12 };
    },
    rain(p, s, c, t) {
      const focus = Math.exp(-0.5 * ((c - p.cx) / p.wid) ** 2);
      return p.rr * pulse(t - s / p.v, p.tp, p.s1) * focus + p.a2 * pulse(t, p.t2, 1.2) * 0.5;
    },
    wind(p, s, c, t) { return clamp(0.55 * pulse(t - s / p.v, p.tp, p.s1), 0, 1); },
    extra(p, f, kind, st, t) {
      const focus = Math.exp(-0.5 * ((st.c - p.cx) / p.wid) ** 2);
      if (focus < 0.05) return 0;
      const hit = pulse(t - st.s / p.v, p.tp, p.s1);
      const after = t > p.tp ? Math.max(0, 1 - (t - p.tp) / p.rec) : 0;
      const dmg = Math.max(hit, after * 0.8) * p.sz * focus;
      if (kind === 'telecom') return 0.9 * dmg;
      if (kind === 'power') return 0.85 * dmg;
      if (kind === 'traffic') return 0.55 * dmg;
      if (kind === 'ems') return 0.42 * dmg;
      return 0;
    },
  });

  // 14. Scattered, not spread. Vidarbha has among the highest lightning fatality rates
  //     in India; the footprint is a dozen points, which no city-wide average resolves.
  def('lightning', {
    label: 'Lightning outbreak over the district',
    blurb: 'A pre-monsoon squall line brings thousands of cloud-to-ground strikes in four hours. Distribution feeders trip one by one, substation protection operates, and the casualties are scattered across the district rather than concentrated anywhere.',
    cities: ['nagpur'], liveNow: 24, heading: 300,
    strikes: [[79.0426, 21.1297], [79.1180, 21.1690], [79.0620, 21.0990], [79.1420, 21.1210], [79.0310, 21.1810], [79.0980, 21.2050]],
    hazardLabel: { power: 'Feeder trips from strikes', telecom: 'Site surge damage', ems: 'Casualty calls, scattered' },
    sample(r, truth) {
      if (truth) return { t0: 20, dur: 4.2, rate: 0.92, rr: 26, rec: 10, sp: 1.6 };
      return { t0: 20 + gauss(r) * 2.5, dur: 2.5 + r() * 3.5, rate: 0.55 + r() * 0.42, rr: 15 + r() * 18, rec: 6 + r() * 9, sp: 1.1 + r() * 1.2 };
    },
    rain(p, s, c, t) { return p.rr * pulse(t, p.t0 + p.dur * 0.5, p.dur * 0.45); },
    wind(p, s, c, t) { return clamp(0.42 * pulse(t, p.t0 + p.dur * 0.4, p.dur * 0.4), 0, 1); },
    extra(p, f, kind, st, t) {
      const on = plateau(t, p.t0, p.dur, 0.6);
      const after = t > p.t0 + p.dur ? Math.max(0, 1 - (t - p.t0 - p.dur) / p.rec) : 0;
      const w = scatter(NATURAL.lightning.strikes, f.lngLat, p.sp);
      const sev = Math.max(on, after * 0.7) * p.rate * w;
      if (sev < 0.01) return 0;
      if (kind === 'power') return 0.8 * sev;
      if (kind === 'telecom') return 0.5 * sev;
      if (kind === 'ems') return 0.45 * on * p.rate * w;
      if (kind === 'hospital') return 0.2 * sev;
      return 0;
    },
  });

  // 15. Air, not water. A dust storm closes visibility, flashes over insulators and
  //     fills the respiratory wards, with the drains completely dry.
  def('duststorm', {
    label: 'Dust storm and insulator flashover',
    blurb: 'A pre-monsoon andhi carries dust across the city for several hours. Visibility closes the roads, dust on insulators flashes over feeders at the first light rain, and respiratory admissions climb for two days after.',
    cities: ['nagpur'], liveNow: 27, heading: 280,
    hazardLabel: { traffic: 'Visibility', power: 'Insulator flashover', telecom: 'Site intake fouling', hospital: 'Respiratory admissions' },
    sample(r, truth) {
      if (truth) return { t0: 23, dur: 6, dens: 0.9, wet: 31, rr: 5.0, tail: 30 };
      return { t0: 23 + gauss(r) * 3, dur: 3.5 + r() * 5, dens: 0.55 + r() * 0.42, wet: 30 + gauss(r) * 4, rr: 2.5 + r() * 5, tail: 20 + r() * 18 };
    },
    rain(p, s, c, t) { return p.rr * pulse(t, p.wet, 1.1); },
    heat(p, t) { return clamp(0.35 * plateau(t, p.t0 - 4, p.dur + 8, 3) * bump(hod(t), 15, 4.5), 0, 1); },
    wind(p, s, c, t) { return clamp(p.dens * plateau(t, p.t0, p.dur, 1.2), 0, 1); },
    extra(p, f, kind, st, t) {
      const blow = plateau(t, p.t0, p.dur, 1.2) * p.dens;
      // Dust deposited during the blow flashes over when the first light rain wets it.
      const flash = clamp((t - p.wet + 1) / 2, 0, 1) * Math.max(0, 1 - (t - p.wet) / 9) * p.dens;
      const resp = p.dens * clamp((t - p.t0) / 3, 0, 1) * Math.max(0, 1 - (t - p.t0 - p.dur) / p.tail);
      if (kind === 'traffic') return 0.6 * blow;
      if (kind === 'power') return 0.7 * flash + 0.1 * blow;
      if (kind === 'telecom') return 0.3 * blow;
      if (kind === 'hospital') return 0.45 * resp;
      if (kind === 'ems') return 0.3 * resp + 0.2 * blow;
      return 0;
    },
  });

  // 16. The Delhi 2023 shape, in Vidarbha. The decision that floods the city is taken
  //     upstream, by a different authority, hours before anything is visible here.
  def('damrelease', {
    label: 'Upstream reservoir release, Pench and Kanhan',
    blurb: 'Heavy rain over the Pench catchment forces releases from Totladoh. The gates open seventy kilometres upstream and a different authority decides when; the wave reaches the Kanhan intakes and the northern wards many hours later.',
    cities: ['nagpur'], liveNow: 25, heading: 300,
    reach: [[79.1050, 21.2600], [79.1750, 21.1550]],
    hazardLabel: { drainage: 'River stage from upstream release', traffic: 'Riverside road closures', pump: 'Intake submergence' },
    sample(r, truth) {
      if (truth) return { gate: 16, lag: 22, crest: 1.25, wide: 9.0, rr: 13, t1: 12, band: 4.5 };
      return { gate: 16 + gauss(r) * 3, lag: 17 + r() * 11, crest: 0.85 + r() * 0.45, wide: 6.5 + r() * 5, rr: 8 + r() * 8, t1: 12 + gauss(r) * 3, band: 3.2 + r() * 2.2 };
    },
    rain(p, s, c, t) { return p.rr * pulse(t, p.t1, 3.2) * 0.8; },   // local rain is the smaller half of the story
    extra(p, f, kind, st, t) {
      const stage = p.crest * Math.exp(-0.5 * ((t - p.gate - p.lag) / p.wide) ** 2);
      if (stage < 0.02) return 0;
      const [a, b] = NATURAL.damrelease.reach;
      const w = corridor(a, b, f.lngLat, p.band);
      if (kind === 'drainage' || kind === 'pump') return stage * (0.55 + 0.45 * w);
      if (kind === 'traffic') return stage * 0.7 * (0.3 + 0.7 * w);
      if (kind === 'ems') return stage * 0.45 * (0.25 + 0.75 * w);
      if (kind === 'power') return stage * 0.3 * w;
      return stage * 0.12 * w;
    },
  });

  // 17. The 2023 geometry without the 2023 dates: a cloudburst centred on the Ambazari
  //     catchment, as a scenario rather than a reconstruction of a real night.
  def('ambazari', {
    label: 'Cloudburst over the Ambazari catchment',
    blurb: 'A stalled cell sits over the Ambazari catchment for three hours. The lake crosses its overflow into the Nag, and the channel through the city is the constraint — not the rainfall total.',
    cities: ['nagpur'], liveNow: 33, heading: 70,
    centre: [79.0426, 21.1297], channel: [[79.0426, 21.1297], [79.1250, 21.1560]],
    hazardLabel: { drainage: 'Lake overflow into the Nag', traffic: 'Channel-side flooding', ems: 'Access across the Nag' },
    sample(r, truth) {
      if (truth) return { tp: 35.5, a1: 44, s1: 1.25, sp: 3.4, spill: 2.6, rec: 16, bg: 1.1 };
      return { tp: 35.5 + gauss(r) * 2.8, a1: 30 * lognorm(r, 0.36), s1: 0.95 + r() * 0.7, sp: 2.4 + r() * 2.0, spill: 1.6 + r() * 2.0, rec: 11 + r() * 10, bg: 0.5 + r() * 1.1 };
    },
    rain(p, s, c, t) {
      // Centred on the catchment, which in this city's frame sits up-track and west.
      const focus = Math.exp(-0.5 * ((c + 2.4) / p.sp) ** 2);
      return (p.a1 * pulse(t, p.tp, p.s1) * (0.3 + 0.9 * focus)) + p.bg * bump(t, p.tp - 8, 7);
    },
    wind(p, s, c, t) { return clamp(0.35 * pulse(t, p.tp, p.s1), 0, 1); },
    // The spill is a wave down the Nag, lagged behind the rain and shaped by the channel.
    extra(p, f, kind, st, t) {
      const lake = Math.exp(-0.5 * ((t - p.tp - p.spill) / 2.6) ** 2);
      const wave = lake * Math.max(0, 1 - Math.max(0, t - p.tp - p.spill - 3) / p.rec);
      if (wave < 0.02) return 0;
      const [a, b] = NATURAL.ambazari.channel;
      const w = corridor(a, b, f.lngLat, 1.5);
      if (kind === 'drainage' || kind === 'pump') return 0.85 * wave * (0.3 + 0.7 * w);
      if (kind === 'traffic') return 0.6 * wave * w;
      if (kind === 'ems') return 0.4 * wave * w;
      if (kind === 'power') return 0.3 * wave * w;
      return 0;
    },
  });

  // 18. The opposite end of the thermometer from 12, and a different dashboard: demand
  //     peaks before dawn, nothing floods, and the load lands on wards, not on roads.
  def('coldwave', {
    label: 'Cold wave reaching Vidarbha',
    blurb: 'A north Indian cold wave pushes south and holds night temperatures near 5 °C for four nights. Heating load peaks before dawn when solar is absent, and the admissions are hypothermia and cardiac rather than trauma.',
    cities: ['nagpur'], liveNow: 35, heading: 20,
    hazardLabel: { power: 'Pre-dawn heating demand', hospital: 'Hypothermia and cardiac admissions', ems: 'Exposure calls' },
    sample(r, truth) {
      if (truth) return { sev: 0.9, nights: 4, t0: 14, fog: 0.75 };
      return { sev: 0.55 + r() * 0.4, nights: 2 + Math.floor(r() * 3), t0: 14 + gauss(r) * 4, fog: 0.4 + r() * 0.5 };
    },
    rain: () => 0,
    heat: () => 0,
    wind(p, s, c, t) { return clamp(0.2 * plateau(t, p.t0, p.nights * 24, 4), 0, 1); },
    extra(p, f, kind, st, t) {
      const on = plateau(t, p.t0, p.nights * 24, 5) * p.sev;
      if (on < 0.02) return 0;
      const predawn = bump(hod(t), 5.5, 2.4);
      const fogAM = p.fog * bump(hod(t), 7.5, 2.0);
      if (kind === 'power') return 0.62 * on * (0.35 + 0.65 * predawn);
      if (kind === 'hospital') return 0.5 * on * (0.45 + 0.55 * predawn);
      if (kind === 'ems') return 0.4 * on * (0.4 + 0.6 * predawn);
      if (kind === 'traffic') return 0.35 * on * fogAM;      // dense radiation fog, not ice
      return 0;
    },
  });

  // 19. No single event at all. The channel has been narrowed for years; an ordinary
  //     monsoon week is enough, and the forecast has to hold a slow trend.
  def('nagflood', {
    label: 'Nag river flood from an encroached channel',
    blurb: 'An ordinary monsoon week on a channel that has lost most of its section to encroachment and silt. No cloudburst anywhere in the record — the capacity went away instead, and the river simply stops fitting.',
    cities: ['nagpur'], liveNow: 40, heading: 75,
    channel: [[79.0426, 21.1297], [79.1420, 21.1600]],
    hazardLabel: { drainage: 'Channel capacity exceeded', traffic: 'Riverside closures', ems: 'Crossings cut' },
    sample(r, truth) {
      if (truth) return { cap: 0.42, rr: 9.5, t1: 20, t2: 38, t3: 56, s: 3.2, band: 1.2 };
      return { cap: 0.3 + r() * 0.35, rr: 6 + r() * 6, t1: 20 + gauss(r) * 4, t2: 38 + gauss(r) * 5, t3: 56 + gauss(r) * 5, s: 2.4 + r() * 1.6, band: 0.8 + r() * 1.0 };
    },
    rain(p, s, c, t) {
      return p.rr * (pulse(t, p.t1, p.s) + 0.9 * pulse(t, p.t2, p.s) + 0.8 * pulse(t, p.t3, p.s)) + 1.4 * plateau(t, p.t1 - 6, 56, 6);
    },
    // Reduced section: each successive band leaves less room than the last.
    extra(p, f, kind, st, t) {
      const filled = clamp((0.25 + 0.75 * clamp((t - p.t1) / 42, 0, 1)) / Math.max(0.15, p.cap) - 1, 0, 1.3);
      if (filled < 0.02) return 0;
      const [a, b] = NATURAL.nagflood.channel;
      const w = corridor(a, b, f.lngLat, p.band);
      if (kind === 'drainage' || kind === 'pump') return 0.7 * Math.min(1, filled) * (0.35 + 0.65 * w);
      if (kind === 'traffic') return 0.55 * Math.min(1, filled) * w;
      if (kind === 'ems') return 0.38 * Math.min(1, filled) * w;
      return 0;
    },
  });

  // 20. Two hazards in one window, with the first one setting up the second. The break
  //     bakes the ground hard; the revival then runs off it instead of into it.
  def('monsoonbreak', {
    label: 'Monsoon break, then a violent revival',
    blurb: 'Ten dry days bake the catchment hard and the heat climbs; then the monsoon returns in one night onto ground that has lost its infiltration. Two different emergencies in one 72-hour window, and the first one makes the second worse.',
    cities: ['nagpur'], liveNow: 34, heading: 285,
    hazardLabel: { hospital: 'Heat, then access', drainage: 'Runoff on baked ground', power: 'Cooling demand, then wind' },
    sample(r, truth) {
      if (truth) return { hp: 0.86, brk: 42, a1: 41, s1: 1.5, crust: 0.8, a2: 17, t2: 58 };
      return { hp: 0.6 + r() * 0.33, brk: 42 + gauss(r) * 4.5, a1: 28 * lognorm(r, 0.36), s1: 1.1 + r() * 0.9, crust: 0.5 + r() * 0.45, a2: 10 + r() * 12, t2: 58 + gauss(r) * 5 };
    },
    rain(p, s, c, t) { return p.a1 * pulse(t, p.brk, p.s1) + p.a2 * pulse(t, p.t2, 1.8); },
    heat(p, t) {
      const before = t < p.brk ? 1 : Math.max(0, 1 - (t - p.brk) / 5);
      return clamp(p.hp * before * (0.3 + 0.7 * bump(hod(t), 15.5, 3.6)), 0, 1);
    },
    wind(p, s, c, t) { return clamp(0.5 * pulse(t, p.brk, p.s1 * 0.8), 0, 1); },
    extra(p, f, kind, st, t) {
      const heat = p.hp * (t < p.brk ? 1 : Math.max(0, 1 - (t - p.brk) / 5)) * (0.3 + 0.7 * bump(hod(t), 15.5, 3.6));
      // A hard crust sheds water: the same rain produces more runoff after the break.
      const runoff = p.crust * clamp((t - p.brk + 1) / 2, 0, 1) * Math.max(0, 1 - (t - p.brk) / 18);
      if (kind === 'hospital') return 0.4 * Math.pow(heat, 1.8) + 0.12 * runoff;
      if (kind === 'ems') return 0.34 * Math.pow(heat, 1.7) + 0.25 * runoff;
      if (kind === 'power') return 0.32 * Math.pow(heat, 2.0);
      if (kind === 'drainage' || kind === 'pump') return 0.6 * runoff;
      if (kind === 'traffic') return 0.4 * runoff;
      return 0;
    },
  });

  Object.assign(S, NATURAL);
  // The catalogue of what was added, for the dataset export and the tests.
  T.naturalScenarios = Object.keys(NATURAL);
})(typeof window !== 'undefined' ? window : globalThis);

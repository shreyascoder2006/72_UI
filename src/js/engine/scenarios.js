/* Exogenous hazard drivers for each scenario.

   A scenario samples parameters per ensemble member (and once for the hidden
   "truth" storm) and turns them into rain rate (mm/h), heat stress and wind
   damage at any site and time. Sites are described by their along-track
   distance s (km, in the storm's direction of motion) and cross-track offset c. */
(function (root) {
  const { bump, gauss, clamp } = root.TWIN.core;

  // Asymmetric pulse: fast rise, slower tail, the usual shape of a rain band at a gauge.
  function pulse(t, mu, sd) {
    const z = (t - mu) / sd;
    return z < 0 ? Math.exp(-0.5 * z * z) : Math.exp(-0.5 * (z / 1.45) ** 2);
  }
  const lognorm = (r, s) => Math.exp(gauss(r) * s);

  // Where a scenario's events come from. In every scenario the city's facilities and
  // street network are real and every sensor reading is simulated; a reconstruction also
  // takes the hazard's timing and totals from a real event.
  const MODELED = {
    kind: 'modeled', label: 'Modeled scenario',
    note: 'The hazard, sensor streams, citizen reports and outcomes are simulated. Facilities, streets and rivers are real (OpenStreetMap).',
  };
  const RECONSTRUCTION = {
    kind: 'reconstruction', label: 'Historical reconstruction',
    note: 'Rainfall timing and totals follow figures reported for the real event; the sensor streams, citizen reports and facility outcomes are simulated.',
  };

  const SCENARIOS = {
    tropical: {
      id: 'tropical',
      provenance: MODELED,
      label: 'Tropical remnant rainfall',
      blurb: 'Two rain bands from a decaying tropical system moving SW→NE; antecedent soils saturated.',
      heading: 40, // degrees, storm motion
      sample(r, truth) {
        if (truth) return { t1: 21.5, a1: 17.0, s1: 2.5, t2: 45.0, a2: 13.0, s2: 2.2, on2: 1, bg: 1.0, v: 28, gx: 0.30, gy: 0.18, cell: 0.22 };
        return {
          t1: 23 + gauss(r) * 3.6, a1: 16.5 * lognorm(r, 0.33), s1: 2.3 + r() * 1.0,
          t2: 45 + gauss(r) * 4.5, a2: 12 * lognorm(r, 0.45), s2: 1.8 + r() * 1.0, on2: r() < 0.78 ? 1 : 0,
          bg: 0.6 + r() * 0.9, v: 22 + r() * 14, gx: gauss(r) * 0.25, gy: gauss(r) * 0.25, cell: r() * 0.35,
        };
      },
      rain(p, s, c, t) {
        const lag = s / p.v;
        const spatial = clamp(1 + p.gx * c / 8 + p.gy * s / 8, 0.45, 1.8);
        let v = p.a1 * pulse(t - lag, p.t1, p.s1) + (p.on2 ? p.a2 * pulse(t - lag, p.t2, p.s2) : 0);
        v += p.bg * (bump(t, 30, 13) > 0.18 ? bump(t, 30, 13) : 0);
        return v * spatial;
      },
      heat: () => 0,
      wind(p, s, c, t) { return clamp(0.5 * pulse(t - s / p.v, p.t1 + 0.6, p.s1 * 0.8) * p.a1 / 20, 0, 1); },
    },

    flash: {
      id: 'flash',
      provenance: MODELED,
      label: 'Convective flash flood',
      blurb: 'Training thunderstorms stall over one part of the city for three hours.', // runs in both cities
      heading: 70,
      sample(r, truth) {
        if (truth) return { t1: 15.5, a1: 46, s1: 1.15, t2: 39, a2: 22, s2: 0.9, on2: 1, v: 12, gx: 0.55, gy: -0.1, cx: -3.5 };
        return {
          t1: 17 + gauss(r) * 3.5, a1: 34 * lognorm(r, 0.38), s1: 0.9 + r() * 0.6,
          t2: 40 + gauss(r) * 5, a2: 16 * lognorm(r, 0.5), s2: 0.7 + r() * 0.6, on2: r() < 0.6 ? 1 : 0,
          v: 8 + r() * 10, gx: gauss(r) * 0.35, gy: gauss(r) * 0.3, cx: gauss(r) * 3,
        };
      },
      rain(p, s, c, t) {
        const lag = s / p.v;
        // A stalled cell: intensity falls off with cross-track distance from its axis.
        const focus = Math.exp(-0.5 * ((c - p.cx) / 4.5) ** 2);
        const spatial = clamp((0.35 + 0.95 * focus) * (1 + p.gx * c / 8 + p.gy * s / 8), 0.15, 2.2);
        return (p.a1 * pulse(t - lag, p.t1, p.s1) + (p.on2 ? p.a2 * pulse(t - lag, p.t2, p.s2) : 0)) * spatial;
      },
      heat: () => 0,
      wind(p, s, c, t) { return clamp(0.65 * pulse(t - s / p.v, p.t1, p.s1) * p.a1 / 40, 0, 1); },
    },

    heat: {
      id: 'heat',
      provenance: MODELED,
      label: 'Heat wave and grid stress',
      blurb: 'Three-day heat dome; a derecho line crosses the city late on day two.',
      heading: 110,
      sample(r, truth) {
        if (truth) return { peak: 0.92, ramp: 0.12, td: 41.0, wa: 0.85, ws: 1.1, v: 55, a1: 26 };
        return { peak: 0.65 + r() * 0.35, ramp: 0.06 + r() * 0.1, td: 42 + gauss(r) * 5, wa: 0.4 + r() * 0.6, ws: 0.7 + r() * 0.8, v: 40 + r() * 30, a1: 14 + r() * 18 };
      },
      rain(p, s, c, t) { return p.a1 * pulse(t - s / p.v, p.td, p.ws * 0.6); },
      heat(p, t) {
        // Diurnal heat index with a day-over-day ramp; t is hours from local midnight.
        const h = ((t % 24) + 24) % 24;
        const diurnal = 0.25 + 0.75 * bump(h, 15.5, 3.6);
        const breakAfterStorm = t > p.td + 2 ? 0.55 : 1;
        return clamp((p.peak - 0.2 + p.ramp * (t / 24)) * diurnal * breakAfterStorm, 0, 1);
      },
      wind(p, s, c, t) { return clamp(p.wa * pulse(t - s / p.v, p.td, p.ws), 0, 1); },
    },
  };

  // ── Non-weather hazards and Nagpur scenarios ───────────────────────────────
  // Ported from vizsh/72_hours_CASCADE (src/js/engine/scenarios.js at 9bc9058) with the
  // owner's permission; provenance tags added. `cities` limits a scenario to the cities it
  // was written for; `extra` adds non-weather stress (grid faults, plumes, crowds);
  // `t0` and `liveNow` give a scenario its own clock and "now".
  const R_EARTH = 6371008.8;
  function offsetKm(a, b) { // b relative to a, in km (east, north)
    const kx = (Math.PI / 180) * R_EARTH * Math.cos((a[1] * Math.PI) / 180) / 1000, ky = (Math.PI / 180) * R_EARTH / 1000;
    return [(b[0] - a[0]) * kx, (b[1] - a[1]) * ky];
  }
  // Ground-level Gaussian plume (Briggs open-country, class C lateral / class C vertical),
  // normalised so 1.0 is the concentration 3 km downwind on the axis for the nominal release.
  function plume(src, p, lngLat) {
    const [dx, dy] = offsetKm(src, lngLat);
    const to = ((p.windFrom + 180) % 360) * Math.PI / 180;
    const x = dx * Math.sin(to) + dy * Math.cos(to), y = -dx * Math.cos(to) + dy * Math.sin(to);
    if (x <= 0.05) return 0;
    const xm = x * 1000, sy = 0.14 * xm / Math.sqrt(1 + 0.0001 * xm), sz = 0.08 * xm / Math.sqrt(1 + 0.0002 * xm);
    const ref = (0.14 * 3000 / Math.sqrt(1.3)) * (0.08 * 3000 / Math.sqrt(1.6));
    const c = p.q * (3 / Math.max(0.6, p.u)) * (ref / (sy * sz)) * Math.exp(-0.5 * ((y * 1000) / sy) ** 2);
    return clamp(c, 0, 2.5);
  }
  const near = (a, b, km) => { const [x, y] = offsetKm(a, b); return Math.exp(-(x * x + y * y) / (2 * km * km)); };

  Object.assign(SCENARIOS, {
    monsoon2023: {
      id: 'monsoon2023',
      provenance: RECONSTRUCTION,
      label: 'Monsoon cloudburst · 23 Sep 2023',
      blurb: 'Reconstruction of the pre-dawn cloudburst over Nagpur: about 106 mm in four hours, Ambazari Lake overflowing into the Nag. Timing and totals follow IMD-reported figures; city telemetry is modeled.',
      cities: ['nagpur'],
      t0: '2023-09-21T06:00:00+05:30',
      liveNow: 37,
      heading: 62,
      sample(r, truth) {
        // band 1: afternoon shower (22 Sep), band 2: build-up, band 3: the cloudburst (23 Sep 01:00-05:00)
        if (truth) return { t1: 32, a1: 8.5, s1: 1.4, t2: 41, a2: 12, s2: 1.6, t3: 44.5, a3: 33, s3: 1.25, v: 30, gx: -0.25, gy: 0.05, cx: -2.2 };
        return {
          t1: 32 + gauss(r) * 2.5, a1: 8 * lognorm(r, 0.4), s1: 1.2 + r() * 0.8,
          t2: 41 + gauss(r) * 3, a2: 11 * lognorm(r, 0.45), s2: 1.3 + r() * 0.9,
          t3: 44.5 + gauss(r) * 3.5, a3: (r() < 0.3 ? 12 : 29) * lognorm(r, 0.35), s3: 1.0 + r() * 0.7,
          v: 22 + r() * 16, gx: gauss(r) * 0.3, gy: gauss(r) * 0.25, cx: gauss(r) * 3,
        };
      },
      rain(p, s, c, t) {
        const lag = s / p.v;
        const focus = Math.exp(-0.5 * ((c - p.cx) / 6.5) ** 2);
        const spatial = clamp((0.55 + 0.7 * focus) * (1 + p.gx * c / 8 + p.gy * s / 8), 0.3, 1.9);
        return (p.a1 * pulse(t - lag, p.t1, p.s1) + p.a2 * pulse(t - lag, p.t2, p.s2) + p.a3 * pulse(t - lag, p.t3, p.s3)) * spatial;
      },
      heat: () => 0,
      wind(p, s, c, t) { return clamp(0.45 * pulse(t - s / p.v, p.t3, p.s3) * p.a3 / 30, 0, 1); },
    },

    blackout: {
      id: 'blackout',
      provenance: MODELED,
      label: 'Grid fault and telecom blackout',
      blurb: 'A transmission fault drops a cluster of substations for most of a night. Mobile sites run down their batteries, calls stop reaching dispatch, hospitals burn diesel. Modeled scenario.',
      liveNow: 30,
      heading: 90,
      hazardLabel: { power: 'Grid fault', telecom: 'Grid fault', drainage: 'Rainfall', traffic: 'Signals dark' },
      sample(r, truth) {
        if (truth) return { tf: 27, dur: 11, mag: 0.62, rad: 5.5, cx: 0.15, cy: -0.1, bg: 0.4 };
        return { tf: 27 + gauss(r) * 2.5, dur: 8 + r() * 6, mag: 0.4 + r() * 0.35, rad: 4 + r() * 3, cx: gauss(r) * 0.25, cy: gauss(r) * 0.25, bg: r() * 0.6 };
      },
      rain(p, s, c, t) { return p.bg * bump(t, 50, 5); },
      heat: () => 0.15,
      wind: () => 0,
      extra(p, f, kind, st, t) {
        if (kind !== 'power') return 0;
        const on = t >= p.tf && t < p.tf + p.dur ? 1 : t >= p.tf + p.dur && t < p.tf + p.dur + 2 ? 0.4 : 0;
        if (!on) return 0;
        // stations near the faulted bay lose infeed (a few km around a point near the centre)
        const d = Math.hypot(st.s / 1 - p.cx * 6, st.c - p.cy * 6);
        return on * p.mag * Math.exp(-(d * d) / (2 * p.rad * p.rad));
      },
    },

    chlorine: {
      id: 'chlorine',
      provenance: MODELED,
      label: 'Chlorine release at a water treatment plant',
      blurb: 'A chlorine cylinder fails at the Seminary Hills water treatment plant. The plume follows the wind; closures and evacuation load the roads ambulances need, and breathing complaints reach the nearest hospitals. Modeled release, Gaussian plume dispersion.',
      cities: ['nagpur'],
      liveNow: 31,
      heading: 70,
      source: [79.0626, 21.1782],
      hazardLabel: { traffic: 'Chlorine plume', ems: 'Chlorine plume', hospital: 'Exposure surge', telecom: 'Chlorine plume', power: 'Chlorine plume' },
      sample(r, truth) {
        if (truth) return { tr: 29.5, dur: 5, q: 1.0, windFrom: 330, u: 3.0 };
        return { tr: 29.5 + gauss(r) * 0.4, dur: 3 + r() * 4, q: 0.5 + r() * 0.9, windFrom: 330 + gauss(r) * 22, u: 2 + r() * 2.5 };
      },
      rain: () => 0,
      heat(p, t) { const h = ((t % 24) + 24) % 24; return 0.12 * bump(h, 15, 4); },
      wind: () => 0,
      extra(p, f, kind, st, t) {
        const on = t >= p.tr && t < p.tr + p.dur ? 1 : t >= p.tr + p.dur && t < p.tr + p.dur + 3 ? 0.35 : 0;
        if (!on) return 0;
        const c = plume(SCENARIOS.chlorine.source, p, f.lngLat) * on;
        if (kind === 'traffic') return 0.62 * Math.min(1, c);
        if (kind === 'ems') return 0.5 * Math.min(1, c * 1.2);
        if (kind === 'hospital') return 0.42 * Math.min(1, c * 1.4);
        if (kind === 'weather') return 0;
        return 0.15 * Math.min(1, c);
      },
    },

    festival: {
      id: 'festival',
      provenance: MODELED,
      label: 'Immersion-day crowds meet an evening storm',
      blurb: 'Processions converge on Gandhi Sagar and Futala for immersion while a thunderstorm builds. Crowds fill the streets that flood first; ambulances slow; exits near the ghats tighten. Modeled scenario.',
      cities: ['nagpur'],
      liveNow: 36,
      heading: 50,
      crowds: [[79.0995, 21.1468, 1.0], [79.0545, 21.1460, 0.7]],
      hazardLabel: { traffic: 'Crowds and rain', ems: 'Crowds', hospital: 'Crowd injuries' },
      sample(r, truth) {
        if (truth) return { tc: 40, cd: 8, peak: 0.6, t1: 42.5, a1: 24, s1: 1.1, v: 18 };
        return { tc: 40 + gauss(r) * 0.6, cd: 6 + r() * 4, peak: 0.4 + r() * 0.35, t1: 43 + gauss(r) * 3, a1: 18 * lognorm(r, 0.45), s1: 0.8 + r() * 0.7, v: 12 + r() * 12 };
      },
      rain(p, s, c, t) { return p.a1 * pulse(t - s / p.v, p.t1, p.s1); },
      heat: () => 0.05,
      wind(p, s, c, t) { return clamp(0.4 * pulse(t - s / p.v, p.t1, p.s1) * p.a1 / 25, 0, 1); },
      extra(p, f, kind, st, t) {
        const phase = (t - p.tc) / p.cd;
        if (phase < 0 || phase > 1.2) return 0;
        const dens = p.peak * Math.pow(Math.sin(Math.PI * Math.min(1, phase)), 0.7);
        let w = 0;
        for (const [lng, lat, k] of SCENARIOS.festival.crowds) w = Math.max(w, k * near([lng, lat], f.lngLat, 1.4));
        if (kind === 'traffic') return dens * w;
        if (kind === 'ems') return 0.7 * dens * w;
        if (kind === 'hospital') return 0.25 * dens * w;
        return 0;
      },
    },
  });

  root.TWIN.scenarios = SCENARIOS;
})(typeof window !== 'undefined' ? window : globalThis);

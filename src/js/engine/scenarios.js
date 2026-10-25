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

  const SCENARIOS = {
    tropical: {
      id: 'tropical',
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
      label: 'Convective flash flood',
      blurb: 'Training thunderstorms stall over the Crabtree basin for three hours.',
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

  root.TWIN.scenarios = SCENARIOS;
})(typeof window !== 'undefined' ? window : globalThis);

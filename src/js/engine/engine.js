/* Cascade engine.

   1. Simulation. Each facility's risk follows a first-order response toward a
      target built from its own load (diurnal traffic, base occupancy…), the
      scenario's hazards at its location, and lagged contributions from upstream
      facilities along candidate dependency edges. Lags are at least one step,
      so feedback loops (hospital → EMS → hospital) resolve in a forward pass.
   2. Ensemble. M members sample storm parameters, edge weights and facility
      sensitivities from a prior. A separate hidden draw is the "truth" that
      generates the sensor streams; the system never reads it directly.
   3. Assimilation. At every step a localized particle filter reweights members
      by the likelihood of observations up to that step only (strict future-data
      isolation), with forgetting for concept drift and adaptive tempering to keep
      the effective sample size healthy. Sensor trust is estimated online from
      one-step-ahead residuals and flatline detection, and scales each sensor's
      influence, so failed, biased or offline sensors degrade gracefully.
   4. Products. Nowcasts, multi-horizon forecasts with probabilities and
      time-to-critical, explanations (which upstream links drive a facility now),
      posterior dependency weights, type-level discovery from the raw streams,
      alerts, and replay validation (lead time, false alarms, Brier, reliability). */
(function (root) {
  const C = root.TWIN.core;
  const { clamp, sigmoid, bump, mulberry32, gauss, tnoise } = C;

  const DT = 0.5;
  const HOURS = 72;
  const K = HOURS / DT + 1; // 145 steps, T+0.0 … T+72.0
  const CRIT = 0.75, HIGH = 0.55;

  // Response rates toward the target (per step), rising vs. falling.
  const DYN = {
    weather:  [0.85, 0.85],
    drainage: [0.42, 0.10],
    pump:     [0.50, 0.20],
    traffic:  [0.55, 0.32],
    power:    [0.50, 0.22],
    hospital: [0.16, 0.08],
    ems:      [0.50, 0.28],
  };
  // Observation noise (risk units) by kind. Administrative feeds (bed census, CAD,
  // SCADA) are precise; camera-derived traffic and rain gauges are noisier.
  const SIGMA = { weather: 0.06, drainage: 0.04, pump: 0.05, traffic: 0.07, power: 0.035, hospital: 0.02, ems: 0.035 };
  const NOISE = { weather: 0.01, drainage: 0.012, pump: 0.02, traffic: 0.045, power: 0.02, hospital: 0.012, ems: 0.035 };

  // Injected sensor faults and misleading inputs (applied to the observation stream only).
  const FAULTS = [
    { id: 'DRN-CTL', kind: 'stuck', from: 18, to: 40, note: 'Gauge reading frozen' },
    { id: 'TRF-WOB', kind: 'dropout', from: 28, to: 38, note: 'Camera feed offline' },
    { id: 'WX-NCS', kind: 'bias', from: 30, to: 72, value: 0.3, note: 'Gauge reading high, likely debris in funnel' },
  ];
  const FALSE_REPORTS = [
    { t: 16.5, near: 'TRF-FMS', text: 'Street flooding, cars stalled at Fayetteville St & Martin St' },
    { t: 12.5, near: 'PWR-MRD', text: 'Explosion at the Wade Ave substation, west Raleigh without power' },
  ];

  // Only stress above a source's normal operating level propagates downstream.
  const gThr = (r, thr) => (r > thr ? Math.pow((r - thr) / (1 - thr), 1.15) : 0);

  function kindOf(f) {
    if (f.subtype === 'EMS station') return 'ems';
    if (f.subtype === 'Pumping station') return 'pump';
    return f.type;
  }

  function weekday0(t0) {
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date(t0));
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
  }

  function create(geo, opts = {}) {
    const scen = root.TWIN.scenarios[opts.scenario || 'tropical'];
    const M = opts.members || 200;
    const seed = opts.seed || 7;
    const F = geo.facilities;
    const N = F.length;
    const idx = Object.fromEntries(F.map((f, i) => [f.id, i]));
    const kinds = F.map(kindOf);

    const E = geo.edges.map((e, n) => ({
      n, from: idx[e.from], to: idx[e.to], w: e.w, lag: Math.max(1, Math.round(e.lag / DT)),
      hi: e.w > 0 ? 2 * e.w : 0.3, mechanism: e.mechanism, kind: e.kind, path: e.path, km: e.km,
    }));
    const thr = F.map((f) => Math.max(0.3, f.p.base + 0.12));
    const g = (r, j) => gThr(r, thr[j]);
    const inEdges = F.map(() => []);
    const outEdges = F.map(() => []);
    E.forEach((e) => { inEdges[e.to].push(e.n); outEdges[e.from].push(e.n); });
    const NE = E.length;

    // Site coordinates relative to the storm track.
    const h = (scen.heading * Math.PI) / 180;
    const kx = 111.32 * Math.cos((geo.center[1] * Math.PI) / 180), ky = 110.54;
    const sites = F.map((f) => {
      const x = (f.lngLat[0] - geo.center[0]) * kx, y = (f.lngLat[1] - geo.center[1]) * ky;
      return { s: x * Math.sin(h) + y * Math.cos(h), c: x * Math.cos(h) - y * Math.sin(h) };
    });

    // Calendar: weekday-aware traffic.
    const wd0 = weekday0(geo.t0);
    function trafficDiurnal(t) {
      const day = Math.floor(t / 24), hr = t - day * 24, wd = (wd0 + day) % 7;
      let v;
      if (wd === 0 || wd === 6) v = 0.55 + 0.5 * bump(hr, 13.5, 3.2) + 0.15 * bump(hr, 19, 2);
      else v = 0.5 + 0.75 * bump(hr, 8, 1.2) + 0.8 * bump(hr, 17.5, 1.5) + 0.3 * bump(hr, 12.5, 2);
      return hr < 5 ? v * 0.62 : v;
    }
    const hourOf = (t) => t - Math.floor(t / 24) * 24;

    // ── Parameters ──────────────────────────────────────────────────────────
    function drawParams(rand, truth) {
      const sp = scen.sample(rand, truth);
      const ew = new Float32Array(NE);
      for (let e = 0; e < NE; e++) ew[e] = truth ? E[e].w * (0.8 + 0.4 * rand()) : rand() * E[e].hi;
      const capMul = new Float32Array(N), baseOff = new Float32Array(N), expo = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        capMul[i] = Math.exp(gauss(rand) * (truth ? 0.05 : 0.12));
        baseOff[i] = gauss(rand) * (truth ? 0.01 : 0.025);
        expo[i] = truth ? 0.8 : 0.5 + 0.5 * rand();
      }
      return { sp, ew, capMul, baseOff, expo };
    }

    // Exogenous-only target for facility i at time t (no upstream terms).
    // Drainage-type facilities need their antecedent-precipitation state `api`.
    function forcing(P, i, t, api) {
      const f = F[i], p = f.p, kind = kinds[i], st = sites[i];
      const base = p.base + P.baseOff[i];
      const rain = scen.rain(P.sp, st.s, st.c, t);
      const heat = scen.heat(P.sp, t);
      const wind = scen.wind(P.sp, st.s, st.c, t);
      switch (kind) {
        case 'weather':
          return Math.pow(clamp(Math.max(rain / 28, wind * 0.9, heat * 0.85), 0, 1), 0.9);
        case 'drainage':
        case 'pump': {
          const v = base + (1 - base) * sigmoid((api - p.cap * P.capMul[i]) / p.scale);
          return kind === 'pump' ? v + 0.25 * heat : v;
        }
        case 'traffic':
          return base * trafficDiurnal(t) * 1.25 + 0.14 * Math.min(1, rain / 14) + 0.05 * heat;
        case 'power':
          return base * (0.85 + 0.25 * bump(hourOf(t), 18.5, 3)) + 0.38 * heat + 0.5 * wind * P.expo[i];
        case 'hospital':
          return base + 0.03 * bump(hourOf(t), 14, 4) + 0.2 * heat;
        case 'ems':
          return base * (0.85 + 0.3 * bump(hourOf(t), 17, 4)) + 0.12 * Math.min(1, rain / 15) + 0.12 * heat;
      }
      return base;
    }
    function rainAt(P, i, t) { return scen.rain(P.sp, sites[i].s, sites[i].c, t); }

    // ── Simulation ──────────────────────────────────────────────────────────
    // out: Float32Array(K*N) written in place. mods: interventions (see interventions.js).
    // init = { k0, from }: copy steps < k0 from an existing trajectory and resume there,
    // which is how counterfactuals branch off at the decision time.
    function simulate(P, out, noiseSeed, mods, forcOut, init) {
      const api = new Float64Array(N);
      const decay = F.map((f) => (f.p.tau ? Math.exp(-DT / f.p.tau) : 0));
      let kStart = 0;
      if (init && init.k0 > 0) {
        kStart = init.k0;
        out.set(init.from.subarray(0, kStart * N));
        for (let k = 0; k < kStart; k++) for (let i = 0; i < N; i++) if (decay[i]) api[i] = api[i] * decay[i] + rainAt(P, i, k * DT) * DT;
      }
      const facMods = mods ? mods.filter((m) => m.kind === 'fac') : [];
      const edgeScale = new Float32Array(NE).fill(1);
      const edgeMods = mods ? mods.filter((m) => m.kind === 'edge') : [];
      for (let k = kStart; k < K; k++) {
        const t = k * DT;
        edgeScale.fill(1);
        for (const m of edgeMods) if (k >= m.from && (m.to == null || k < m.to)) edgeScale[m.e] *= m.scale;
        for (let i = 0; i < N; i++) {
          const kind = kinds[i];
          if (decay[i]) api[i] = api[i] * decay[i] + rainAt(P, i, t) * DT;
          let target = forcing(P, i, t, api[i]);
          const base = F[i].p.base;
          for (const fm of facMods) {
            if (fm.i === i && k >= fm.from && (fm.to == null || k < fm.to)) {
              if (fm.scale != null) target = base + (target - base) * fm.scale;
              if (fm.add) target += fm.add;
            }
          }
          if (forcOut) forcOut[k * N + i] = target;
          const ie = inEdges[i];
          for (let q = 0; q < ie.length; q++) {
            const e = E[ie[q]];
            const kk = k - e.lag;
            const up = kk >= 0 ? out[kk * N + e.from] : out[e.from]; // before T+0 use the initial state
            target += P.ew[e.n] * edgeScale[e.n] * g(up, e.from);
          }
          target += NOISE[kind] * tnoise(noiseSeed, i, k, 3);
          target = clamp(target, 0, 1);
          let r;
          if (k === 0) r = target;
          else {
            const prev = out[(k - 1) * N + i];
            const [a, b] = DYN[kind];
            r = prev + (target > prev ? a : b) * (target - prev);
          }
          out[k * N + i] = clamp(r, 0, 1);
        }
      }
      return out;
    }

    // Ensemble
    const members = [];
    const traj = new Float32Array(M * K * N);
    const forc = new Float32Array(M * K * N); // exogenous part of each member's target
    for (let m = 0; m < M; m++) {
      const P = drawParams(mulberry32(seed * 1000 + m + 1), false);
      members.push(P);
      simulate(P, traj.subarray(m * K * N, (m + 1) * K * N), 1000 + m, null, forc.subarray(m * K * N, (m + 1) * K * N));
    }
    const R = (m, k, i) => traj[(m * K + k) * N + i];
    // nextX[(m*N+i)*K + k] = first step >= k at which member m's facility i is at or
    // above the level (K if never). One backward pass makes every probability-of-
    // reaching query O(M).
    function crossTable(level) {
      const tab = new Int16Array(M * N * K);
      for (let m = 0; m < M; m++) for (let i = 0; i < N; i++) {
        const b = (m * N + i) * K;
        let nxt = K;
        for (let k = K - 1; k >= 0; k--) { if (traj[(m * K + k) * N + i] >= level) nxt = k; tab[b + k] = nxt; }
      }
      return tab;
    }
    const nextCrit = crossTable(CRIT), nextHigh = crossTable(HIGH);
    const firstAt = (tab, m, i, k) => (k >= K ? K : tab[(m * N + i) * K + k]);

    // Hidden truth and the sensor streams it produces
    const truthP = drawParams(mulberry32(seed * 7919 + 17), true);
    const truth = simulate(truthP, new Float32Array(K * N), 99991, null);
    const obs = new Float32Array(K * N);
    {
      const rand = mulberry32(seed * 31 + 5);
      for (let k = 0; k < K; k++) for (let i = 0; i < N; i++) {
        obs[k * N + i] = clamp(truth[k * N + i] + gauss(rand) * SIGMA[kinds[i]] * 0.8, 0, 1);
      }
      for (const fl of FAULTS) {
        const i = idx[fl.id];
        if (i == null) continue;
        const k0 = Math.round(fl.from / DT), k1 = Math.min(K - 1, Math.round(fl.to / DT));
        for (let k = k0; k <= k1; k++) {
          if (fl.kind === 'stuck') obs[k * N + i] = obs[k0 * N + i];
          if (fl.kind === 'dropout') obs[k * N + i] = NaN;
          if (fl.kind === 'bias') obs[k * N + i] = clamp(obs[k * N + i] + fl.value, 0, 1);
        }
      }
    }

    // ── Assimilation pass ───────────────────────────────────────────────────
    const LAMBDA = 0.985;     // forgetting per step (≈ 23 h memory) for concept drift
    const ESS_FLOOR = 0.12;   // keep at least 12% of members effective
    const stormInformative = F.map((f, i) => kinds[i] === 'weather' || kinds[i] === 'drainage');
    const Lc = new Float32Array(K * N * M);   // per-facility cumulative log-likelihood
    const Gc = new Float32Array(K * M);       // storm-level cumulative log-likelihood
    const W = new Float32Array(K * N * M);    // normalized local weights
    const ESS = new Float32Array(K * N);
    const trust = new Float32Array(K * N);
    const prior = new Float32Array(K * N);    // one-step-ahead prediction
    const priorSd = new Float32Array(K * N);  // its ensemble spread
    const now = new Float32Array(K * N);      // analysis (displayed risk)
    const nowSd = new Float32Array(K * N);
    const resid = new Float32Array(N);        // EWMA |residual|
    const flat = new Float32Array(N);
    const neigh = F.map((_, i) => [i, ...inEdges[i].map((e) => E[e].from)]);
    const logw = new Float64Array(M);
    const Tprev = new Float64Array(N).fill(1);

    function weightsFor(k, i, out) {
      // log w = storm evidence (shared) + local evidence of i and its upstream neighbours.
      let mx = -Infinity;
      const gBase = k * M;
      for (let m = 0; m < M; m++) {
        let s = 0.35 * Gc[gBase + m];
        for (const j of neigh[i]) s += Lc[(k * N + j) * M + m] * (j === i ? 1 : 0.5);
        logw[m] = s;
        if (s > mx) mx = s;
      }
      // Adaptive tempering: smallest temperature T >= 1 with ESS >= floor, warm-started
      // from this facility's previous temperature (it changes slowly step to step).
      const need = ESS_FLOOR * M;
      const essAt = (T) => {
        let s1 = 0, s2 = 0;
        for (let m = 0; m < M; m++) { const w = Math.exp((logw[m] - mx) / T); out[m] = w; s1 += w; s2 += w * w; }
        return (s1 * s1) / s2;
      };
      let T = 1, ess = essAt(1);
      if (ess < need) {
        let lo = 1, hi = Math.max(1.05, Tprev[i]);
        if (essAt(hi) >= need) { lo = Math.max(1, hi / 1.6); if (essAt(lo) >= need) { hi = lo; lo = 1; } }
        else { lo = hi; hi *= 1.6; while (essAt(hi) < need && hi < 1e7) { lo = hi; hi *= 2; } }
        for (let it = 0; it < 6; it++) { const mid = Math.sqrt(lo * hi); if (essAt(mid) < need) lo = mid; else hi = mid; }
        T = hi;
        ess = essAt(T);
      }
      Tprev[i] = T;
      let s = 0;
      for (let m = 0; m < M; m++) s += out[m];
      for (let m = 0; m < M; m++) out[m] /= s;
      return ess;
    }

    // Online dependency learner: sparse Bayesian regression (ARD) with forgetting, one
    // per facility over its incoming candidate links. From r(k) = (1-a) r(k-1) + a·target,
    // the observed residual y = obs(k) - (1-a) obs(k-1) - a·forcing is regressed on
    // a·g(upstream). Priors are zero-mean, so no link is assumed to exist; each link's
    // prior precision is re-estimated by EM, which prunes redundant co-moving causes.
    // A link whose upstream never leaves its normal band carries no evidence and stays
    // "candidate"; an exercised link is confirmed or pruned.
    const LRLS = 0.995;
    const eMean = new Float32Array(K * NE), eSd = new Float32Array(K * NE), eEv = new Float32Array(K * NE);
    const rls = F.map((_, i) => {
      const ie = inEdges[i], p = ie.length;
      const alpha0 = ie.map((e) => 3 / (E[e].hi * E[e].hi)); // prior sd = hi / sqrt(3)
      return { ie, p, alpha0, lam0: alpha0.slice(), mu0: ie.map(() => 0), D: new Float64Array(p * p), b: new Float64Array(p) };
    });
    function solveRls(st) {
      const p = st.p, A = new Float64Array(p * p), I = new Float64Array(p * p), rhs = new Float64Array(p);
      for (let a = 0; a < p; a++) {
        for (let c = 0; c < p; c++) A[a * p + c] = st.D[a * p + c];
        A[a * p + a] += st.lam0[a];
        I[a * p + a] = 1;
        rhs[a] = st.lam0[a] * st.mu0[a] + st.b[a];
      }
      for (let c = 0; c < p; c++) { // Gauss-Jordan on [A | I], A is SPD so no pivoting needed
        const d = A[c * p + c];
        for (let j = 0; j < p; j++) { A[c * p + j] /= d; I[c * p + j] /= d; }
        for (let r = 0; r < p; r++) if (r !== c) {
          const f = A[r * p + c];
          if (!f) continue;
          for (let j = 0; j < p; j++) { A[r * p + j] -= f * A[c * p + j]; I[r * p + j] -= f * I[c * p + j]; }
        }
      }
      const mean = new Float64Array(p), sd = new Float64Array(p);
      for (let a = 0; a < p; a++) {
        let v = 0;
        for (let c = 0; c < p; c++) v += I[a * p + c] * rhs[c];
        mean[a] = v; sd[a] = Math.sqrt(Math.max(1e-8, I[a * p + a]));
      }
      return { mean, sd };
    }

    const wTmp = new Float32Array(M);
    for (let k = 0; k < K; k++) {
      // 1. Prior (one-step-ahead) from weights at k-1.
      for (let i = 0; i < N; i++) {
        let mu = 0, m2 = 0;
        if (k === 0) { for (let m = 0; m < M; m++) { const r = R(m, 0, i); mu += r; m2 += r * r; } mu /= M; m2 /= M; }
        else { const wb = ((k - 1) * N + i) * M; for (let m = 0; m < M; m++) { const r = R(m, k, i); mu += W[wb + m] * r; m2 += W[wb + m] * r * r; } }
        prior[k * N + i] = mu;
        priorSd[k * N + i] = Math.sqrt(Math.max(0, m2 - mu * mu));
      }
      // 2. Trust from residuals and flatline detection.
      for (let i = 0; i < N; i++) {
        const y = obs[k * N + i];
        let tr = k ? trust[(k - 1) * N + i] : 0.92;
        if (Number.isNaN(y)) {
          tr = tr + (0.35 - tr) * 0.12; // offline: drift toward low confidence
        } else {
          // Residual in units of total predictive spread: a sensor disagreeing with an
          // uncertain forecast is not evidence that the sensor has failed.
          const sig0 = SIGMA[kinds[i]], sp = priorSd[k * N + i];
          const res = Math.abs(y - prior[k * N + i]) / Math.sqrt(sig0 * sig0 + sp * sp);
          resid[i] = k ? 0.85 * resid[i] + 0.15 * res : res;
          if (k >= 1) {
            const yp = obs[(k - 1) * N + i];
            const dObs = Number.isNaN(yp) ? 1 : Math.abs(y - yp);
            const dPri = Math.abs(prior[k * N + i] - prior[(k - 1) * N + i]);
            flat[i] = dObs < 1e-6 && dPri > 0.004 ? flat[i] + 1 : Math.max(0, flat[i] - 0.5);
          }
          let target = Math.exp(-Math.max(0, resid[i] - 1.6) / 1.1);
          if (flat[i] >= 4) target *= 0.25;
          tr = tr + (target - tr) * 0.25;
        }
        trust[k * N + i] = clamp(tr, 0.03, 0.99);
      }
      // 3. Likelihoods with forgetting.
      for (let m = 0; m < M; m++) Gc[k * M + m] = k ? LAMBDA * Gc[(k - 1) * M + m] : 0;
      for (let i = 0; i < N; i++) {
        const y = obs[k * N + i], tr = trust[k * N + i], sig = SIGMA[kinds[i]];
        const base = (k * N + i) * M, prevb = ((k - 1) * N + i) * M;
        // Quarantine: once a sensor is suspect, forget what it told us quickly.
        const lam = tr < 0.5 ? 0.82 : LAMBDA;
        for (let m = 0; m < M; m++) {
          let ll = 0;
          if (!Number.isNaN(y)) { const z = (y - R(m, k, i)) / sig; ll = -0.5 * z * z * tr; }
          Lc[base + m] = (k ? lam * Lc[prevb + m] : 0) + ll;
          if (stormInformative[i]) Gc[k * M + m] += ll;
        }
      }
      // 4. Local weights, analysis state.
      for (let i = 0; i < N; i++) {
        ESS[k * N + i] = weightsFor(k, i, wTmp);
        W.set(wTmp, (k * N + i) * M);
        let mu = 0, m2 = 0;
        for (let m = 0; m < M; m++) { const r = R(m, k, i); mu += wTmp[m] * r; m2 += wTmp[m] * r * r; }
        const sd = Math.sqrt(Math.max(1e-6, m2 - mu * mu));
        const y = obs[k * N + i];
        let xa = mu;
        if (!Number.isNaN(y)) {
          const so = SIGMA[kinds[i]] / Math.max(0.05, trust[k * N + i]);
          const gain = (sd * sd) / (sd * sd + so * so);
          xa = mu + gain * (y - mu);
          nowSd[k * N + i] = Math.sqrt((1 - gain) * sd * sd);
        } else nowSd[k * N + i] = sd;
        now[k * N + i] = clamp(xa, 0, 1);
      }
      // 5. Dependency learning update.
      for (let i = 0; i < N; i++) {
        const st = rls[i], p = st.p;
        if (!p) continue;
        for (let q = 0; q < p * p; q++) st.D[q] *= LRLS;
        for (let q = 0; q < p; q++) st.b[q] *= LRLS;
        const y1 = k ? obs[k * N + i] : NaN, y0 = k ? obs[(k - 1) * N + i] : NaN, tr = trust[k * N + i];
        if (!Number.isNaN(y1) && !Number.isNaN(y0) && tr > 0.5 && y1 < 0.995) {
          const [up, dn] = DYN[kinds[i]];
          const a = y1 >= y0 ? up : dn;
          let fh = 0;
          const wb = (k * N + i) * M;
          for (let m = 0; m < M; m++) fh += W[wb + m] * forc[(m * K + k) * N + i];
          const y = y1 - (1 - a) * y0 - a * fh;
          const sig = SIGMA[kinds[i]];
          const s2 = (sig * sig * (1 + (1 - a) * (1 - a))) / tr + (a * 0.06) ** 2;
          const x = st.ie.map((e) => a * g(now[Math.max(0, k - E[e].lag) * N + E[e].from], E[e].from));
          for (let r = 0; r < p; r++) {
            if (!x[r]) continue;
            st.b[r] += (x[r] * y) / s2;
            for (let c = 0; c < p; c++) st.D[r * p + c] += (x[r] * x[c]) / s2;
          }
        }
        let sol = solveRls(st);
        for (let it = 0; it < 2; it++) {
          // EM update of each link's prior precision once it has evidence; otherwise relax to the prior.
          for (let q = 0; q < p; q++) {
            const ev = st.D[q * p + q] / st.alpha0[q];
            st.lam0[q] = ev > 0.5
              ? clamp(1 / (sol.mean[q] * sol.mean[q] + sol.sd[q] * sol.sd[q]), st.alpha0[q] * 0.25, 1e4)
              : Math.exp(0.97 * Math.log(st.lam0[q]) + 0.03 * Math.log(st.alpha0[q]));
          }
          sol = solveRls(st);
        }
        st.ie.forEach((e, q) => {
          eMean[k * NE + e] = clamp(sol.mean[q], 0, E[e].hi);
          eSd[k * NE + e] = sol.sd[q];
          eEv[k * NE + e] = st.D[q * p + q] / st.alpha0[q];
        });
      }
    }

    // ── Products ────────────────────────────────────────────────────────────
    const kOf = (t) => clamp(Math.round(t / DT), 0, K - 1);
    const wAt = (k, i) => W.subarray((k * N + i) * M, (k * N + i + 1) * M);

    function stateAt(k) {
      return {
        risk: now.subarray(k * N, (k + 1) * N),
        sd: nowSd.subarray(k * N, (k + 1) * N),
        trust: trust.subarray(k * N, (k + 1) * N),
        obs: obs.subarray(k * N, (k + 1) * N),
      };
    }

    // Forecast for facility i issued at step k, using only information up to k.
    function forecast(k, i) {
      const w = wAt(k, i);
      // Perturbation forecast: each member starts from the analysis and then follows its
      // own dynamics; the anchoring offset decays over ~6 h.
      const xa = now[k * N + i];
      const off0 = new Float32Array(M);
      for (let m = 0; m < M; m++) off0[m] = xa - R(m, k, i);
      const series = [];
      for (let kk = k; kk < K; kk++) {
        const pairs = [];
        let mu = 0, pc = 0;
        const decay = Math.exp(-((kk - k) * DT) / 6);
        for (let m = 0; m < M; m++) { const r = R(m, kk, i) + off0[m] * decay; mu += w[m] * r; if (r >= CRIT) pc += w[m]; pairs.push([r, w[m]]); }
        pairs.sort((a, b) => a[0] - b[0]);
        series.push({ k: kk, t: kk * DT, mean: clamp(mu, 0, 1), p10: clamp(C.quantile(pairs, 0.1), 0, 1), p90: clamp(C.quantile(pairs, 0.9), 0, 1), pCrit: pc });
      }
      // Time to critical: first crossing per member.
      const cross = [];
      let pReach = 0, p24 = 0;
      // First crossing of each bias-corrected member trajectory (same basis as the mean).
      for (let m = 0; m < M; m++) {
        for (let kk = k; kk < K; kk++) {
          if (R(m, kk, i) + off0[m] * Math.exp(-((kk - k) * DT) / 6) >= CRIT) {
            cross.push([(kk - k) * DT, w[m]]); pReach += w[m]; if (kk - k <= 24 / DT) p24 += w[m];
            break;
          }
        }
      }
      cross.sort((a, b) => a[0] - b[0]);
      const norm = cross.map(([v, ww]) => [v, ww / (pReach || 1)]);
      const ttc = pReach > 0.02 ? { prob: pReach, median: C.quantile(norm, 0.5), p10: C.quantile(norm, 0.1), p90: C.quantile(norm, 0.9) } : { prob: pReach, median: Infinity };
      const horizons = [1, 6, 12, 24, 48, 72].map((hh) => {
        const kk = Math.min(K - 1, k + Math.round(hh / DT));
        const s = series[kk - k];
        return { h: hh, beyond: k + hh / DT > K - 1, ...s };
      });
      return { series, ttc, horizons, p24 };
    }
    // Forecast mean of every facility at step kTo, issued at kFrom (bias-corrected).
    function project(kFrom, kTo) {
      const out = new Float32Array(N);
      const decay = Math.exp(-((kTo - kFrom) * DT) / 6);
      for (let i = 0; i < N; i++) {
        const w = wAt(kFrom, i);
        let a = 0, b = 0;
        for (let m = 0; m < M; m++) { a += w[m] * R(m, kTo, i); b += w[m] * R(m, kFrom, i); }
        out[i] = clamp(a + (now[kFrom * N + i] - b) * decay, 0, 1);
      }
      return out;
    }
    function meanAt(k, i, w) { let mu = 0; for (let m = 0; m < M; m++) mu += w[m] * R(m, k, i); return mu; }

    // Weighted mean of each member's exogenous forcing for facility i at step k.
    function forcingEstimate(k, i) {
      const w = wAt(k, i);
      const base = F[i].p.base;
      let acc = 0, rainAcc = 0;
      for (let m = 0; m < M; m++) {
        if (w[m] < 1e-4) continue;
        acc += w[m] * (forc[(m * K + k) * N + i] - base - members[m].baseOff[i]);
        rainAcc += w[m] * rainAt(members[m], i, k * DT);
      }
      return { forcing: acc, rain: rainAcc };
    }

    function edgePosterior(k, e) {
      const ed = E[e];
      const mu = eMean[k * NE + e], sd = eSd[k * NE + e], ev = eEv[k * NE + e];
      const up = k - ed.lag >= 0 ? now[(k - ed.lag) * N + ed.from] : now[ed.from];
      const learned = clamp(ev / (1 + ev), 0, 1); // share of the posterior that comes from data
      let status = 'candidate';
      if (mu >= 0.08 && mu / sd >= 2.5 && learned > 0.5) status = 'confirmed';
      else if (mu < 0.05 && learned > 0.6) status = 'pruned';
      return { e, mean: mu, sd, learned, status, active: up > thr[ed.from] + 0.05, flow: mu * g(up, ed.from) };
    }
    function edgesAt(k) { return E.map((_, e) => edgePosterior(k, e)); }

    // Ranked causal drivers of facility i at step k.
    function explain(k, i) {
      const f = F[i];
      const out = [];
      const fe = forcingEstimate(k, i);
      out.push({ kind: 'base', label: baseLabel(kinds[i]), value: f.p.base });
      if (Math.abs(fe.forcing) > 0.005) out.push({ kind: 'hazard', label: hazardLabel(kinds[i]), value: fe.forcing, rain: fe.rain, wx: f.p.wx });
      for (const e of inEdges[i]) {
        const ep = edgePosterior(k, e);
        const ed = E[e];
        const kk = Math.max(0, k - ed.lag);
        const up = now[kk * N + ed.from];
        out.push({
          kind: 'edge', edge: e, from: ed.from, value: ep.mean * g(up, ed.from), weight: ep.mean, sd: ep.sd, status: ep.status,
          lag: ed.lag * DT, upstreamRisk: up, upstreamObs: obs[kk * N + ed.from], upstreamTrust: trust[kk * N + ed.from], mechanism: ed.mechanism,
        });
      }
      const total = out.reduce((s, d) => s + Math.max(0, d.value), 0) || 1;
      out.forEach((d) => (d.share = Math.max(0, d.value) / total));
      out.sort((a, b) => b.value - a.value);
      return { drivers: out, risk: now[k * N + i], trust: trust[k * N + i] };
    }
    function baseLabel(kind) {
      return { weather: 'Background', drainage: 'Baseflow', pump: 'Baseline duty', traffic: 'Baseline demand (time of day)', power: 'Baseline load (time of day)', hospital: 'Baseline census', ems: 'Baseline call volume' }[kind];
    }
    function hazardLabel(kind) {
      return { weather: 'Observed hazard', drainage: 'Rainfall on catchment', pump: 'Rainfall inflow', traffic: 'Rain slowdown', power: 'Heat and wind stress', hospital: 'Heat illness surge', ems: 'Storm call volume' }[kind];
    }

    // Inbound sources grouped by compass quadrant from the facility.
    function inbound(k, i) {
      const q = { N: [], E: [], S: [], W: [] };
      for (const e of inEdges[i]) {
        const ed = E[e];
        const b = (C.bearing(F[i].lngLat, F[ed.from].lngLat) + 360) % 360;
        const key = b >= 315 || b < 45 ? 'N' : b < 135 ? 'E' : b < 225 ? 'S' : 'W';
        const ep = edgePosterior(k, e);
        const up = now[Math.max(0, k - ed.lag) * N + ed.from];
        q[key].push({ from: ed.from, flow: ep.mean * g(up, ed.from), active: up > thr[ed.from] + 0.05 });
      }
      return q;
    }

    // Most probable failure sequence: observed crossings up to k, forecast after.
    function cascade(k) {
      const seq = [];
      for (let i = 0; i < N; i++) {
        if (kinds[i] === 'weather') continue;
        for (const [lvl, level, tab] of [['HIGH RISK', HIGH, nextHigh], ['CRITICAL', CRIT, nextCrit]]) {
          let found = false;
          for (let kk = 0; kk <= k; kk++) if (now[kk * N + i] >= level) { seq.push({ i, level: lvl, t: kk * DT, prob: 1, observed: true }); found = true; break; }
          if (found) continue;
          const w = wAt(k, i);
          const cross = [];
          let pr = 0;
          for (let m = 0; m < M; m++) { const kk = firstAt(tab, m, i, k + 1); if (kk < K) { cross.push([kk * DT, w[m]]); pr += w[m]; } }
          if (pr >= 0.3) {
            cross.sort((a, b) => a[0] - b[0]);
            seq.push({ i, level: lvl, t: C.quantile(cross.map(([v, ww]) => [v, ww / pr]), 0.5), prob: pr, observed: false });
          }
        }
      }
      seq.sort((a, b) => a.t - b.t);
      return seq;
    }

    // Type-level dependency discovery from raw sensor streams only (no model).
    const GROUPS = ['weather', 'drainage', 'traffic', 'power', 'ems', 'hospital'];
    function groupSeries(kMax) {
      const out = {};
      for (const gname of GROUPS) {
        const members_ = F.map((_, i) => i).filter((i) => (gname === 'drainage' ? kinds[i] === 'drainage' || kinds[i] === 'pump' : kinds[i] === gname));
        const s = new Float32Array(kMax + 1);
        const last = new Float32Array(N);
        for (let k = 0; k <= kMax; k++) {
          let acc = 0;
          for (const i of members_) {
            const y = obs[k * N + i];
            if (!Number.isNaN(y) && trust[k * N + i] > 0.4) last[i] = y;
            // Exceedance over the facility's normal band, so diurnal swings don't mask stress.
            acc += gname === 'weather' ? last[i] : Math.max(0, last[i] - thr[i] + 0.06);
          }
          s[k] = acc / members_.length;
        }
        out[gname] = s;
      }
      return out;
    }
    // Smoothed first differences (2-step) of a series.
    const diff2 = (a) => { const d = new Float32Array(a.length); for (let t = 2; t < a.length; t++) d[t] = a[t] - a[t - 2]; return d; };
    function corrLag(x, y, lag, k0, k1) {
      // corr( x[t-lag], y[t] ) over the window
      let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let t = k0 + lag + 2; t <= k1; t++) {
        const u = x[t - lag], v = y[t];
        n++; sa += u; sb += v; saa += u * u; sbb += v * v; sab += u * v;
      }
      if (n < 8) return 0;
      const cov = sab / n - (sa / n) * (sb / n);
      const va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
      if (va < 1e-8 || vb < 1e-8) return 0;
      return cov / Math.sqrt(va * vb);
    }
    // Remove the part of y explained by the weather driver at its best lag, so
    // two systems that both react to rain are not mistaken for a dependency.
    // Distributed-lag regression: systems that react to rain at different delays
    // would otherwise look like they drive one another.
    const WX_LAGS = [0, 2, 4, 6, 8, 10, 12];
    function partialOut(y, wx, k0, k1) {
      const p = WX_LAGS.length, A = new Float64Array(p * p), b = new Float64Array(p);
      const xs = (t) => WX_LAGS.map((L) => (t - L >= 0 ? wx[t - L] : 0));
      for (let t = k0 + 2; t <= k1; t++) {
        const x = xs(t);
        for (let a = 0; a < p; a++) { b[a] += x[a] * y[t]; for (let c = 0; c < p; c++) A[a * p + c] += x[a] * x[c]; }
      }
      for (let a = 0; a < p; a++) A[a * p + a] += 1e-6; // ridge
      // Solve A beta = b (Gaussian elimination, A is SPD)
      const M_ = Array.from({ length: p }, (_, a) => [...A.subarray(a * p, a * p + p), b[a]]);
      for (let c = 0; c < p; c++) {
        for (let r = c + 1; r < p; r++) { const f = M_[r][c] / M_[c][c]; for (let j = c; j <= p; j++) M_[r][j] -= f * M_[c][j]; }
      }
      const beta = new Float64Array(p);
      for (let r = p - 1; r >= 0; r--) { let v = M_[r][p]; for (let j = r + 1; j < p; j++) v -= M_[r][j] * beta[j]; beta[r] = v / M_[r][r]; }
      const out = new Float32Array(y.length);
      for (let t = 0; t < y.length; t++) { const x = xs(t); let fit = 0; for (let a = 0; a < p; a++) fit += beta[a] * x[a]; out[t] = y[t] - fit; }
      return out;
    }
    function discover(k) {
      const raw = groupSeries(k);
      const k0 = Math.max(0, k - 48); // trailing 24 h window
      const d = {}, r = {};
      for (const gname of GROUPS) d[gname] = diff2(raw[gname]);
      for (const gname of GROUPS) r[gname] = gname === 'weather' ? d.weather : partialOut(d[gname], d.weather, k0, k);
      const res = [];
      for (const a of GROUPS) for (const b of GROUPS) {
        if (a === b || b === 'weather') continue;
        const xa = a === 'weather' ? d.weather : r[a], yb = a === 'weather' ? d[b] : r[b];
        let best = 0, bestLag = 0;
        for (let lag = 1; lag <= 10; lag++) { const c = corrLag(xa, yb, lag, k0, k); if (c > best) { best = c; bestLag = lag; } }
        let rev = 0;
        if (a !== 'weather') for (let lag = 1; lag <= 10; lag++) rev = Math.max(rev, corrLag(r[b], r[a], lag, k0, k));
        res.push({ from: a, to: b, strength: best, lag: bestLag * DT, reverse: rev, found: best > 0.35 && best > rev + 0.03 });
      }
      return res;
    }

    // Alerts derived from the system's own state, only from information available at each step.
    const alerts = [];
    {
      const lvl = new Int8Array(N);
      const warned = new Uint8Array(N);
      const faulty = new Uint8Array(N);
      for (let k = 0; k < K; k++) {
        for (let i = 0; i < N; i++) {
          const r = now[k * N + i];
          const L = r >= CRIT ? 3 : r >= HIGH ? 2 : r >= 0.35 ? 1 : 0;
          if (L > lvl[i] && L >= 2 && kinds[i] !== 'weather') {
            alerts.push({ k, t: k * DT, i, sev: L === 3 ? 'critical' : 'high', kind: 'state', title: `${F[i].name}`, text: L === 3 ? critText(i) : highText(i) });
          }
          if (L < lvl[i] - 1 || (L === 0 && lvl[i] >= 2)) lvl[i] = L; // hysteresis
          else if (L > lvl[i]) lvl[i] = L;
          const tr = trust[k * N + i];
          if (!faulty[i] && tr < 0.5 && k > 4) {
            faulty[i] = 1;
            alerts.push({ k, t: k * DT, i, sev: 'sensor', kind: 'sensor', title: `${F[i].sensor} reliability low`, text: sensorText(i, k) });
          }
          if (faulty[i] && tr > 0.75) faulty[i] = 0;
        }
        if (k % 2 === 0) {
          for (let i = 0; i < N; i++) {
            if (warned[i] || kinds[i] === 'weather' || now[k * N + i] >= HIGH) continue;
            const w = wAt(k, i);
            let p = 0, tsum = 0;
            for (let m = 0; m < M; m++) { const kk = firstAt(nextCrit, m, i, k + 1); if (kk < K && kk <= k + 24 / DT) { p += w[m]; tsum += w[m] * (kk - k) * DT; } }
            if (p >= 0.6) {
              warned[i] = 1;
              alerts.push({ k, t: k * DT, i, sev: 'forecast', kind: 'forecast', title: `Predicted CRITICAL · ${F[i].name}`, text: `${Math.round(p * 100)}% probability within ${C.fmtDur(tsum / p)}`, eta: tsum / p, p });
            }
          }
        }
      }
      // Citizen reports: genuine ones follow real flooding; false ones are checked against sensors.
      const rand = mulberry32(seed * 131 + 9);
      for (let i = 0; i < N; i++) {
        if (kinds[i] !== 'drainage' && kinds[i] !== 'traffic') continue;
        for (let k = 0; k < K; k++) if (truth[k * N + i] >= 0.62) {
          const kr = Math.min(K - 1, k + 1 + Math.floor(rand() * 4));
          if (rand() < 0.7) alerts.push({ k: kr, t: kr * DT, i, sev: 'report', kind: 'report', title: 'Citizen report', text: reportText(i), conf: verify(kr, i), tr: trust[kr * N + i] });
          break;
        }
      }
      for (const fr of FALSE_REPORTS) {
        const i = idx[fr.near], kr = kOf(fr.t);
        alerts.push({ k: kr, t: fr.t, i, sev: 'report', kind: 'report', title: 'Citizen report', text: fr.text, conf: verify(kr, i), tr: trust[kr * N + i], planted: true });
      }
      alerts.sort((a, b) => a.k - b.k);
    }
    // Corroboration of a citizen report against the system's own estimate at that place.
    // The analysis already discounts a failed local sensor, so it is the right referee.
    function verify(k, i) {
      const r = now[k * N + i];
      return clamp(sigmoid((r - 0.45) / 0.09) * 0.95 + 0.02, 0.02, 0.98);
    }
    function critText(i) {
      return { drainage: 'Channel over capacity, roadway overtopping likely', pump: 'Station at capacity, inflow exceeding pump rate', traffic: 'Gridlock, lanes closed or impassable', power: 'Substation at risk of forced outage', hospital: 'Capacity critical, diversion likely', ems: 'Response times beyond target, units exhausted' }[kinds[i]];
    }
    function highText(i) {
      return { drainage: 'Stage rising fast, approaching bankfull', pump: 'Pump duty high, wet well rising', traffic: 'Heavy congestion, speeds below 15 mph', power: 'Feeder load high, flood exposure rising', hospital: 'Census rising, ED boarding', ems: 'Response times rising' }[kinds[i]];
    }
    function sensorText(i, k) {
      const fl = FAULTS.find((x) => x.id === F[i].id && k * DT >= x.from - 1);
      const why = fl ? fl.note : 'Readings disagree with neighbouring sensors';
      return `${why}; influence reduced to ${Math.round(trust[k * N + i] * 100)}%`;
    }
    function reportText(i) {
      return { drainage: `Water over the road near ${F[i].name.replace(/ at /, ', ')}`, pump: 'Standing water near the pump station', traffic: `Traffic stopped, vehicles turning around at ${F[i].name.replace(/ at /, ' & ')}` }[kinds[i]] || 'Reported disruption';
    }

    // Replay validation against the hidden truth (computed lazily).
    let validationCache = null;
    function validation() {
      if (validationCache) return validationCache;
      const H = [6, 12, 24];
      const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, o: 0 }));
      let brierSum = 0, brierN = 0, climSum = 0;
      const outcomes = [];
      for (let k = 0; k < K; k += 2) for (let i = 0; i < N; i++) {
        if (kinds[i] === 'weather') continue;
        const w = wAt(k, i);
        for (const hh of H) {
          const k1 = k + hh / DT;
          if (k1 >= K) continue;
          let p = 0;
          for (let m = 0; m < M; m++) if (firstAt(nextCrit, m, i, k + 1) <= k1) p += w[m];
          let o = 0;
          for (let kk = k + 1; kk <= k1; kk++) if (truth[kk * N + i] >= CRIT) { o = 1; break; }
          outcomes.push([p, o]);
          brierSum += (p - o) ** 2; brierN++;
          const b = bins[Math.min(9, Math.floor(p * 10))];
          b.n++; b.p += p; b.o += o;
        }
      }
      const base = outcomes.reduce((s, x) => s + x[1], 0) / outcomes.length;
      for (const [, o] of outcomes) climSum += (base - o) ** 2;
      const brier = brierSum / brierN, bss = 1 - brier / (climSum / outcomes.length);
      // Lead time and false alarms on 24 h warnings.
      const leads = [];
      let alarms = 0, falseAlarms = 0, events = 0, hits = 0;
      for (let i = 0; i < N; i++) {
        if (kinds[i] === 'weather') continue;
        let tc = -1;
        for (let k = 0; k < K; k++) if (truth[k * N + i] >= CRIT) { tc = k; break; }
        // Same rule as the alert feed: warn when P(critical within 24 h) >= 0.6,
        // or when the facility is already observed above HIGH and rising into it.
        let firstWarn = -1;
        for (let k = 0; k < K; k++) {
          const w = wAt(k, i);
          let p = 0;
          for (let m = 0; m < M; m++) { const kk = firstAt(nextCrit, m, i, k + 1); if (kk < K && kk <= k + 24 / DT) p += w[m]; }
          if (p >= 0.6) { firstWarn = k; break; }
        }
        if (firstWarn >= 0) {
          alarms++;
          if (tc < 0 || tc > firstWarn + 24 / DT + 12) falseAlarms++;
        }
        if (tc >= 0) {
          events++;
          if (firstWarn >= 0 && firstWarn <= tc) { hits++; leads.push({ i, lead: (tc - firstWarn) * DT, tc: tc * DT }); }
          else leads.push({ i, lead: 0, tc: tc * DT, missed: firstWarn < 0 || firstWarn > tc });
        }
      }
      const ls = leads.filter((l) => !l.missed).map((l) => l.lead).sort((a, b) => a - b);
      validationCache = {
        brier, bss, base, bins: bins.map((b) => ({ n: b.n, p: b.n ? b.p / b.n : 0, o: b.n ? b.o / b.n : 0 })),
        leads, medianLead: ls.length ? ls[Math.floor(ls.length / 2)] : 0,
        pod: events ? hits / events : 1, far: alarms ? falseAlarms / alarms : 0, alarms, falseAlarms, events, hits,
        pairs: outcomes.length,
      };
      return validationCache;
    }

    // City-wide summary
    function cityAt(k) {
      const counts = { normal: 0, watch: 0, high: 0, critical: 0 };
      let maxR = 0, sum = 0, n = 0;
      for (let i = 0; i < N; i++) {
        if (kinds[i] === 'weather') continue;
        const r = now[k * N + i];
        counts[C.stateOf(r).key]++; maxR = Math.max(maxR, r); sum += r * (4 - F[i].tier); n += 4 - F[i].tier;
      }
      const idxR = sum / n;
      // City state escalates with the number of critical nodes, not just the worst one.
      const cityR = clamp(0.5 * idxR + 0.5 * maxR - (counts.critical < 2 ? 0.08 : 0) + 0.04 * Math.max(0, counts.critical - 2), 0, 1);
      let ess = 0;
      for (let i = 0; i < N; i++) ess += ESS[k * N + i];
      return { counts, maxR, index: idxR, risk: cityR, ess: ess / N };
    }

    // Rain field for the radar overlay. Up to "now" the radar shows the observed storm
    // (truth); beyond it, the most probable member given evidence at `kNow`.
    function radarParams(t, kNow) {
      if (kOf(t) <= kNow) return truthP.sp;
      const w = wAt(kNow, idx['WX-DTN'] ?? 0);
      let best = 0;
      for (let m = 1; m < M; m++) if (w[m] > w[best]) best = m;
      return members[best].sp;
    }
    function rainField(sp, lng, lat, t) {
      const x = (lng - geo.center[0]) * kx, y = (lat - geo.center[1]) * ky;
      return scen.rain(sp, x * Math.sin(h) + y * Math.cos(h), x * Math.cos(h) - y * Math.sin(h), t);
    }

    return {
      geo, scen, F, E, N, M, K, DT, HOURS, idx, kinds, inEdges, outEdges,
      FAULTS, members, traj, truth, obs, now, nowSd, trust, prior, ESS,
      kOf, stateAt, forecast, project, explain, diurnal: trafficDiurnal, thr, edgesAt, edgePosterior, inbound, cascade, discover, alerts,
      validation, cityAt, radarParams, rainField, simulate, drawParams, R, wAt, g,
      truthParams: truthP,
    };
  }

  root.TWIN.engine = { create, DT, K, HOURS, CRIT, HIGH };
})(typeof window !== 'undefined' ? window : globalThis);

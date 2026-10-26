/* Constrained counterfactual interventions.

   Each action is a set of modifiers applied from the decision time onward: it can
   damp a facility's hazard response, weaken specific dependency links, or add load
   elsewhere (side effects, e.g. a detour or an evacuation loading other roads).
   Actions are evaluated by re-simulating the most probable ensemble members under
   the posterior at the decision time, so the comparison uses only information
   available then. Selection under a crew budget is greedy by benefit per crew. */
(function (root) {
  const RALEIGH = [
    {
      id: 'pumps-phu', cost: 2, label: 'Mobile pumps at Pigeon House culvert',
      detail: 'Stage two trailer pumps at the Capital Blvd culvert to draw the branch down ahead of the second band.',
      mods: (e, k) => [fac(e, 'DRN-PHU', k, { scale: 0.55 }), fac(e, 'DRN-PHC', k, { scale: 0.72 })],
      side: null,
    },
    {
      id: 'close-capital', cost: 1, label: 'Close Capital Blvd early, signed detour',
      detail: 'Close the Wake Forest Rd underpass before ponding and route traffic and EMS over Wake Forest Rd.',
      mods: (e, k) => [edge(e, 'DRN-PHC', 'TRF-CWF', k, 0.3), edge(e, 'TRF-CWF', 'EMS-02', k, 0.5),
        fac(e, 'TRF-WFR', k, { add: 0.12 }), fac(e, 'TRF-CPC', k, { add: 0.05 })],
      side: 'Detour adds load on Wake Forest Rd and Capital Blvd at Peace St',
    },
    {
      id: 'stage-ems', cost: 2, label: 'Pre-stage ambulances north of Crabtree Creek',
      detail: 'Move four units to North Hills and Duke Raleigh so responses do not cross flooded crossings.',
      mods: (e, k) => [edge(e, 'TRF-CWF', 'EMS-02', k, 0.35), edge(e, 'TRF-WFR', 'EMS-02', k, 0.35),
        edge(e, 'TRF-SFK', 'EMS-SF', k, 0.35), edge(e, 'TRF-GLN', 'EMS-SF', k, 0.35), edge(e, 'EMS-02', 'HSP-WMR', k, 0.6),
        edge(e, 'HSP-DRH', 'EMS-02', k, 0.7), fac(e, 'EMS-07', k, { add: 0.05 })],
      side: 'Fewer units left south of downtown (Station 7)',
    },
    {
      id: 'gen-wakemed', cost: 2, label: 'Mobile generation and feeder switching at WakeMed',
      detail: 'Bring a 2 MW trailer generator and pre-switch the campus to its alternate feeder.',
      mods: (e, k) => [edge(e, 'PWR-WMR', 'HSP-WMR', k, 0.3), edge(e, 'PWR-EST', 'PWR-WMR', k, 0.6)],
      side: null,
    },
    {
      id: 'barrier-pce', cost: 1, label: 'Flood barriers at Peace St substation',
      detail: 'Deploy inflatable barriers around the substation yard in the Pigeon House floodplain.',
      mods: (e, k) => [edge(e, 'DRN-PHU', 'PWR-PCE', k, 0.25)],
      side: null,
    },
    {
      id: 'evac-crabtree', cost: 2, label: 'Evacuate the Crabtree Valley floodplain',
      detail: 'Clear the mall, Glenwood Ave businesses and low-lying apartments before the creek crests.',
      mods: (e, k) => [edge(e, 'DRN-CTG', 'HSP-REX', k, 0.35),
        fac(e, 'TRF-GLN', k, { add: 0.16 }, 12), fac(e, 'TRF-LBT', k, { add: 0.08 }, 12)],
      side: 'Evacuation traffic on I-440 at Glenwood and Lake Boone for about 6 h',
    },
    {
      id: 'diversion', cost: 1, label: 'Regional load balancing of EMS transports',
      detail: 'Send non-critical transports to WakeMed North and UNC Rex to protect the trauma centers.',
      mods: (e, k) => [edge(e, 'EMS-07', 'HSP-WMR', k, 0.6), edge(e, 'EMS-02', 'HSP-DRH', k, 0.6),
        edge(e, 'HSP-DRH', 'HSP-WMR', k, 0.5), edge(e, 'HSP-WMR', 'HSP-DRH', k, 0.5),
        fac(e, 'HSP-WMN', k, { add: 0.12 }), fac(e, 'HSP-REX', k, { add: 0.06 })],
      side: 'Raises census at WakeMed North and UNC Rex',
    },
  ];

  const CATALOGS = { raleigh: RALEIGH };

  // A catalogue derived from the dependency graph, so any city gets meaningful actions:
  // the facilities that feed the most consequential downstream links get the remedies.
  // Ported from vizsh/72_hours_CASCADE (interventions.js at 9bc9058) with the owner's
  // permission; Nagpur uses it, Raleigh keeps its hand-written catalogue above.
  function generate(e) {
    const F = e.F, kinds = e.kinds, out = [];
    const name = (i) => F[i].name;
    const all = F.map((_, i) => i);
    const linksOf = (i, toKind) => e.outEdges[i].map((n) => e.E[n]).filter((ed) => !toKind || toKind.includes(kinds[ed.to]));
    const inOf = (i, fromKind) => e.inEdges[i].map((n) => e.E[n]).filter((ed) => !fromKind || fromKind.includes(kinds[ed.from]));
    const score = (i) => linksOf(i).reduce((s, ed) => s + ed.w * (4 - F[ed.to].tier), 0);
    const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    // 1. mobile pumps at the two drainage points with the most downstream consequence
    const drains = all.filter((i) => kinds[i] === 'drainage').sort((a, b) => score(b) - score(a));
    for (const i of drains.slice(0, 2)) {
      const downs = linksOf(i, ['drainage']).map((ed) => ed.to);
      out.push({ id: 'pumps-' + slug(F[i].id), cost: 2, label: 'Mobile pumps at ' + name(i),
        detail: 'Stage two trailer pumps to draw ' + (F[i].creek || 'the channel') + ' down before the peak.',
        mods: (en, k) => [fac(en, F[i].id, k, { scale: 0.55 }), ...downs.map((j) => fac(en, F[j].id, k, { scale: 0.8 }))], side: null });
    }
    // 2. early closure of the junction most exposed to flooding, with a signed detour
    const trf = all.filter((i) => kinds[i] === 'traffic' && inOf(i, ['drainage']).length).sort((a, b) => score(b) - score(a));
    if (trf.length) {
      const i = trf[0];
      const floodIn = inOf(i, ['drainage']);
      const emsOut = linksOf(i, ['ems']);
      const nb = linksOf(i, ['traffic']).map((ed) => ed.to).slice(0, 2);
      out.push({ id: 'close-' + slug(F[i].id), cost: 1, label: 'Close ' + name(i) + ' early, signed detour',
        detail: 'Close before ponding and route traffic and ambulances around it, so vehicles are not trapped in water.',
        mods: (en, k) => [...floodIn.map((ed) => edge(en, F[ed.from].id, F[i].id, k, 0.3)), ...emsOut.map((ed) => edge(en, F[i].id, F[ed.to].id, k, 0.5)),
          ...nb.map((j) => fac(en, F[j].id, k, { add: 0.1 }))],
        side: nb.length ? 'Detour adds load at ' + nb.map(name).join(' and ') : null });
    }
    // 3. pre-stage ambulances away from the crossings that will flood
    const ems = all.filter((i) => kinds[i] === 'ems');
    if (ems.length > 1) {
      const routes = ems.flatMap((j) => inOf(j, ['traffic']));
      const spare = ems.slice().sort((a, b) => F[b].tier - F[a].tier)[0];
      out.push({ id: 'stage-ems', cost: 2, label: 'Pre-stage ambulances outside the flood zone',
        detail: 'Move units to high ground near the hospitals so responses do not cross flooded roads.',
        mods: (en, k) => [...routes.map((ed) => edge(en, F[ed.from].id, F[ed.to].id, k, 0.4)), fac(en, F[spare].id, k, { add: 0.05 })],
        side: 'Fewer units left at ' + name(spare) });
    }
    // 4. mobile generation at the hospital most exposed to feeder loss
    const hosp = all.filter((i) => kinds[i] === 'hospital' && inOf(i, ['power']).length)
      .sort((a, b) => F[a].tier - F[b].tier || (F[b].beds || 0) - (F[a].beds || 0));
    if (hosp.length) {
      const i = hosp[0];
      const feeds = inOf(i, ['power']);
      out.push({ id: 'gen-' + slug(F[i].id), cost: 2, label: 'Mobile generation at ' + name(i),
        detail: 'Bring a trailer generator and pre-switch the campus to its alternate feeder.',
        mods: (en, k) => feeds.map((ed) => edge(en, F[ed.from].id, F[i].id, k, 0.3)), side: null });
    }
    // 5. flood barriers at the substation most exposed to water
    const subs = all.filter((i) => kinds[i] === 'power' && inOf(i, ['drainage']).length).sort((a, b) => score(b) - score(a));
    if (subs.length) {
      const i = subs[0];
      const wet = inOf(i, ['drainage']);
      out.push({ id: 'barrier-' + slug(F[i].id), cost: 1, label: 'Flood barriers at ' + name(i),
        detail: 'Deploy inflatable barriers around the substation yard in the floodplain.',
        mods: (en, k) => wet.map((ed) => edge(en, F[ed.from].id, F[i].id, k, 0.25)), side: null });
    }
    // 6. diesel and battery top-up at the mobile sites dispatch depends on
    const tel = all.filter((i) => kinds[i] === 'telecom');
    if (tel.length) {
      const feeds = tel.flatMap((j) => inOf(j, ['power']));
      out.push({ id: 'tel-backup', cost: 1, label: 'Diesel and batteries to mobile sites',
        detail: 'Send fuel trucks and spare battery banks to the sites that carry calls to dispatch.',
        mods: (en, k) => feeds.map((ed) => edge(en, F[ed.from].id, F[ed.to].id, k, 0.35)), side: null });
    }
    // 7. evacuate the floodplain that sends the largest casualty surge
    const surge = all.filter((i) => kinds[i] === 'drainage' && linksOf(i, ['hospital']).length).sort((a, b) => (F[b].people || 0) - (F[a].people || 0));
    if (surge.length) {
      const i = surge[0];
      const toH = linksOf(i, ['hospital']);
      const roads = linksOf(i, ['traffic']).map((ed) => ed.to).slice(0, 2);
      out.push({ id: 'evac-' + slug(F[i].id), cost: 2, label: 'Evacuate the floodplain at ' + F[i].district,
        detail: 'Move about ' + Math.round((F[i].people || 20000) / 1000) + 'k residents out of low-lying blocks before the river crests.',
        mods: (en, k) => [...toH.map((ed) => edge(en, F[i].id, F[ed.to].id, k, 0.35)), ...roads.map((j) => fac(en, F[j].id, k, { add: 0.16 }, 12))],
        side: roads.length ? 'Evacuation traffic at ' + roads.map(name).join(' and ') + ' for about 6 h' : null });
    }
    // 8. regional load balancing between hospitals
    const hh = e.E.filter((ed) => kinds[ed.from] === 'hospital' && kinds[ed.to] === 'hospital');
    if (hh.length) {
      const small = all.filter((i) => kinds[i] === 'hospital').sort((a, b) => (F[a].beds || 999) - (F[b].beds || 999))[0];
      out.push({ id: 'diversion', cost: 1, label: 'Regional load balancing of transports',
        detail: 'Send non-critical transports to smaller hospitals to protect the trauma centre.',
        mods: (en, k) => [...hh.map((ed) => edge(en, F[ed.from].id, F[ed.to].id, k, 0.5)), fac(en, F[small].id, k, { add: 0.1 })],
        side: 'Raises census at ' + name(small) });
    }
    return out;
  }

  function fac(e, id, k, o, dur) { return { kind: 'fac', i: e.idx[id], from: k, to: dur ? k + dur : null, ...o }; }
  function edge(e, from, to, k, scale) {
    const n = e.E.findIndex((x) => x.from === e.idx[from] && x.to === e.idx[to]);
    return { kind: 'edge', e: n, from: k, scale };
  }

  function create(engine) {
    const { M, N, K, DT, F, CRIT } = { ...engine, CRIT: root.TWIN.engine.CRIT };
    const CATALOG = CATALOGS[engine.geo.id] || generate(engine);
    const tierW = F.map((f) => (f.type === 'weather' ? 0 : 4 - f.tier));

    // Storm-level posterior at step k: mean of the local weights over facilities.
    function topMembers(k, n) {
      const wbar = new Float64Array(M);
      for (let i = 0; i < N; i++) { const w = engine.wAt(k, i); for (let m = 0; m < M; m++) wbar[m] += w[m] / N; }
      const order = Array.from({ length: M }, (_, m) => m).sort((a, b) => wbar[b] - wbar[a]).slice(0, n);
      const s = order.reduce((acc, m) => acc + wbar[m], 0);
      return order.map((m) => ({ m, w: wbar[m] / s }));
    }

    const isCare = F.map((f) => f.type === 'hospital');
    function metrics(getR, k) {
      let critHours = 0, careHours = 0, nCrit = 0, hospPeak = 0;
      const peaks = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        if (!tierW[i]) continue;
        let reached = false, pk = 0;
        for (let kk = k; kk < K; kk++) {
          const r = getR(kk, i);
          if (r > pk) pk = r;
          if (r >= CRIT) { critHours += tierW[i] * DT; if (isCare[i]) careHours += DT; reached = true; }
        }
        peaks[i] = pk;
        if (reached) nCrit++;
        if (F[i].type === 'hospital' && F[i].subtype !== 'EMS station') hospPeak = Math.max(hospPeak, pk);
      }
      return { critHours, careHours, nCrit, hospPeak, hospCrit: hospPeak >= CRIT ? 1 : 0, peaks };
    }

    const buf = new Float32Array(K * N);
    // What the chosen actions do to the simulation, as applied from step kStart.
    const modsFor = (ids, kStart) => CATALOG.filter((a) => ids.includes(a.id))
      .flatMap((a) => a.mods(engine, kStart)).filter((m) => m.kind !== 'edge' || m.e >= 0);

    // Decide at step k on what was known then; crews start at kStart (k: straight away).
    function evaluate(k, ids, nMembers = 32, kStart = k) {
      const acts = CATALOG.filter((a) => ids.includes(a.id));
      const mods = modsFor(ids, kStart);
      const blank = () => ({ critHours: 0, careHours: 0, nCrit: 0, hospPeak: 0, hospCrit: 0, peaks: new Float32Array(N) });
      const base = blank(), withA = blank();
      for (const { m, w } of topMembers(k, nMembers)) {
        const b = metrics((kk, i) => engine.R(m, kk, i), k);
        let a = b;
        if (mods.length) {
          engine.simulate(engine.members[m], buf, 1000 + m, mods, null, { k0: Math.min(K - 1, kStart), from: engine.traj.subarray(m * K * N, (m + 1) * K * N) });
          a = metrics((kk, i) => buf[kk * N + i], k);
        }
        for (const [acc, x] of [[base, b], [withA, a]]) {
          acc.critHours += w * x.critHours; acc.careHours += w * x.careHours; acc.nCrit += w * x.nCrit; acc.hospPeak += w * x.hospPeak; acc.hospCrit += w * x.hospCrit;
          for (let i = 0; i < N; i++) acc.peaks[i] += w * x.peaks[i];
        }
      }
      const worse = [];
      for (let i = 0; i < N; i++) if (withA.peaks[i] - base.peaks[i] > 0.03) worse.push({ i, delta: withA.peaks[i] - base.peaks[i] });
      worse.sort((a, b) => b.delta - a.delta);
      return {
        base, with: withA, cost: acts.reduce((s, a) => s + a.cost, 0),
        reduction: base.critHours > 0 ? 1 - withA.critHours / base.critHours : 0,
        careReduction: base.careHours > 0 ? 1 - withA.careHours / base.careHours : 0,
        cascadeBroken: base.hospCrit > 0.4 && withA.hospCrit < 0.3,
        sideEffects: worse.slice(0, 5),
      };
    }

    // Greedy selection by marginal reduction of expected critical facility-hours per crew.
    // A generator that pauses after each evaluation, so a page can spread the search over
    // frames (recommendAsync); recommend() runs it straight through.
    function* search(k, budget) {
      let chosen = [], spent = 0;
      let current = evaluate(k, [], 16).with.critHours;
      for (;;) {
        let best = null;
        for (const a of CATALOG) {
          if (chosen.includes(a.id) || spent + a.cost > budget) continue;
          yield chosen;
          const v = evaluate(k, [...chosen, a.id], 16).with.critHours;
          const gain = (current - v) / a.cost;
          if (gain > 0.05 && (!best || gain > best.gain)) best = { id: a.id, gain, v, cost: a.cost };
        }
        if (!best) break;
        chosen.push(best.id); spent += best.cost; current = best.v;
      }
      return chosen;
    }
    function recommend(k, budget) {
      const it = search(k, budget);
      let r;
      while (!(r = it.next()).done);
      return r.value;
    }
    async function recommendAsync(k, budget) {
      const it = search(k, budget);
      let r;
      while (!(r = it.next()).done) await new Promise((res) => setTimeout(res, 0));
      return r.value;
    }

    // How much of the plan's benefit survives starting later. The decision is still
    // taken at k with information up to k; only the crews start late, so this answers
    // "by when must we move", not "what will we know later".
    function deadline(k, ids, maxH = 24, stepH = 2) {
      const pts = [];
      for (let h = 0; h <= maxH; h += stepH) {
        const ks = k + Math.round(h / DT);
        if (ks >= K - 1) break;
        const r = evaluate(k, ids, 16, ks);
        pts.push({ h, reduction: r.reduction, critHours: r.with.critHours, base: r.base.critHours });
      }
      const r0 = pts.length ? pts[0].reduction : 0;
      let actBy = null, half = null;
      if (r0 > 0.02) for (const p of pts) {
        if (p.reduction >= 0.8 * r0) actBy = p.h;              // last start keeping 80%
        if (half == null && p.reduction < 0.5 * r0) half = p.h; // first start worth under half
      }
      return { pts, r0, actBy, half };
    }

    // Weighted mean risk with the plan minus without it, per facility and step after k:
    // what the twin adds to its own view to show the city as the plan would leave it.
    // `base` and `plan` are the same weighted means before subtraction, so a caller can
    // chart the two futures side by side instead of only their difference. `nAt` counts
    // the expected facilities at or above a level at each step, on the same weighting.
    function trajectory(k, ids, nMembers = 24) {
      const mods = modsFor(ids, k);
      const delta = new Float32Array(K * N), base = new Float32Array(K * N), plan = new Float32Array(K * N);
      const nBase = new Float32Array(K), nPlan = new Float32Array(K);
      for (const { m, w } of topMembers(k, nMembers)) {
        const tr = engine.traj.subarray(m * K * N, (m + 1) * K * N);
        if (mods.length) engine.simulate(engine.members[m], buf, 1000 + m, mods, null, { k0: k, from: tr });
        for (let kk = k; kk < K; kk++) {
          let cb = 0, cp = 0;
          for (let i = 0; i < N; i++) {
            const q = kk * N + i;
            const a = tr[q], b = mods.length ? buf[q] : a;
            base[q] += w * a; plan[q] += w * b; delta[q] += w * (b - a);
            if (tierW[i] > 0) { if (a >= CRIT) cb++; if (b >= CRIT) cp++; }
          }
          nBase[kk] += w * cb; nPlan[kk] += w * cp;
        }
      }
      return { k0: k, delta, base, plan, nBase, nPlan };
    }

    return { CATALOG, evaluate, recommend, recommendAsync, deadline, trajectory };
  }

  root.TWIN.interventions = { CATALOGS, generate, create };
})(typeof window !== 'undefined' ? window : globalThis);

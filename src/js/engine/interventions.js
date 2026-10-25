/* Constrained counterfactual interventions.

   Each action is a set of modifiers applied from the decision time onward: it can
   damp a facility's hazard response, weaken specific dependency links, or add load
   elsewhere (side effects, e.g. a detour or an evacuation loading other roads).
   Actions are evaluated by re-simulating the most probable ensemble members under
   the posterior at the decision time, so the comparison uses only information
   available then. Selection under a crew budget is greedy by benefit per crew. */
(function (root) {
  const CATALOG = [
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

  function fac(e, id, k, o, dur) { return { kind: 'fac', i: e.idx[id], from: k, to: dur ? k + dur : null, ...o }; }
  function edge(e, from, to, k, scale) {
    const n = e.E.findIndex((x) => x.from === e.idx[from] && x.to === e.idx[to]);
    return { kind: 'edge', e: n, from: k, scale };
  }

  function create(engine) {
    const { M, N, K, DT, F, CRIT } = { ...engine, CRIT: root.TWIN.engine.CRIT };
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
    function evaluate(k, ids, nMembers = 32) {
      const acts = CATALOG.filter((a) => ids.includes(a.id));
      const mods = acts.flatMap((a) => a.mods(engine, k)).filter((m) => m.kind !== 'edge' || m.e >= 0);
      const blank = () => ({ critHours: 0, careHours: 0, nCrit: 0, hospPeak: 0, hospCrit: 0, peaks: new Float32Array(N) });
      const base = blank(), withA = blank();
      for (const { m, w } of topMembers(k, nMembers)) {
        const b = metrics((kk, i) => engine.R(m, kk, i), k);
        let a = b;
        if (mods.length) {
          engine.simulate(engine.members[m], buf, 1000 + m, mods, null, { k0: k, from: engine.traj.subarray(m * K * N, (m + 1) * K * N) });
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
    function recommend(k, budget) {
      let chosen = [], spent = 0;
      let current = evaluate(k, [], 16).with.critHours;
      for (;;) {
        let best = null;
        for (const a of CATALOG) {
          if (chosen.includes(a.id) || spent + a.cost > budget) continue;
          const v = evaluate(k, [...chosen, a.id], 16).with.critHours;
          const gain = (current - v) / a.cost;
          if (gain > 0.05 && (!best || gain > best.gain)) best = { id: a.id, gain, v, cost: a.cost };
        }
        if (!best) break;
        chosen.push(best.id); spent += best.cost; current = best.v;
      }
      return chosen;
    }

    return { CATALOG, evaluate, recommend };
  }

  root.TWIN.interventions = { CATALOG, create };
})(typeof window !== 'undefined' ? window : globalThis);

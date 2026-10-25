/* City-level analytics on top of the engine: Cascade-R and crisis identification.

   Cascade-R compares the stress that reaches facilities through dependency links with
   the stress the hazard puts on them directly. Below 1 the city is reacting to the
   hazard; above 1 more stress is travelling through the network than arriving from
   outside, so the cascade is feeding itself.

   Crises are the connected components of stressed facilities over the learned
   dependency graph at the issue time. Two facilities join the same crisis when stress
   is flowing between them now, or when the downstream one is forecast to be hit. Each
   crisis gets a stable ID, a type from its root cause, a lifecycle stage, a footprint,
   the people exposed and the systems it reaches. Links between crises show coupling
   (one could propagate into another) and contention (both load the same facility).

   Ported from vizsh/72_hours_CASCADE (src/js/engine/analytics.js at 9bc9058) with the
   owner's permission. Local change: without a population layer, people exposed is null
   (not modeled) rather than 0. */
(function (root) {
  const C = root.TWIN.core;
  const { clamp } = C;
  const SYS_LABEL = { weather: 'Weather', drainage: 'Drainage', traffic: 'Roads', power: 'Power', telecom: 'Telecom', ems: 'EMS', hospital: 'Hospitals' };
  const SYS_ORDER = ['drainage', 'traffic', 'power', 'telecom', 'ems', 'hospital'];
  const group = (kind) => (kind === 'pump' ? 'drainage' : kind);

  function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  // Hazard family of a crisis: the first system in the scenario's priority order that the
  // crisis involves. A flood that also jams roads and loads hospitals is still a flood; the
  // same jam caused by a chlorine plume is a toxic release.
  const PRIORITY = {
    rain: [['drainage', 'flood'], ['power', 'grid'], ['telecom', 'comms'], ['traffic', 'gridlock'], ['ems', 'health'], ['hospital', 'health']],
    heat: [['power', 'grid'], ['hospital', 'health'], ['telecom', 'comms'], ['drainage', 'flood'], ['traffic', 'gridlock'], ['ems', 'health']],
    blackout: [['power', 'grid'], ['telecom', 'comms'], ['drainage', 'flood'], ['traffic', 'gridlock'], ['ems', 'health'], ['hospital', 'health']],
    chlorine: [['traffic', 'toxic'], ['ems', 'toxic'], ['hospital', 'toxic'], ['power', 'grid'], ['telecom', 'comms'], ['drainage', 'flood']],
    festival: [['traffic', 'crowd'], ['ems', 'crowd'], ['drainage', 'flood'], ['power', 'grid'], ['telecom', 'comms'], ['hospital', 'health']],
  };
  function familyOf(e, members) {
    const order = PRIORITY[e.scen.id] || PRIORITY.rain;
    for (const [sys, fam] of order) {
      const hit = members.find((i) => group(e.kinds[i]) === sys);
      if (hit != null) return { family: fam, anchor: hit };
    }
    return { family: 'health', anchor: members[0] };
  }
  const FAMILY_LABEL = {
    flood: 'Urban flood', grid: 'Grid outage', comms: 'Communications loss', toxic: 'Toxic release',
    crowd: 'Crowd surge', gridlock: 'Mobility gridlock', health: 'Health system surge',
  };

  function create(e, opts = {}) {
    const N = e.N, F = e.F;
    const code = (e.geo.city || 'CTY').slice(0, 3).toUpperCase();
    const hasPeople = !!opts.peopleFor || F.some((f) => f.people != null);
    const cacheR = new Map(), cacheC = new Map();

    // Cascade-R at step kView with information up to k (kView > k: forecast, from the
    // projected state and the members' forecast forcing; dependency weights as of k).
    function cascadeR(k, kView = k) {
      const key = k + '|' + kView;
      if (cacheR.has(key)) return cacheR.get(key);
      let net = 0, haz = 0;
      const bySys = {};
      const proj = new Map();
      const Rat = (kk) => {
        if (kk <= k) return e.now.subarray(kk * N, (kk + 1) * N);
        if (!proj.has(kk)) proj.set(kk, e.project(k, kk));
        return proj.get(kk);
      };
      const eps = kView > k ? e.edgesAt(k) : null;
      for (let i = 0; i < N; i++) {
        if (e.kinds[i] === 'weather') continue;
        const s = (bySys[group(e.kinds[i])] ||= { net: 0, haz: 0 });
        let n = 0, h = 0;
        if (kView <= k) {
          for (const d of e.explain(k, i).drivers) {
            if (d.kind === 'edge') n += Math.max(0, d.value);
            else if (d.kind === 'hazard') h += Math.max(0, d.value);
          }
        } else {
          h = Math.max(0, e.forcingEstimate(k, i, kView).forcing);
          const w = e.wAt(k, i);
          for (const q of e.inEdges[i]) {
            const ed = e.E[q];
            // Link weight: the learned posterior once it has evidence, otherwise the
            // evidence-weighted mean of the members' weights (what the forecast itself uses).
            let wt = eps[q].mean;
            if (eps[q].learned < 0.5) { wt = 0; for (let m = 0; m < e.M; m++) wt += w[m] * e.members[m].ew[q]; }
            n += Math.max(0, wt * e.g(Rat(Math.max(0, kView - ed.lag))[ed.from], ed.from));
          }
        }
        net += n; haz += h; s.net += n; s.haz += h;
      }
      const out = { r: clamp(net / (haz + 0.05), 0, 9), net, haz, bySys, forecast: kView > k };
      cacheR.set(key, out);
      return out;
    }

    function crises(k) {
      if (cacheC.has(k)) return cacheC.get(k);
      const seq = e.cascade(k);
      const first = new Map(), crit = new Map();
      for (const c of seq) {
        if (c.level === 'HIGH RISK' && !first.has(c.i)) {
          const live = c.observed ? e.now[k * N + c.i] >= 0.35 : c.prob >= 0.5 && c.t - k * e.DT <= 24;
          if (live) first.set(c.i, c);
        }
        if (c.level === 'CRITICAL' && !crit.has(c.i)) crit.set(c.i, c);
      }
      const stressed = [...first.keys()];
      const inSet = new Set(stressed);
      const parent = new Map(stressed.map((i) => [i, i]));
      const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
      const eps = e.edgesAt(k);
      const live = (ep) => ep.status !== 'pruned' && ep.mean >= 0.06;
      for (const ep of eps) {
        if (ep.status === 'pruned') continue;
        const ed = e.E[ep.e];
        if (!inSet.has(ed.from) || !inSet.has(ed.to)) continue;
        // Observed stress flowing along a learned link, or a link the forecast ensemble
        // carries (candidate links keep their prior weight in the members) into a
        // facility forecast to be hit after its upstream.
        const a = first.get(ed.from), b = first.get(ed.to);
        const flowing = live(ep) && ep.flow >= 0.02;
        const forecast = !b.observed && a.t <= b.t + 0.5 && e.E[ep.e].hi > 0.05;
        if (flowing || forecast) parent.set(find(ed.from), find(ed.to));
      }
      const comps = new Map();
      for (const i of stressed) { const r = find(i); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(i); }
      let list = [];
      for (const members of comps.values()) {
        members.sort((a, b) => first.get(a).t - first.get(b).t);
        const { family, anchor } = familyOf(e, members);
        // Root: earliest member in the crisis's own system (where the hazard entered).
        const rootIdx = members.find((i) => group(e.kinds[i]) === group(e.kinds[anchor])) ?? members[0];
        const R = members.map((i) => e.now[k * N + i]);
        const maxR = Math.max(...R);
        const forecastOnly = members.filter((i) => !first.get(i).observed);
        const anyObserved = forecastOnly.length < members.length;
        const kPrev = Math.max(0, k - 4);
        const trend = members.reduce((s, i) => s + e.now[k * N + i] - e.now[kPrev * N + i], 0) / members.length;
        let stage;
        if (!anyObserved) stage = 'Precursor';
        else if (trend < -0.02 && !forecastOnly.length) stage = 'Recovering';
        else if (trend > 0.025 || forecastOnly.length) stage = maxR >= 0.75 ? 'Escalating' : 'Emerging';
        else stage = maxR >= 0.75 ? 'Active' : 'Emerging';
        const nextCrit = members.map((i) => crit.get(i)).filter((c) => c && !c.observed).sort((a, b) => a.t - b.t)[0] || null;
        const sys = {};
        for (const i of members) { const g = group(e.kinds[i]); sys[g] = Math.max(sys[g] || 0, e.now[k * N + i]); }
        const districts = [...new Set(members.map((i) => F[i].district))];
        const set = new Set(members);
        const people = opts.peopleFor ? opts.peopleFor(set) : hasPeople ? members.reduce((s, i) => s + (F[i].people || 0) * 0.5, 0) : null;
        const id = `CR-${code}-${1000 + (hash(e.scen.id + F[rootIdx].id) % 9000)}`;
        list.push({
          id, family, type: FAMILY_LABEL[family], stage, root: rootIdx, members, set, maxR, sys, districts, people, nextCrit,
          since: first.get(rootIdx).t, observed: anyObserved, nCrit: R.filter((r) => r >= 0.75).length,
        });
      }
      list.sort((a, b) => b.maxR - a.maxR || (b.people || 0) - (a.people || 0));
      // Interactions between crises.
      const owner = new Map();
      list.forEach((c, n) => c.members.forEach((i) => owner.set(i, n)));
      const coupled = new Map(), loads = new Map();
      for (const ep of eps) {
        if (!live(ep)) continue;
        const ed = e.E[ep.e];
        const a = owner.get(ed.from), b = owner.get(ed.to);
        if (a != null && b != null && a !== b) {
          const key = a + '>' + b;
          if (!coupled.has(key) || coupled.get(key).mean < ep.mean) coupled.set(key, { from: a, to: b, kind: 'couples', edge: ep.e, mean: ep.mean, lag: ed.lag * e.DT });
        }
        if (a != null && b == null && e.kinds[ed.to] !== 'weather') {
          if (!loads.has(ed.to)) loads.set(ed.to, new Map());
          const m = loads.get(ed.to);
          m.set(a, Math.max(m.get(a) || 0, ep.mean));
        }
      }
      const links = [...coupled.values()];
      for (const [fac, m] of loads) if (m.size > 1) {
        const arr = [...m.keys()].sort((x, y) => x - y);
        for (let x = 0; x < arr.length; x++) for (let y = x + 1; y < arr.length; y++) links.push({ from: arr[x], to: arr[y], kind: 'contends', fac, load: m.get(arr[x]) + m.get(arr[y]) });
      }
      const systems = SYS_ORDER.filter((g) => e.kinds.some((kd) => group(kd) === g));
      const res = { list, links, systems };
      cacheC.set(k, res);
      return res;
    }

    // First forecast time at which Cascade-R reaches 1 (the cascade becomes self-sustaining),
    // scanned hourly from the issue step; null if it does not within the horizon.
    const crossCache = new Map();
    function crossing(k) {
      if (crossCache.has(k)) return crossCache.get(k);
      let out = null;
      if (cascadeR(k).r >= 1) out = { t: k * e.DT, now: true };
      else for (let kk = k + 2; kk < e.K; kk += 2) if (cascadeR(k, kk).r >= 1) { out = { t: kk * e.DT, now: false }; break; }
      crossCache.set(k, out);
      return out;
    }

    return { cascadeR, crises, crossing };
  }

  root.TWIN.analytics = { create, SYS_LABEL, FAMILY_LABEL, familyOf, group };
})(typeof window !== 'undefined' ? window : globalThis);

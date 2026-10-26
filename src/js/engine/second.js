/* A second opinion on the ensemble, from a pretrained time-series model.

   Chronos-Bolt (amazon/chronos-bolt-small) was pretrained on public time series and has
   never been trained on these cities. Offline, tools/ml/chronos_forecast.py gave it each
   facility's sensor stream as observed up to every hourly issue time (noise, frozen
   gauges and dropouts included, nothing after the issue time) and kept its probability
   of CRITICAL within 6, 12 and 24 h (src/js/data/chronos.js).

   Here that probability is set beside the ensemble's, and both are scored by the same
   code on the same issue times and facilities against the scenario's hidden truth. The
   ensemble's probability is recomputed exactly as engine.validation() computes it, so
   this module reads the engine and changes nothing in it. */
(function (root) {
  const H = [6, 12, 24];
  const WARN = 0.6; // the alert feed's rule: warn at P(CRITICAL within 24 h) >= 60%

  function create(e) {
    const data = root.TWIN_ML && root.TWIN_ML.chronos;
    const run = data && data.runs[e.geo.id + '|' + e.scen.id];
    if (!run) return null;
    const { K, N, M, DT } = e;
    const CRIT = root.TWIN.engine.CRIT;
    const col = new Map(run.ids.map((id, n) => [e.idx[id], n]));
    const W = run.ids.length;
    const facilities = [...col.keys()];

    // Chronos: the latest hourly issue at or before step k.
    function ml(k, i, h = 24) {
      const c = col.get(i);
      const n = Math.min(Math.floor((k - run.k0) / run.step), run.nk - 1);
      if (c == null || n < 0) return null;
      return run['p' + h][n * W + c] / 100;
    }
    // Ensemble: weighted share of members that reach CRITICAL in (k, k + h], as in
    // engine.validation(). First crossings per member are kept per (k, i).
    const memo = new Map();
    function firsts(k, i) {
      const key = k * N + i;
      let f = memo.get(key);
      if (!f) {
        f = new Float32Array(M).fill(Infinity);
        const last = Math.min(K - 1, k + 24 / DT);
        for (let m = 0; m < M; m++) for (let kk = k + 1; kk <= last; kk++) if (e.R(m, kk, i) >= CRIT) { f[m] = kk - k; break; }
        memo.set(key, f);
      }
      return f;
    }
    function ens(k, i, h = 24) {
      const f = firsts(k, i), w = e.wAt(k, i);
      let p = 0;
      for (let m = 0; m < M; m++) if (f[m] <= h / DT) p += w[m];
      return p;
    }

    // Brier score, skill against climatology, and the 24 h warning rule's detection,
    // false alarms and lead, for a forecast p(k, i, h). opts.from / opts.every set the
    // issue steps; the defaults are the hourly issues Chronos has.
    function score(p, opts = {}) {
      const from = opts.from != null ? opts.from : run.k0, every = opts.every || run.step;
      const outcomes = [];
      for (let k = from; k < K; k += 2) for (const i of facilities) for (const hh of H) {
        const k1 = k + hh / DT;
        if (k1 >= K) continue;
        let o = 0;
        for (let kk = k + 1; kk <= k1; kk++) if (e.truth[kk * N + i] >= CRIT) { o = 1; break; }
        outcomes.push([p(k, i, hh), o]);
      }
      const base = outcomes.reduce((s, x) => s + x[1], 0) / outcomes.length;
      let bs = 0, cs = 0;
      for (const [pp, o] of outcomes) { bs += (pp - o) ** 2; cs += (base - o) ** 2; }
      const brier = bs / outcomes.length, bss = cs > 0 ? 1 - bs / cs : null;
      let alarms = 0, falseAlarms = 0, events = 0, hits = 0;
      const leads = [];
      for (const i of facilities) {
        let tc = -1;
        for (let k = 0; k < K; k++) if (e.truth[k * N + i] >= CRIT) { tc = k; break; }
        let warn = -1;
        for (let k = from; k < K; k += every) if (p(k, i, 24) >= WARN) { warn = k; break; }
        if (warn >= 0) { alarms++; if (tc < 0 || tc > warn + 24 / DT + 12) falseAlarms++; }
        if (tc >= 0) { events++; if (warn >= 0 && warn <= tc) { hits++; leads.push((tc - warn) * DT); } }
      }
      leads.sort((a, b) => a - b);
      return {
        brier, bss, cases: outcomes.length, events, hits, alarms, falseAlarms,
        pod: events ? hits / events : null, far: alarms ? falseAlarms / alarms : null,
        medianLead: leads.length ? leads[Math.floor(leads.length / 2)] : null,
      };
    }
    let cmp = null;
    const compare = () => cmp || (cmp = { ens: score(ens), ml: score(ml) });

    // Where the two disagree at issue step k: P(CRITICAL within 24 h) apart by at least
    // `gap`, largest gap first.
    function disagreements(k, gap = 0.35) {
      const out = [];
      for (const i of facilities) {
        const a = ens(k, i), b = ml(k, i);
        if (b != null && Math.abs(a - b) >= gap) out.push({ i, ens: a, ml: b });
      }
      return out.sort((x, y) => Math.abs(y.ens - y.ml) - Math.abs(x.ens - x.ml));
    }
    // How many facilities each puts at 50% or more of CRITICAL within 24 h.
    function likely(k) {
      let a = 0, b = 0, both = 0;
      for (const i of facilities) {
        const x = ens(k, i) >= 0.5, y = (ml(k, i) || 0) >= 0.5;
        a += x; b += y; both += x && y;
      }
      return { ens: a, ml: b, both };
    }

    return { model: data.model, method: data.method, ml, ens, score, compare, disagreements, likely, from: run.k0 * DT };
  }

  root.TWIN.second = { create };
})(typeof window !== 'undefined' ? window : globalThis);

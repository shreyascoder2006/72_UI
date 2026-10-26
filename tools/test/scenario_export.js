// Runs every city × scenario and writes the dataset the spreadsheet is built from.
// Everything here is engine output at the scenario's own issue time; nothing is copied
// from the scenario's description.
//   node tools/test/scenario_export.js out.json
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../..'); global.window = global;
for (const f of ['data/geodata', 'data/geodata_nagpur', 'core', 'engine/scenarios', 'engine/scenarios_natural',
                 'engine/engine', 'engine/interventions', 'engine/analytics'])
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src/js', f + '.js'), 'utf8'), { filename: f });
const T = window.TWIN;
const SYS = ['drainage', 'traffic', 'power', 'telecom', 'ems', 'hospital'];
const group = (k) => (k === 'pump' ? 'drainage' : k);
const out = { scenarios: [], outcomes: [], sequence: [], params: [] };

// ── The catalogue, as declared ──────────────────────────────────────────────
for (const s of Object.values(T.scenarios)) {
  out.scenarios.push({
    id: s.id, label: s.label, cities: s.cities ? s.cities.join(' + ') : 'both',
    set: (T.naturalScenarios || []).includes(s.id) ? 'natural calamity (added)' : 'original catalogue',
    provenance: s.provenance.label, heading_deg: s.heading ?? '', default_now_h: s.liveNow ?? 34.5,
    has_extra: !!s.extra, blurb: s.blurb,
  });
  // The hidden truth: the single parameter set the forecast is scored against.
  const truth = s.sample(Math.random, true);
  for (const [k, v] of Object.entries(truth)) out.params.push({ id: s.id, label: s.label, parameter: k, truth_value: typeof v === 'number' ? +v.toFixed(4) : v });
}

// ── What the engine actually does with each one ─────────────────────────────
for (const city of ['raleigh', 'nagpur']) {
  const geo = window.TWIN_GEOS[city];
  for (const scen of Object.values(T.scenarios)) {
    if (scen.cities && !scen.cities.includes(city)) continue;
    const e = T.engine.create(geo, { scenario: scen.id });
    const an = T.analytics.create ? T.analytics.create(e) : e.analytics;
    const nowT = scen.liveNow || 34.5, k = e.kOf(nowT);
    const peak = {}, firstCrit = {}, nCrit = {};
    for (let i = 0; i < e.N; i++) {
      if (e.kinds[i] === 'weather') continue;
      const g = group(e.kinds[i]);
      let hit = false;
      for (let kk = 0; kk < e.K; kk++) {
        const v = e.now[kk * e.N + i];
        if (v > (peak[g] || 0)) peak[g] = v;
        if (v >= 0.75) { if (firstCrit[g] == null) firstCrit[g] = kk * e.DT; hit = true; }
      }
      if (hit) nCrit[g] = (nCrit[g] || 0) + 1;
    }
    const cr = an.cascadeR(k), reg = an.crises(k);
    const seq = e.cascade(k).filter((x) => x.level === 'CRITICAL').sort((a, b) => a.t - b.t);
    const p = T.interventions.create(e);
    const ids = p.recommend(k, 5);
    const r = ids.length ? p.evaluate(k, ids) : null;
    const d = ids.length ? p.deadline(k, ids) : null;
    const dom = SYS.filter((x) => peak[x] != null).sort((a, b) => peak[b] - peak[a])[0] || '';
    const order = SYS.filter((x) => firstCrit[x] != null).sort((a, b) => firstCrit[a] - firstCrit[b]);

    out.outcomes.push({
      city, id: scen.id, label: scen.label,
      set: (T.naturalScenarios || []).includes(scen.id) ? 'natural' : 'original',
      issue_time_h: nowT, facilities: e.N - e.kinds.filter((x) => x === 'weather').length,
      cascade_R: +cr.r.toFixed(3),
      self_sustaining: cr.r >= 1 ? 'yes' : 'no',
      crises: reg.list.length, learned_links_live: reg.links.length,
      critical_crossings: seq.length,
      first_crossing_h: seq.length ? +seq[0].t.toFixed(1) : '',
      last_crossing_h: seq.length ? +seq[seq.length - 1].t.toFixed(1) : '',
      first_system: order[0] || '', dominant_system: dom,
      system_order: order.join(' → '),
      ...Object.fromEntries(SYS.map((x) => [`peak_${x}`, peak[x] != null ? +peak[x].toFixed(3) : ''])),
      ...Object.fromEntries(SYS.map((x) => [`first_crit_${x}_h`, firstCrit[x] != null ? +firstCrit[x].toFixed(1) : ''])),
      ...Object.fromEntries(SYS.map((x) => [`n_critical_${x}`, nCrit[x] || 0])),
      baseline_critical_facility_hours: r ? +r.base.critHours.toFixed(1) : 0,
      baseline_hosp_ems_hours: r ? +r.base.careHours.toFixed(1) : 0,
      p_hospital_critical: r ? +r.base.hospCrit.toFixed(3) : '',
      recommended_plan: ids.join(' + ') || '(none helps)',
      plan_crews: r ? r.cost : 0,
      plan_reduction_pct: r ? +(r.reduction * 100).toFixed(1) : 0,
      cascade_broken: r ? (r.cascadeBroken ? 'yes' : 'no') : '',
      act_by_h_after_issue: d && d.actBy != null ? d.actBy : '',
      half_value_h: d && d.half != null ? d.half : '',
    });

    // The chain, as a row per crossing, for the scenarios that have one.
    seq.slice(0, 24).forEach((x, n) => out.sequence.push({
      city, id: scen.id, step: n + 1, hour: +x.t.toFixed(1),
      facility: e.F[x.i].name, system: group(e.kinds[x.i]),
      status: x.observed ? 'observed' : 'forecast',
      probability: x.observed ? 1 : +x.prob.toFixed(2),
    }));
    process.stderr.write(`  ${city}/${scen.id}\n`);
  }
}
fs.writeFileSync(process.argv[2], JSON.stringify(out));
console.log(`scenarios ${out.scenarios.length} · outcomes ${out.outcomes.length} · sequence rows ${out.sequence.length} · parameters ${out.params.length}`);

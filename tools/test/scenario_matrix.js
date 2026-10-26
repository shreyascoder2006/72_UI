// Every scenario, run through the engine, reduced to the signature a dashboard shows.
// Two scenarios with the same signature would look the same on screen, which is the
// one failure mode a catalogue this size can have.
//   node tools/test/scenario_matrix.js [--json out.json]
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../..'); global.window = global;
for (const f of ['data/geodata', 'data/geodata_nagpur', 'core', 'engine/scenarios', 'engine/scenarios_natural',
                 'engine/engine', 'engine/interventions', 'engine/analytics'])
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src/js', f + '.js'), 'utf8'), { filename: f });
const T = window.TWIN;
const SYS = ['drainage', 'traffic', 'power', 'telecom', 'ems', 'hospital'];
const group = (k) => (k === 'pump' ? 'drainage' : k);
const rows = [];

for (const city of ['raleigh', 'nagpur']) {
  const geo = window.TWIN_GEOS[city];
  for (const scen of Object.values(T.scenarios)) {
    if (scen.cities && !scen.cities.includes(city)) continue;
    const t0 = Date.now();
    const e = T.engine.create(geo, { scenario: scen.id });
    const an = T.analytics.create ? T.analytics.create(e) : e.analytics;
    const nowT = scen.liveNow || 34.5;
    const k = e.kOf(nowT);

    // Worst expected peak per system over the whole window, and when it first crosses.
    const peak = {}, firstCrit = {};
    for (let i = 0; i < e.N; i++) {
      if (e.kinds[i] === 'weather') continue;
      const g = group(e.kinds[i]);
      for (let kk = 0; kk < e.K; kk++) {
        const v = e.now[kk * e.N + i];
        if (v > (peak[g] || 0)) peak[g] = v;
        if (v >= 0.75 && firstCrit[g] == null) firstCrit[g] = kk * e.DT;
      }
    }
    const dom = SYS.filter((s) => peak[s] != null).sort((a, b) => peak[b] - peak[a])[0] || '—';
    const cr = an.cascadeR(k);
    const reg = an.crises(k);
    const seq = e.cascade(k).filter((s) => s.level === 'CRITICAL');
    const p = T.interventions.create(e);
    const ids = p.recommend(k, 5);
    const r = ids.length ? p.evaluate(k, ids) : null;
    const d = ids.length ? p.deadline(k, ids) : null;

    rows.push({
      city, id: scen.id, label: scen.label,
      natural: (T.naturalScenarios || []).includes(scen.id),
      nowT, dominant: dom,
      peak: Object.fromEntries(SYS.map((s) => [s, +(peak[s] || 0).toFixed(3)])),
      firstCrit: Object.fromEntries(SYS.map((s) => [s, firstCrit[s] ?? null])),
      cascadeR: +cr.r.toFixed(3),
      crises: reg.list.length,
      links: reg.links.length,
      crossings: seq.length,
      firstCrossing: seq.length ? +seq[0].t.toFixed(1) : null,
      critHours: r ? +r.base.critHours.toFixed(1) : 0,
      plan: ids.join(','), planCost: r ? r.cost : 0,
      reduction: r ? +r.reduction.toFixed(3) : 0,
      actBy: d ? d.actBy : null,
      ms: Date.now() - t0,
    });
    const last = rows[rows.length - 1];
    console.log(`${city.padEnd(8)} ${scen.id.padEnd(15)} dom=${last.dominant.padEnd(9)} R=${String(last.cascadeR).padEnd(6)} crises=${String(last.crises).padEnd(3)} cross=${String(last.crossings).padEnd(3)} 1st=${String(last.firstCrossing).padEnd(6)} critH=${String(last.critHours).padEnd(7)} plan=${last.planCost}cr ${(last.reduction * 100).toFixed(0)}% actBy=${last.actBy} ${last.ms}ms`);
  }
}

// ── Differentiation: no two scenarios in a city may share a signature ────────
let fails = 0;
const sig = (r) => `${r.dominant}|${Math.round(r.cascadeR * 4)}|${r.crises}|${Math.round((r.firstCrossing ?? -1) / 6)}|${Math.round(r.critHours / 50)}`;
for (const city of ['raleigh', 'nagpur']) {
  const seen = new Map();
  for (const r of rows.filter((x) => x.city === city)) {
    const s = sig(r);
    if (seen.has(s)) { console.log(`FAIL  ${city}: ${r.id} is indistinguishable from ${seen.get(s)} (${s})`); fails++; }
    else seen.set(s, r.id);
  }
}
// Every system must be the dominant one somewhere, or the catalogue is lopsided.
const doms = new Set(rows.map((r) => r.dominant));
console.log('\ndominant systems covered:', [...doms].join(', '));
const nat = rows.filter((r) => r.natural);
console.log(`natural scenarios run: ${nat.length} | distinct dominant systems among them: ${new Set(nat.map((r) => r.dominant)).size}`);
console.log(fails ? `\n${fails} FAILED` : '\nall scenarios are distinguishable');
const out = process.argv.indexOf('--json');
if (out > 0) { fs.writeFileSync(process.argv[out + 1], JSON.stringify(rows, null, 1)); console.log('wrote', process.argv[out + 1]); }
process.exit(fails ? 1 : 0);

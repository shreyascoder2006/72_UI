// Decision deadlines and the ghost-city trajectory, for every city and scenario.
//   node tools/test/plan_probe.js [--city nagpur] [--scenario monsoon2023]
// Prints the planner's recommendation at the scenario's now, how much of its benefit
// survives a late start, and what the plan does to the city afterwards.
const path = require('path');
global.window = global;
window.TWIN = {};
for (const f of ['core', 'data/geodata', 'data/geodata_nagpur', 'engine/scenarios', 'engine/engine', 'engine/interventions', 'engine/analytics', 'engine/population']) {
  require(path.join(__dirname, '../../src/js', f + '.js'));
}
const T = window.TWIN;
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const city = arg('city', 'nagpur');
const geo = (window.TWIN_GEOS || { raleigh: window.TWIN_GEO })[city];
if (!geo) throw new Error('Unknown city ' + city);
const scenarios = Object.values(T.scenarios).filter((s) => !s.cities || s.cities.includes(city));
const only = arg('scenario', null);
const pct = (x) => Math.round(x * 100) + '%';
const fmt = (t) => 'T+' + t.toFixed(1);

for (const scen of scenarios) {
  if (only && scen.id !== only) continue;
  const e = T.engine.create(geo, { scenario: scen.id });
  const p = T.interventions.create(e);
  const nowT = scen.liveNow || 34.5;
  const k = e.kOf(nowT);
  const t0 = Date.now();
  const ids = p.recommend(k, 5);
  const r = ids.length ? p.evaluate(k, ids) : null;
  console.log(`== ${city}/${scen.id} @${fmt(nowT)} · catalogue ${p.CATALOG.length} actions`);
  if (!r) { console.log('   no action reduces expected critical facility-hours'); continue; }
  console.log(`   plan within 5 crews: ${ids.join(', ')} (${r.cost} crews)`);
  console.log(`   critical facility-hours ${r.base.critHours.toFixed(1)} → ${r.with.critHours.toFixed(1)} (${pct(r.reduction)})` +
    ` · P(hospital critical) ${pct(r.base.hospCrit)} → ${pct(r.with.hospCrit)}${r.cascadeBroken ? ' · cascade broken' : ''}`);
  if (r.sideEffects.length) console.log('   side effects: ' + r.sideEffects.map((s) => `${e.F[s.i].id}+${s.delta.toFixed(2)}`).join(', '));
  // Decision deadline: benefit as a function of how late the crews start.
  const d = p.deadline(k, ids);
  console.log(`   deadline: now ${pct(d.r0)}` +
    ` · act by ${d.actBy == null ? 'n/a' : fmt(nowT + d.actBy) + ` (+${d.actBy}h)`}` +
    ` · under half from ${d.half == null ? 'never within 24h' : fmt(nowT + d.half) + ` (+${d.half}h)`}`);
  console.log('   benefit by start delay: ' + d.pts.map((x) => `+${x.h}h ${pct(x.reduction)}`).join(' '));
  // Ghost city: where the plan changes the city most, and by how much.
  const g = p.trajectory(k, ids);
  let worst = { d: 0, i: -1, k: 0 }, sum = 0, n = 0;
  for (let kk = g.k0; kk < e.K; kk++) for (let i = 0; i < e.N; i++) {
    const v = g.delta[kk * e.N + i];
    if (v < worst.d) worst = { d: v, i, k: kk };
    if (v !== 0) { sum += v; n++; }
  }
  console.log(`   ghost city: ${n} facility-steps change, mean ${(sum / (n || 1)).toFixed(3)}` +
    (worst.i >= 0 ? `, largest fall ${worst.d.toFixed(2)} at ${e.F[worst.i].id} ${fmt(worst.k * e.DT)}` : ''));
  console.log(`   (${Date.now() - t0} ms)`);
}

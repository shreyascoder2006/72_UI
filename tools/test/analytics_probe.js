// Node probe: crisis registry and Cascade-R for each scenario, through the services layer.
//   node tools/test/analytics_probe.js [scenario ...] [--t <hours>]
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../..');
global.window = global;
for (const f of ['src/js/data/geodata.js', 'src/js/core.js', 'src/js/engine/scenarios.js', 'src/js/engine/engine.js',
  'src/js/engine/interventions.js', 'src/js/engine/analytics.js', 'src/js/site/services.js'])
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });

const args = process.argv.slice(2);
const ti = args.indexOf('--t');
const tNow = ti >= 0 ? +args[ti + 1] : 34.5;
const scens = args.filter((a, n) => !a.startsWith('--') && (ti < 0 || n !== ti + 1));
const fmt = (x) => (x == null ? 'n/a' : x.toFixed(2));

for (const sc of scens.length ? scens : ['tropical', 'flash', 'heat']) {
  const e = TWIN.services.engine(sc), an = e.analytics, F = e.F, k = e.kOf(tNow);
  if (TWIN.services.engine(sc) !== e) throw new Error('services did not reuse the engine');
  const cr = an.cascadeR(k);
  const fc = [6, 12, 24].map((h) => `+${h}h ${fmt(an.cascadeR(k, Math.min(e.K - 1, k + h / e.DT)).r)}`).join(' ');
  const cx = an.crossing(k);
  console.log(`== ${sc} @T+${tNow}: Cascade-R ${fmt(cr.r)} (network ${fmt(cr.net)} / hazard ${fmt(cr.haz)}) · forecast ${fmt(null) === 'n/a' ? '' : ''}${fc} · crossing ${cx ? (cx.now ? 'now' : 'T+' + cx.t) : 'none'}`);
  console.log('   by system:', Object.entries(cr.bySys).map(([g, s]) => `${g} ${fmt(s.net)}/${fmt(s.haz)}`).join(' · '));
  const cs = an.crises(k);
  for (const c of cs.list) {
    console.log(`   ${c.id} ${c.type} · ${c.stage} · ${c.members.length} facilities · root ${F[c.root].id} since T+${c.since} · max ${Math.round(c.maxR * 100)}% · ${c.nCrit} critical · people ${c.people == null ? 'not modeled' : Math.round(c.people)}`);
    console.log(`      systems ${Object.keys(c.sys).join(',')} · districts ${c.districts.length} · next critical ${c.nextCrit ? `${F[c.nextCrit.i].id} T+${c.nextCrit.t.toFixed(1)} p${c.nextCrit.prob.toFixed(2)}` : 'none'}`);
  }
  for (const l of cs.links) console.log(`   ${l.kind}: ${cs.list[l.from].id} ${l.kind === 'couples' ? '→ ' + cs.list[l.to].id + ' via ' + F[e.E[l.edge].from].id + '→' + F[e.E[l.edge].to].id : '& ' + cs.list[l.to].id + ' load ' + F[l.fac].id}`);
  const timeline = [];
  for (let kk = 0; kk < e.K; kk += 12) timeline.push(`${kk * e.DT}h:${an.crises(kk).list.length}/${fmt(an.cascadeR(kk).r)}`);
  console.log('   crises/Cascade-R over time:', timeline.join(' '));
}

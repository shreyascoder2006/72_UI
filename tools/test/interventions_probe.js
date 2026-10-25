const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../..'); global.window = global;
for (const f of ['src/js/data/geodata.js', 'src/js/core.js', 'src/js/engine/scenarios.js', 'src/js/engine/engine.js', 'src/js/engine/interventions.js'])
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
const E = TWIN.engine.create(TWIN_GEO, { scenario: 'tropical' });
const I = TWIN.interventions.create(E);
const k = E.kOf(34.5);
for (const a of I.CATALOG) {
  const t = Date.now(); const r = I.evaluate(k, [a.id]);
  console.log(a.id.padEnd(14), `cost ${a.cost}`, `critH ${r.base.critHours.toFixed(1)} -> ${r.with.critHours.toFixed(1)} (${(r.reduction * 100).toFixed(0)}%)`,
    `care ${r.base.careHours.toFixed(1)}->${r.with.careHours.toFixed(1)} hospPeak ${r.base.hospPeak.toFixed(2)}->${r.with.hospPeak.toFixed(2)}`, r.cascadeBroken ? 'BROKEN' : '', 'side:', r.sideEffects.map((s) => `${E.F[s.i].id}+${s.delta.toFixed(2)}`).join(','), `${Date.now() - t}ms`);
}
let t = Date.now(); const rec = I.recommend(k, 5); console.log('recommend(5):', rec, `${Date.now() - t}ms`);
const r = I.evaluate(k, rec); console.log(`  critH ${r.base.critHours.toFixed(1)} -> ${r.with.critHours.toFixed(1)} (${(r.reduction * 100).toFixed(0)}%) hosp ${r.base.hospCrit.toFixed(2)}->${r.with.hospCrit.toFixed(2)} broken=${r.cascadeBroken}`);
const k2 = E.kOf(20); t = Date.now(); const rec2 = I.recommend(k2, 5); const r2 = I.evaluate(k2, rec2);
console.log('recommend @T+20:', rec2, `critH ${r2.base.critHours.toFixed(1)} -> ${r2.with.critHours.toFixed(1)} (${(r2.reduction * 100).toFixed(0)}%) hosp ${r2.base.hospCrit.toFixed(2)}->${r2.with.hospCrit.toFixed(2)} broken=${r2.cascadeBroken}`, `${Date.now() - t}ms`);

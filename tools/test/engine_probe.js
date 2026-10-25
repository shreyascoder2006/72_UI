// Node probe: load the browser scripts into a shared global and print the cascade.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../..');
global.window = global;
for (const f of ['src/js/data/geodata.js', 'src/js/core.js', 'src/js/engine/scenarios.js', 'src/js/engine/engine.js'])
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
const scen = process.argv[2] || 'tropical';
const t0 = Date.now();
const E = TWIN.engine.create(TWIN_GEO, { scenario: scen });
console.log(`scenario=${scen} create: ${Date.now() - t0} ms  N=${E.N} M=${E.M} K=${E.K}`);
const ids = (process.argv[3] || 'WX-DTN,DRN-PHU,DRN-CTG,DRN-CTC,TRF-CWF,TRF-GLN,PWR-PCE,EMS-02,HSP-WMR,HSP-DRH,HSP-REX').split(',');
const pad = (s, n) => String(s).padStart(n);
console.log('  t   | ' + ids.map((s) => pad(s, 8)).join(' '));
for (let k = 0; k < E.K; k += 6) {
  const row = ids.map((id) => { const i = E.idx[id]; return pad(E.truth[k * E.N + i].toFixed(2) + '/' + E.now[k * E.N + i].toFixed(2), 9); });
  console.log(pad((k * E.DT).toFixed(0), 5) + ' | ' + row.join(''));
}
const city = []; for (let k = 0; k < E.K; k += 12) city.push(`${k * E.DT}h:${E.cityAt(k).risk.toFixed(2)}/${JSON.stringify(E.cityAt(k).counts)}`);
console.log('city:', city.join('\n      '));
const k = E.kOf(34.5);
console.log('ESS@34.5', E.cityAt(k).ess.toFixed(1));
const fc = E.forecast(k, E.idx['HSP-WMR']);
console.log('WakeMed forecast @34.5:', fc.horizons.map((h) => `+${h.h}h ${h.mean.toFixed(2)} p=${h.pCrit.toFixed(2)}`).join(' | '), 'ttc', fc.ttc);
console.log('explain HSP-WMR:', E.explain(k, E.idx['HSP-WMR']).drivers.slice(0, 5).map((d) => `${d.kind}:${d.from != null ? E.F[d.from].id : d.label} ${d.value.toFixed(3)}`).join(', '));
const ep = E.edgesAt(k);
const st = { confirmed: 0, pruned: 0, candidate: 0 }; ep.forEach((x) => st[x.status]++);
console.log('edges@34.5', st, ' spurious:', ep.filter((x) => E.E[x.e].w === 0).map((x) => `${E.F[E.E[x.e].from].id}>${E.F[E.E[x.e].to].id} ${x.mean.toFixed(2)}±${x.sd.toFixed(2)} ${x.status}`).join('; '));
const ep72 = E.edgesAt(E.K - 1); const st2 = { confirmed: 0, pruned: 0, candidate: 0 }; ep72.forEach((x) => st2[x.status]++); console.log('edges@72', st2);
console.log('discover@34.5:', E.discover(k).filter((d) => d.found).map((d) => `${d.from}>${d.to} ${d.strength.toFixed(2)} lag${d.lag}`).join(', '));
console.log('cascade@34.5:', E.cascade(k).slice(0, 14).map((c) => `${c.t.toFixed(1)} ${E.F[c.i].id} ${c.level}${c.observed ? '' : ' p' + c.prob.toFixed(2)}`).join(' → '));
console.log('alerts:', E.alerts.length, E.alerts.slice(0, 40).map((a) => `${a.t}:${a.kind}:${E.F[a.i].id}${a.conf != null ? ' c' + a.conf.toFixed(2) : ''}`).join(' '));
const tv = Date.now(); const V = E.validation();
console.log(`validation ${Date.now() - tv}ms brier=${V.brier.toFixed(3)} bss=${V.bss.toFixed(2)} pod=${V.pod.toFixed(2)} far=${V.far.toFixed(2)} medianLead=${V.medianLead}h events=${V.events} alarms=${V.alarms}`);
console.log('reliability:', V.bins.map((b) => `${b.p.toFixed(2)}→${b.o.toFixed(2)}(${b.n})`).join(' '));
console.log('trust@34.5 faulty:', ['DRN-CTL', 'TRF-WOB', 'WX-NCS', 'DRN-PHU'].map((id) => `${id}=${E.trust[k * E.N + E.idx[id]].toFixed(2)}`).join(' '));

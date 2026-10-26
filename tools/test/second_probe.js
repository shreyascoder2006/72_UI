// Node probe: the pretrained second opinion (Chronos-Bolt) against the ensemble.
//   node tools/test/second_probe.js [--city nagpur]
// 1. second.js's ensemble scoring, run on the engine's own issue steps, must reproduce
//    engine.validation() exactly (so the comparison scores the real ensemble).
// 2. Both forecasts scored on the same hourly cases, side by side.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../..');
global.window = global;
for (const f of ['src/js/data/geodata.js', 'src/js/data/geodata_nagpur.js', 'src/js/data/chronos.js', 'src/js/core.js', 'src/js/engine/scenarios.js',
  'src/js/engine/engine.js', 'src/js/engine/second.js'])
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });

const args = process.argv.slice(2);
const only = args.includes('--city') ? args[args.indexOf('--city') + 1] : null;
const f2 = (x) => (x == null ? '—' : x.toFixed(3));
const pc = (x) => (x == null ? '—' : Math.round(x * 100) + '%');
let fails = 0;
console.log('city/scenario            | model    | Brier | skill  | detect | false al. | median lead');
for (const [city, geo] of Object.entries(TWIN_GEOS)) {
  if (only && city !== only) continue;
  for (const s of Object.values(TWIN.scenarios).filter((x) => !x.cities || x.cities.includes(city))) {
    const e = TWIN.engine.create(geo, { scenario: s.id });
    const sec = TWIN.second.create(e);
    if (!sec) { console.log(`${city}/${s.id}: no Chronos run`); fails++; continue; }
    const v = e.validation(), mine = sec.score(sec.ens, { from: 0, every: 1 });
    const same = Math.abs(v.brier - mine.brier) < 1e-9 && (Number.isFinite(v.bss) ? Math.abs(v.bss - mine.bss) < 1e-9 : mine.bss == null) && v.events === mine.events && v.hits === mine.hits && v.alarms === mine.alarms && v.falseAlarms === mine.falseAlarms && (v.medianLead || 0) === (mine.medianLead || 0);
    if (!same) { fails++; console.log(`FAIL ${city}/${s.id}: rescoring differs from engine.validation()`, { v: [v.brier, v.bss, v.events, v.hits, v.alarms], mine: [mine.brier, mine.bss, mine.events, mine.hits, mine.alarms] }); }
    const c = sec.compare();
    for (const [name, r] of [['ensemble', c.ens], ['chronos', c.ml]])
      console.log(`${(city + '/' + s.id).padEnd(24)} | ${name.padEnd(8)} | ${f2(r.brier)} | ${r.bss == null ? '  —   ' : (r.bss >= 0 ? '+' : '') + r.bss.toFixed(2).padStart(5)} | ${pc(r.pod).padStart(6)} | ${pc(r.far).padStart(9)} | ${r.medianLead == null ? '—' : r.medianLead + ' h'}  (${r.hits}/${r.events} events, ${r.alarms} warnings)`);
    const k = e.kOf(s.liveNow || 34.5), lk = sec.likely(k), dis = sec.disagreements(k).slice(0, 3);
    console.log(`  at T+${s.liveNow || 34.5}: P(crit 24h) ≥ 50%: ensemble ${lk.ens}, chronos ${lk.ml}, both ${lk.both}; largest gaps: ${dis.map((d) => `${e.F[d.i].id} ${pc(d.ens)}/${pc(d.ml)}`).join(', ') || 'none'}`);
  }
}
console.log(fails ? `${fails} check(s) failed` : 'ensemble rescoring matches engine.validation() for every run');
process.exit(fails ? 1 : 0);

// Export each city and scenario's simulated sensor streams for the pretrained forecaster.
//   node tools/ml/export_streams.js            → tools/ml/cache/<city>-<scenario>.json
// Only the observation stream goes out (what a forecaster could see: noisy, with the
// planted faults and dropouts as null), never the hidden truth.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../..');
global.window = global;
for (const f of ['src/js/data/geodata.js', 'src/js/data/geodata_nagpur.js', 'src/js/core.js', 'src/js/engine/scenarios.js', 'src/js/engine/engine.js'])
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });

const OUT = path.join(__dirname, 'cache');
fs.mkdirSync(OUT, { recursive: true });
for (const [city, geo] of Object.entries(TWIN_GEOS)) {
  for (const s of Object.values(TWIN.scenarios).filter((x) => !x.cities || x.cities.includes(city))) {
    const t0 = Date.now();
    const e = TWIN.engine.create(geo, { scenario: s.id });
    const idx = e.F.map((f, i) => (e.kinds[i] === 'weather' ? -1 : i)).filter((i) => i >= 0);
    const obs = idx.map((i) => Array.from({ length: e.K }, (_, k) => { const y = e.obs[k * e.N + i]; return Number.isNaN(y) ? null : Math.round(y * 1e4) / 1e4; }));
    const file = path.join(OUT, `${city}-${s.id}.json`);
    fs.writeFileSync(file, JSON.stringify({ city, scenario: s.id, K: e.K, DT: e.DT, CRIT: TWIN.engine.CRIT, ids: idx.map((i) => e.F[i].id), obs }));
    console.log(`${city}/${s.id}: ${idx.length} streams × ${e.K} steps (${Date.now() - t0} ms)`);
  }
}

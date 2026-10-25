const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../..'); global.window = global;
for (const f of ['src/js/data/geodata.js', 'src/js/core.js', 'src/js/engine/scenarios.js', 'src/js/engine/engine.js'])
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
for (const sc of ['tropical', 'flash', 'heat']) {
  const E = TWIN.engine.create(TWIN_GEO, { scenario: sc });
  const sens = E.alerts.filter((a) => a.kind === 'sensor').map((a) => `${E.F[a.i].id}@${a.t}`);
  const k = E.kOf(34.5);
  const low = E.F.map((f, i) => [f.id, E.trust[k * E.N + i]]).filter(([, t]) => t < 0.5).map(([id, t]) => `${id}=${t.toFixed(2)}`);
  const V = E.validation();
  console.log(sc.padEnd(9), 'sensor alerts:', sens.join(' '), '| low trust @34.5:', low.join(' '), `| brier ${V.brier.toFixed(3)} pod ${V.pod.toFixed(2)} far ${V.far.toFixed(2)} lead ${V.medianLead}`);
}

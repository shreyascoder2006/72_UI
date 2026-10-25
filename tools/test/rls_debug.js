const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../..'); global.window = global;
for (const f of ['src/js/data/geodata.js', 'src/js/core.js', 'src/js/engine/scenarios.js', 'src/js/engine/engine.js'])
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
const E = TWIN.engine.create(TWIN_GEO, { scenario: 'tropical' });
const i = E.idx['TRF-FMS'];
console.log('in-edges of TRF-FMS:', E.inEdges[i].map((e) => `${E.F[E.E[e].from].id} hi=${E.E[e].hi} lag=${E.E[e].lag}`));
for (const k of [30, 40, 50, 60, 80, 100]) {
  const y1 = E.obs[k * E.N + i], tr = E.trust[k * E.N + i];
  const ups = E.inEdges[i].map((e) => { const ed = E.E[e]; const r = E.now[Math.max(0, k - ed.lag) * E.N + ed.from]; return `${E.F[ed.from].id}:${r.toFixed(2)} g=${E.g(r, ed.from).toFixed(2)}`; });
  const post = E.inEdges[i].map((e) => { const p = E.edgePosterior(k, e); return `${p.mean.toFixed(3)}±${p.sd.toFixed(3)}`; });
  console.log(`k=${k} obs=${y1.toFixed(2)} trust=${tr.toFixed(2)} | ${ups.join('  ')} | post ${post.join(' ')}`);
}

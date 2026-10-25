const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '../..'); global.window = global;
for (const f of ['src/js/data/geodata.js', 'src/js/core.js', 'src/js/engine/scenarios.js', 'src/js/engine/engine.js'])
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
const E = TWIN.engine.create(TWIN_GEO, { scenario: process.argv[2] || 'tropical' });
const V = E.validation();
for (let i = 0; i < E.N; i++) {
  if (E.kinds[i] === 'weather') continue;
  let peak = 0, tc = -1; for (let k = 0; k < E.K; k++) { peak = Math.max(peak, E.truth[k * E.N + i]); if (tc < 0 && E.truth[k * E.N + i] >= 0.75) tc = k * E.DT; }
  // ensemble prior peak distribution (unweighted)
  let crossPrior = 0; for (let m = 0; m < E.M; m++) { for (let k = 0; k < E.K; k++) if (E.R(m, k, i) >= 0.75) { crossPrior++; break; } }
  let warn = -1; for (let k = 0; k < E.K; k++) { const w = E.wAt(k, i); let p = 0; for (let m = 0; m < E.M; m++) { for (let kk = k + 1; kk <= Math.min(E.K - 1, k + 48); kk++) if (E.R(m, kk, i) >= 0.75) { p += w[m]; break; } } if (p >= 0.6) { warn = k * E.DT; break; } }
  console.log(E.F[i].id.padEnd(8), 'truthPeak', peak.toFixed(2), 'tc', String(tc).padStart(5), 'warn', String(warn).padStart(5), 'priorCross', (crossPrior / E.M).toFixed(2));
}

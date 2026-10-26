// Response (#/plan): the builder, the counterfactual, the deadline and the states that
// have no plan to show. Also that the page never touches the twin's renderer.
//   node tools/test/response_probe.js <url>
const { chromium } = require('playwright');
(async () => {
  const base = process.argv[2] || 'http://127.0.0.1:8765/';
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], proxy });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  let fails = 0;
  const check = (label, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + JSON.stringify(info)}`); if (!ok) fails++; };
  const until = async (fn, ms = 90000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn)) return true; await page.waitForTimeout(200); } return false; };
  // Every figure arrives from a deferred calculation, so wait for the slowest one: the
  // deadline, which only resolves once evaluate and trajectory have.
  const settled = () => until(() => !!document.querySelector('#rpDl .rp-dl-line, #rpDl .rp-empty')
    && !document.querySelector('#rpTiles .v.pend') && !document.querySelector('.rp-card .loading-bar'));
  // On arrival the page asks the planner for a recommendation, which lands after the
  // first paint; waiting for it is what makes the rest of the checks deterministic.
  const recommended = () => until(() => document.querySelectorAll('#rpBuild tbody tr.on').length > 0, 40000);
  const go = async (hash) => {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await until(() => !!document.getElementById('rpTiles') || !!document.querySelector('.pg-wrap .empty'));
    await recommended(); await settled();
  };

  // Straight to Response, so the independence check below sees a session that has never
  // opened the twin or the Situation map.
  await page.goto(base + '#/plan?city=nagpur&s=monsoon2023&t=37', { waitUntil: 'domcontentloaded' });
  await until(() => !document.getElementById('loading'), 120000);
  await until(() => !!document.getElementById('rpTiles'));
  await recommended(); await settled();

  const indep = await page.evaluate(() => ({
    maplibre: !!document.querySelector('.maplibregl-map'),
    three: !!window.THREE,
    twinEngine: !!(window.TWIN.app && window.TWIN.app.engine),
    painted: [...document.querySelectorAll('canvas')].filter((c) => c.width > 400).length,
  }));
  check('no map, no three.js and no twin engine were built', !indep.maplibre && !indep.three && !indep.twinEngine && indep.painted === 0, indep);

  // ── Nagpur: the page opens on the planner's own recommendation.
  let v = await page.evaluate(() => ({
    tiles: [...document.querySelectorAll('#rpTiles .rp-tile')].map((t) => t.querySelector('.v').textContent.trim()),
    deltas: [...document.querySelectorAll('#rpTiles .rp-tile .d')].map((d) => d.textContent.trim()),
    chosen: document.querySelectorAll('#rpBuild tbody tr.on').length,
    rows: document.querySelectorAll('#rpBuild tbody tr').length,
    crews: (document.querySelector('.rp-crew-n') || {}).textContent || '',
    pips: document.querySelectorAll('.rp-pips i.used').length,
    base: !!document.querySelector('#rpCf .rp-ln.base'), plan: !!document.querySelector('#rpCf .rp-ln.plan'),
    gap: !!document.querySelector('#rpCf .rp-gap'),
    dl: (document.querySelector('.rp-dl-line') || {}).textContent || '',
    pts: document.querySelectorAll('#rpDl .rp-pt').length,
    cross: document.querySelectorAll('#rpTl .rp-ev').length,
    shifted: document.querySelectorAll('#rpTl .rp-shift').length,
    gone: document.querySelectorAll('#rpTl .rp-ev.gone').length,
    fac: document.querySelectorAll('#rpFac tbody tr').length,
    sys: document.querySelectorAll('.rp-sys-row').length,
  }));
  const allRows = v.rows;
  check('opens on a recommendation and states the outcome', v.chosen > 0 && v.tiles.length === 5 && v.tiles.every((t) => t !== '—'), v);
  check('every tile is measured against the do-nothing baseline', v.deltas.filter((d) => /was /.test(d)).length === 4, v);
  check('the counterfactual draws both engine futures and the gap between them', v.base && v.plan && v.gap, v);
  check('the deadline resolves to an hour', /Start by T\+|have to move now|keeps 80%/.test(v.dl) && v.pts >= 6, v);
  check('crossings are listed per facility and the plan moves some of them', v.cross > 0 && v.shifted + v.gone > 0, v);
  check('supporting panels are populated', v.fac > 0 && v.sys > 0 && v.pips > 0, v);

  // Crossing rows must not overlap, which is what the 72 h axis used to cause.
  const lab = await page.evaluate(() => [...document.querySelectorAll('#rpTl .rp-evl')].map((t) => { const b = t.getBBox(); return [b.x, b.x + b.width, b.y]; }));
  let overlap = 0;
  for (let i = 0; i < lab.length; i++) for (let j = i + 1; j < lab.length; j++)
    if (Math.abs(lab[i][2] - lab[j][2]) < 6 && lab[i][0] < lab[j][1] && lab[j][0] < lab[i][1]) overlap++;
  check('crossing labels do not overlap', lab.length > 0 && overlap === 0, { labels: lab.length, overlap });

  // ── Clearing the plan falls back to the baseline rather than to zeros.
  await page.evaluate(() => document.getElementById('rpClear').click());
  await until(() => !!document.querySelector('#rpTiles .rp-tile.wide'));
  await page.waitForTimeout(300);
  v = await page.evaluate(() => ({
    wide: !!document.querySelector('#rpTiles .rp-tile.wide'),
    tile: (document.querySelector('#rpTiles .rp-tile .v') || {}).textContent.trim(),
    cf: (document.querySelector('#rpCf .rp-empty') || {}).textContent || '',
    dl: (document.querySelector('#rpDl .rp-empty') || {}).textContent || '',
    pips: document.querySelectorAll('.rp-pips i.used').length,
  }));
  check('an empty plan says so instead of showing zeros', v.wide && /Doing nothing/.test(v.tile) && v.cf.length > 10 && v.dl.length > 10 && v.pips === 0, v);

  // ── One action on its own recomputes everything.
  await page.evaluate(() => document.querySelector('#rpBuild tbody tr [data-act]').click());
  await settled();
  const one = await page.evaluate(() => ({
    chosen: document.querySelectorAll('#rpBuild tbody tr.on').length,
    crit: (document.querySelector('#rpTiles .rp-tile .v') || {}).textContent.trim(),
    cost: (document.querySelector('.rp-crew-n') || {}).textContent.trim(),
  }));
  check('selecting one action re-evaluates the plan', one.chosen === 1 && /^[0-9]/.test(one.crit), one);

  // ── A bigger budget lets the planner recommend more.
  await page.evaluate(() => document.querySelector('#rpBudget [data-b="10"]').click());
  await page.waitForTimeout(200);
  await page.evaluate(() => document.getElementById('rpRec').click());
  // The greedy search runs spread over frames; the button says when it is done.
  await until(() => { const b = document.getElementById('rpRec'); return b && !b.disabled; }, 60000);
  await settled();
  const big = await page.evaluate(() => ({
    budget: (document.querySelector('#rpBudget [aria-pressed="true"]') || {}).textContent,
    chosen: document.querySelectorAll('#rpBuild tbody tr.on').length,
    spent: +(((document.querySelector('.rp-crew-n') || {}).textContent || '').match(/\d+/) || [0])[0],
    over: !!document.querySelector('#rpTiles .rp-tile.over'),
  }));
  check('a larger budget is honoured by the recommendation', big.budget === '10' && big.chosen > one.chosen && big.spent <= 10 && !big.over, big);

  // ── Comparison holds plans side by side at the same decision time.
  await page.evaluate(() => document.getElementById('rpSave').click());
  await page.waitForTimeout(1600);
  const cmp = await page.evaluate(() => ({
    rows: document.querySelectorAll('#rpCmp tbody tr').length,
    cells: [...document.querySelectorAll('#rpCmp tbody tr td')].map((t) => t.textContent.trim()).slice(0, 4),
  }));
  check('a plan can be held for comparison', cmp.rows === 1 && cmp.cells.length === 4, cmp);

  // ── Filtering and searching the catalogue.
  const filt = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.rp-chip')].find((b) => b.dataset.filter !== 'all');
    c.click();
    return { sys: c.dataset.filter, rows: document.querySelectorAll('#rpBuild tbody tr').length };
  });
  check('a system filter narrows the catalogue', filt.rows > 0 && filt.rows < allRows, { ...filt, allRows });
  await page.evaluate(() => { document.querySelector('.rp-chip[data-filter="all"]').click(); });

  // ── Selecting a facility links the table to the crossing chart.
  const link = await page.evaluate(() => {
    const r = document.querySelector('#rpFac tbody tr[data-fac]');
    if (!r) return null;
    const i = r.dataset.fac; r.click();
    return { i, facOn: document.querySelectorAll('#rpFac tbody tr.on').length, evOn: document.querySelectorAll(`#rpTl .rp-ev.on`).length };
  });
  check('a facility selection marks the row (and its crossing, when it has one)', link && link.facOn === 1, link);

  // ── Raleigh: most crossings are already past at this issue time.
  await go('#/plan?city=raleigh&s=tropical&t=34.5');
  v = await page.evaluate(() => ({
    pend: document.querySelectorAll('#rpTiles .v.pend').length,
    cross: document.querySelectorAll('#rpTl .rp-ev').length,
    legend: (document.querySelector('#rpTl .rp-legend span') || {}).textContent || '',
    tiles: [...document.querySelectorAll('#rpTiles .rp-tile .v')].map((t) => t.textContent.trim()),
    chosen: document.querySelectorAll('#rpBuild tbody tr.on').length,
    dl: (document.querySelector('#rpDl .rp-dl-line, #rpDl .rp-empty') || {}).textContent || '',
  }));
  check('Raleigh plans on what is still ahead and counts what already crossed', v.cross > 0 && /already crossed/.test(v.legend), v);
  check('Raleigh recomputes from its own engine', v.chosen > 0 && v.tiles.length === 5 && v.dl.length > 10, v);

  // A "kept below CRITICAL" mark is a claim about the plan, so it must hold against the
  // baseline trajectory: re-run the planner here from the engine, independently of the
  // view, and check no row claims a removal the do-nothing future never had to remove.
  const marks = await page.evaluate(() => {
    const T = window.TWIN, e = T.services.engine('raleigh', 'tropical'), k = e.kOf(34.5);
    const ids = [...document.querySelectorAll('#rpBuild tbody input:checked')].map((c) => c.dataset.act);
    const tr = T.services.planner(e).trajectory(k, ids);
    const cross = (arr, i) => { for (let kk = Math.max(tr.k0, k); kk < e.K; kk++) if (arr[kk * e.N + i] >= 0.75) return kk * e.DT; return null; };
    const rows = [...document.querySelectorAll('#rpTl .rp-ev')].map((g) => ({
      i: +g.dataset.fac, gone: g.classList.contains('gone'),
      bought: (g.querySelector('.rp-evd') || {}).textContent || '',
    }));
    return rows.map((r) => ({ ...r, base: cross(tr.base, r.i), plan: cross(tr.plan, r.i) }));
  });
  const unearned = marks.filter((r) => r.gone && r.base == null);
  const wrongBuy = marks.filter((r) => r.bought && (r.base == null || r.plan == null || Math.abs((r.plan - r.base) - parseFloat(r.bought)) > 0.3));
  check('every "kept below CRITICAL" mark is one the baseline future actually needed',
    marks.length > 0 && unearned.length === 0 && wrongBuy.length === 0, { marks, unearned, wrongBuy });

  // ── A scenario with no crisis still has a plan to state.
  await go('#/plan?city=nagpur&s=monsoon2023&t=2');
  v = await page.evaluate(() => ({
    empty: (document.querySelector('#rpTl .rp-empty') || {}).textContent || '',
    cross: document.querySelectorAll('#rpTl .rp-ev').length,
    chosen: document.querySelectorAll('#rpBuild tbody tr.on').length,
    tiles: document.querySelectorAll('#rpTiles .rp-tile').length,
    dl: (document.querySelector('#rpDl .rp-dl-line, #rpDl .rp-empty') || {}).textContent || '',
  }));
  check('before the storm the page still plans, and the crossing panel has one state or the other',
    v.tiles >= 1 && v.dl.length > 10 && (v.cross > 0 ? !v.empty : /No facility is forecast/.test(v.empty)), v);

  // ── Replay at the end of the window has nothing left to plan.
  await page.evaluate(() => { location.hash = '#/plan?city=nagpur&s=monsoon2023&m=replay'; });
  await until(() => !!document.querySelector('.rp-wrap'));
  await page.waitForTimeout(1500);
  v = await page.evaluate(() => ({ empty: (document.querySelector('.rp-wrap .empty') || {}).textContent || '', tiles: !!document.getElementById('rpTiles') }));
  check('the end of a replay says there is nothing left to plan for', /nothing left to plan/.test(v.empty) && !v.tiles, v);

  check('no page errors', errs.length === 0, errs.slice(0, 4));
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();

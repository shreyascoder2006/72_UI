// Crises board: selection, cross-panel synchronisation and the states that have no data.
//   node tools/test/board_probe.js <url>
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
  const until = async (fn, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn)) return true; await page.waitForTimeout(200); } return false; };
  const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await until(() => !!document.querySelector('#bdCR .cr-rows')); await page.waitForTimeout(1200); };

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await until(() => !document.getElementById('loading'), 90000);

  // ── Nagpur: one crisis, no confirmed link, nothing flowing yet.
  await go('#/crises?city=nagpur&s=monsoon2023&t=37');
  let v = await page.evaluate(() => ({
    crisis: (document.querySelector('.bd-tbl.reg tr.on [class*=num]') || {}).textContent || null,
    insp: (document.querySelector('.net-insp h3') || {}).textContent || '',
    inspEmpty: !!document.querySelector('.net-insp .ni-empty'),
    crState: (document.querySelector('.cr-state b') || {}).textContent || '',
    mxState: !!document.querySelector('.mx-state'),
    bars: [...document.querySelectorAll('.cr-bar')].map((b) => Math.round(parseFloat(b.style.width))),
    evHead: [...document.querySelectorAll('.ev-tbl thead th')].map((t) => t.textContent),
  }));
  check('one crisis becomes the default context (inspector is never blank)', !v.inspEmpty && /^CR-/.test(v.insp), v);
  check('Cascade-R below 1 explains the forecast crossing', /forecast to cross/i.test(v.crState), v);
  check('bar length carries magnitude, not just proportion', new Set(v.bars).size > 1, v);
  check('matrix states that nothing is flowing yet', v.mxState, v);
  check('evidence separates feed, analysis and trust', v.evHead.join('|').includes('Feed') && v.evHead.join('|').includes('Analysis') && v.evHead.join('|').includes('Trust'), v);

  // Timeline labels must not overlap.
  const lab = await page.evaluate(() => [...document.querySelectorAll('.tl-evl')].map((t) => { const b = t.getBBox(); return [b.x, b.x + b.width, b.y]; }));
  let overlap = 0;
  for (let i = 0; i < lab.length; i++) for (let j = i + 1; j < lab.length; j++) {
    if (Math.abs(lab[i][2] - lab[j][2]) < 6 && lab[i][0] < lab[j][1] && lab[j][0] < lab[i][1]) overlap++;
  }
  check('timeline labels do not overlap', overlap === 0, { labels: lab.length, overlap });

  // ── Selection synchronises the panels.
  await page.evaluate(() => document.querySelector('.cr-row[data-sys]').click());
  await page.waitForTimeout(400);
  v = await page.evaluate(() => ({ insp: (document.querySelector('.net-insp h3') || {}).textContent || '', on: document.querySelectorAll('.cr-row.on').length, tl: (document.querySelector('.bd-sub-r') || {}).textContent || '' }));
  check('selecting a system updates the inspector and marks the row', v.on === 1 && v.insp.length > 1, v);

  const facOk = await page.evaluate(() => { const r = document.querySelector('#bdFac tr[data-fac]'); if (!r) return false; r.click(); return true; });
  await page.waitForTimeout(500);
  v = await page.evaluate(() => ({
    insp: (document.querySelector('.net-insp h3') || {}).textContent || '',
    evRows: document.querySelectorAll('#bdEv tbody tr').length,
    tlTitle: (document.querySelector('#bdTL .bd-sub-r') || {}).textContent || '',
  }));
  check('selecting a facility focuses the timeline and the evidence panel', facOk && v.evRows === 1 && /Risk/.test(v.tlTitle), v);

  // ── Raleigh: four crises, confirmed links, stress actually flowing.
  await go('#/crises?city=raleigh&s=tropical&t=34.5');
  v = await page.evaluate(() => ({
    crState: (document.querySelector('.cr-state b') || {}).textContent || '',
    insp: (document.querySelector('.net-insp h3') || {}).textContent || '',
    inspEmpty: !!document.querySelector('.net-insp .ni-empty'),
    confirmed: document.querySelectorAll('.net .ln.confirmed').length,
    mxState: !!document.querySelector('.mx-state'),
    mxFlow: document.querySelectorAll('.mx td[class*="mx-"]:not(.mx-none):not(.mx-cand):not(.mx-idle)').length,
    regRows: document.querySelectorAll('.bd-tbl.reg tbody tr').length,
  }));
  check('several crises: none auto-selected, inspector gives city context', !v.inspEmpty && v.regRows === 4 && /Raleigh/.test(v.insp), v);
  check('self-sustaining state is stated when Cascade-R is above 1', /self-sustaining/i.test(v.crState), v);
  check('confirmed links are drawn and the matrix shows real flow', v.confirmed > 0 && !v.mxState && v.mxFlow > 0, v);

  // Matrix cell selects the matching link.
  const mxOk = await page.evaluate(() => { const c = document.querySelector('.mx td[data-edge]:not([data-edge=""])'); if (!c) return null; c.click(); return c.getAttribute('data-edge'); });
  await page.waitForTimeout(400);
  v = await page.evaluate(() => ({ insp: (document.querySelector('.net-insp h3') || {}).textContent || '', on: document.querySelectorAll('.mx td.on').length }));
  check('selecting a matrix cell selects that link everywhere', !!mxOk && v.on === 1 && v.insp.includes('→'), { mxOk, ...v });

  // Registry selection scopes the board and reaches the URL.
  await page.evaluate(() => document.querySelector('.bd-tbl.reg tbody tr[data-crisis]').click());
  await page.waitForTimeout(600);
  v = await page.evaluate(() => ({ hash: location.hash, on: document.querySelectorAll('.bd-tbl.reg tr.on').length, insp: (document.querySelector('.net-insp h3') || {}).textContent || '' }));
  check('selecting a crisis scopes the board and is kept in the link', /c=CR-/.test(v.hash) && v.on === 1, v);

  // ── A quiet moment: the monsoon reconstruction has no crisis before T+6.
  await go('#/crises?city=nagpur&s=monsoon2023&t=2');
  v = await page.evaluate(() => ({
    n: document.querySelectorAll('.bd-tbl.reg tbody tr').length,
    empty: (document.querySelector('.ni-empty') || {}).textContent || '',
    insp: (document.querySelector('.net-insp h3') || {}).textContent || '',
    nearest: document.querySelectorAll('#bdReg tbody tr[data-fac]').length,
  }));
  check('no crisis: a useful empty state, not a blank board', v.n === 0 && v.nearest > 0 && /Nagpur/.test(v.insp) && /No crisis/i.test(v.empty), v);

  console.log('console errors:', errs.length ? errs.slice(0, 5) : 'none');
  if (errs.length) fails++;
  console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

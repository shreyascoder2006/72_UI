// Routing and shared-context check: default route, deep links, URL writes, back/forward,
// unknown paths, and the simulation labels.
//   node tools/test/routes.js <url> [outdir]
const { chromium } = require('playwright');
(async () => {
  const base = (process.argv[2] || 'http://127.0.0.1:8765/index.html').replace(/#.*$/, '');
  const out = process.argv[3];
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  // evaluate() rather than waitForFunction(): the latter compiles with eval, which strict CSPs refuse.
  const until = async (fn, arg, ms = 120000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn, arg)) return; await page.waitForTimeout(200); } throw new Error('timed out: ' + fn); };
  const ready = () => until(() => !document.getElementById('loading') && window.TWIN && TWIN.app && TWIN.app.engine);
  const settle = () => page.waitForTimeout(700); // URL writes are throttled to 400 ms
  // Wait for the address bar to match; a busy main thread (e.g. a hero model loading) can
  // delay the throttled write well past the throttle interval.
  const hashLike = (re) => until((src) => new RegExp(src).test(location.hash), re.source, 8000).catch(() => {});
  const state = () => page.evaluate(() => { const s = TWIN.app.state; return { hash: location.hash, scenario: s.scenario, mode: s.mode, t: s.t, nowT: s.nowT, sel: s.selected != null ? TWIN_GEO.facilities[s.selected].id : null }; });
  let fails = 0;
  const check = (label, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + JSON.stringify(info)}`); if (!ok) fails++; };

  // 1. The bare page opens the twin and writes the default context.
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await ready(); await settle();
  let st = await state();
  check('bare URL → #/twin with scenario', st.hash === '#/twin?s=tropical', st);
  const labels = await page.evaluate(() => ({
    tag: document.getElementById('clockTag').textContent, clock: document.getElementById('clockD').textContent,
    badge: document.getElementById('simBadge').textContent, modes: [...document.querySelectorAll('.mode-toggle button')].map((b) => b.textContent.trim()).join('/'),
    option: document.getElementById('scenario').selectedOptions[0].textContent,
  }));
  check('simulation labels', labels.tag === 'SIM NOW' && labels.clock.startsWith('SCENARIO') && /Simulation/.test(labels.badge) && labels.modes === 'Now/Replay' && /modeled/.test(labels.option), labels);

  // 2. Selecting a facility pushes it into the URL; Escape clears it.
  await page.evaluate(() => TWIN.app.select(TWIN_GEO.facilities.findIndex((f) => f.id === 'HSP-WMR'), { fly: false }));
  await hashLike(/[?&]a=HSP-WMR/);
  st = await state();
  check('selection written to URL', /[?&]a=HSP-WMR/.test(st.hash), st);
  const tag = await page.evaluate(() => document.getElementById('feedTag').textContent);
  check('inspector feed labelled simulated', /· SIM/.test(tag) && !/LIVE/.test(tag), tag);

  // 3. Scrubbing writes the time; back returns to the previous selection state.
  await page.evaluate(() => { TWIN.app.scrub(40); TWIN.app.scrubEnd(); });
  await hashLike(/[?&]t=40/);
  st = await state();
  check('scrub written to URL (replace)', /[?&]t=40/.test(st.hash), st);
  await page.goBack(); await settle();
  st = await state();
  check('back → selection cleared', st.sel === null && !/a=/.test(st.hash), st);
  await page.goForward(); await settle();
  st = await state();
  check('forward → selection restored', st.sel === 'HSP-WMR', st);

  // 4. Deep link on a fresh load: scenario, time and selection restored.
  await page.goto('about:blank');
  await page.goto(base + '#/twin?s=flash&t=40&a=HSP-WMR', { waitUntil: 'domcontentloaded' });
  await ready(); await until(() => TWIN.app.state.selected != null, null, 30000); await settle();
  st = await state();
  check('fresh deep link restores scenario, time, selection', st.scenario === 'flash' && st.t === 40 && st.sel === 'HSP-WMR' && st.mode === 'live' && st.hash === '#/twin?s=flash&t=40&a=HSP-WMR', st);
  if (out) await page.screenshot({ path: `${out}/routes-deeplink.png` });
  // An in-page link that changes scenario, mode and time together.
  await page.evaluate(() => { location.hash = '#/twin?s=tropical&t=20&m=replay'; });
  await until(() => TWIN.app.state.scenario === 'tropical' && TWIN.app.state.mode === 'historical', null, 30000).catch(() => {});
  await settle();
  st = await state();
  check('in-page link applies scenario, replay mode and time', st.scenario === 'tropical' && st.mode === 'historical' && st.t === 20 && /m=replay/.test(st.hash), st);

  // 5. Editing the address bar applies the change without a reload.
  await page.evaluate(() => { location.hash = '#/twin?s=tropical&a=EMS-02'; });
  await until(() => TWIN.app.state.selected != null && TWIN_GEO.facilities[TWIN.app.state.selected].id === 'EMS-02', null, 20000).catch(() => {});
  await settle();
  st = await state();
  check('hash edit applies selection and mode', st.sel === 'EMS-02' && st.mode === 'live', st);

  // 6. Unknown facility and scenario are dropped; unknown paths go to the twin.
  await page.evaluate(() => { location.hash = '#/twin?s=nope&a=NOPE'; });
  await settle(); await page.waitForTimeout(600);
  st = await state();
  check('unknown values dropped from URL', !/nope|NOPE/.test(st.hash), st);
  await page.evaluate(() => { location.hash = '#/nowhere?s=tropical'; });
  await settle();
  const nf = await page.evaluate(() => ({ hash: location.hash, toast: document.getElementById('toast').innerText }));
  check('unknown path → twin with a note', nf.hash.startsWith('#/twin') && /no page/i.test(nf.toast), nf);

  console.log('console errors:', errors.length ? '\n  ' + [...new Set(errors)].join('\n  ') : 'none');
  console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
  await browser.close();
  process.exit(fails || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

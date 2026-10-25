// Routing and shared-context check: the overview and crisis pages, default route, deep
// links, URL writes, back/forward, unknown paths, crisis focus on the twin, cities, and
// the simulation labels.
//   node tools/test/routes.js <url> [outdir]
// (Git Bash: set MSYS_NO_PATHCONV=1 so "#/..." arguments are not rewritten as paths.)
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
  const ready = () => until(() => !document.getElementById('loading') && window.TWIN && TWIN.app && TWIN.app.engine && document.getElementById('site').hidden);
  // A site page is ready once its body is drawn and its slower parts (history, plan) are in.
  const pageReady = () => until(() => { const p = document.getElementById('page'); return !document.getElementById('site').hidden && p.querySelector('.pg-wrap') && !p.querySelector('.loading-bar'); });
  const settle = () => page.waitForTimeout(700); // URL writes are throttled to 400 ms
  // Wait for the address bar to match; a busy main thread (e.g. a hero model loading) can
  // delay the throttled write well past the throttle interval.
  const hashLike = (re) => until((src) => new RegExp(src).test(location.hash), re.source, 8000).catch(() => {});
  const state = () => page.evaluate(() => { const s = TWIN.app.state; return { hash: location.hash, city: TWIN.app.geo.id, scenario: s.scenario, mode: s.mode, t: s.t, nowT: s.nowT, crisis: s.crisis, sel: s.selected != null ? TWIN.app.geo.facilities[s.selected].id : null }; });
  const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
  let fails = 0;
  const check = (label, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + JSON.stringify(info)}`); if (!ok) fails++; };

  // 1. The bare page opens the overview of the default city and writes the context.
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await pageReady(); await settle();
  let pg = await page.evaluate(() => ({ hash: location.hash, h1: document.querySelector('#page h1').textContent, tab: ((document.querySelector('#nav .nav-item[aria-current]') || {}).querySelector ? document.querySelector('#nav .nav-item[aria-current] .nav-label').textContent : null), plan: !!document.querySelector('#ovPlanBody .plan-list'), chart: !!document.querySelector('#ovChart svg'), title: document.title }));
  check('bare URL → overview of the default city, Nagpur', pg.hash === '#/?city=nagpur&s=monsoon2023' && /Nagpur/.test(pg.h1) && pg.tab === 'Situation' && /^Overview/.test(pg.title), pg);
  check('overview has the predicted course and a recommended plan', pg.chart && pg.plan, pg);
  // The sidebar lists every built feature, marks the current one, and advertises none
  // that cannot be opened.
  const nav = await page.evaluate(() => ({
    items: [...document.querySelectorAll('#nav .nav-item')].map((a) => a.dataset.path),
    labels: [...document.querySelectorAll('#nav .nav-item .nav-label')].map((a) => a.textContent),
    planned: TWIN.nav.planned().map((f) => f.path),
    chips: [...document.querySelectorAll('#nav .nav-item')].map((a) => a.querySelector('.nav-chip').textContent),
    groups: [...document.querySelectorAll('#nav .nav-group-title')].map((g) => g.textContent),
  }));
  check('sidebar lists the built features only, with live chips',
    nav.items.join() === '/,/crises,/twin,/plan,/warnings,/area'
    && nav.labels.join() === 'Situation,Crises,City twin,Response,Warnings,My area'
    && !nav.planned.some((p) => nav.items.includes(p)) && nav.groups.join() === 'Operations,Public'
    && /NORMAL|WATCH|HIGH|CRITICAL/.test(nav.chips[0]), nav);
  // Collapsing leaves the icons and survives a reload; the rail is narrower.
  await click('#navCollapse');
  await page.waitForTimeout(350); // the rail animates to its width
  const tight = await page.evaluate(() => ({
    on: document.body.classList.contains('nav-tight'),
    w: document.getElementById('nav').getBoundingClientRect().width,
    label: getComputedStyle(document.querySelector('#nav .nav-label')).display,
  }));
  await click('#navCollapse');
  check('sidebar collapses to an icon rail', tight.on && tight.w < 70 && tight.label === 'none', tight);

  // The header's city selector switches the page in place (the rest runs on Raleigh).
  await page.evaluate(() => { const s = document.getElementById('pgCity'); s.value = 'raleigh'; s.dispatchEvent(new Event('change')); });
  await until(() => /city=raleigh/.test(location.hash) && /Raleigh/.test((document.querySelector('#page h1') || {}).textContent || ''));
  await pageReady();
  pg = await page.evaluate(() => ({ hash: location.hash, h1: document.querySelector('#page h1').textContent, plan: !!document.querySelector('#ovPlanBody .plan-list') }));
  check('city selector → Raleigh overview, no reload', pg.hash === '#/?city=raleigh&s=tropical' && /Raleigh/.test(pg.h1) && pg.plan, pg);

  // The three operations pages added in the 6-feature build.
  await click('#nav a[data-nav="/plan"]');
  await until(() => /#\/plan/.test(location.hash) && !!document.querySelector('.pl-act'));
  await until(() => !!document.querySelector('.pl-ledger'), null, 70000).catch(() => {});
  let pl = await page.evaluate(() => ({
    hash: location.hash, acts: document.querySelectorAll('.pl-act').length,
    ledger: document.querySelectorAll('.pl-cellbox').length,
    chosen: document.querySelectorAll('.pl-act input:checked').length,
    title: document.title,
  }));
  check('Response opens with the planner\'s own recommendation and a ledger',
    pl.acts >= 7 && pl.ledger === 4 && pl.chosen >= 1 && /^Response/.test(pl.title), pl);
  await until(() => !!document.querySelector('.pl-chart'), null, 90000).catch(() => {});
  pl = await page.evaluate(() => ({ chart: !!document.querySelector('.pl-chart'), line: (document.querySelector('.pl-deadline-line') || {}).textContent || '' }));
  check('Response shows the decision deadline', pl.chart && /benefit|value|now/i.test(pl.line), pl);

  await click('#nav a[data-nav="/warnings"]');
  await until(() => /#\/warnings/.test(location.hash) && !!document.querySelector('.wn-phone'));
  await until(() => (document.getElementById('wnSitrep') || {}).textContent.includes('SITUATION REPORT'), null, 90000).catch(() => {});
  const wn = await page.evaluate(() => ({
    phones: document.querySelectorAll('.wn-phone').length,
    segs: [...document.querySelectorAll('.wn-seg')].map((s) => s.textContent),
    cap: (document.querySelector('.wn-cap pre') || {}).textContent.slice(0, 40),
    sitrep: (document.getElementById('wnSitrep') || {}).textContent.slice(0, 20),
    exercise: !!document.querySelector('.warn-exercise'),
  }));
  check('Warnings issues CAP, SMS per language and a situation report',
    wn.phones >= 2 && wn.segs.some((t) => /GSM-7/.test(t)) && wn.cap.startsWith('<?xml')
    && wn.sitrep.includes('SITUATION REPORT') && wn.exercise, wn);

  await click('#nav a[data-nav="/area"]');
  await until(() => /#\/area/.test(location.hash) && !!document.querySelector('.ar-verdict'));
  const ar = await page.evaluate(() => ({
    verdict: (document.querySelector('.ar-verdict h2') || {}).textContent || '',
    rows: document.querySelectorAll('.ar-row').length,
    cells: document.querySelectorAll('.ar-row:first-child .ar-cells i').length,
    advice: ((document.querySelector('.ar-advice') || {}).textContent || '').length,
    area: location.hash.includes('area='),
  }));
  check('My area gives a plain-language verdict, a 36 h strip and advice',
    /\./.test(ar.verdict) && ar.rows >= 2 && ar.cells === 37 && ar.advice > 40, ar);
  // Switching language keeps the page and swaps the advice.
  const before = await page.evaluate(() => (document.querySelector('.ar-advice') || {}).textContent);
  const langs = await page.evaluate(() => document.querySelectorAll('#arLang button').length);
  if (langs > 1) {
    await page.evaluate(() => document.querySelectorAll('#arLang button')[1].click());
    await until((b) => (document.querySelector('.ar-advice') || {}).textContent !== b, before, 8000).catch(() => {});
    const after = await page.evaluate(() => (document.querySelector('.ar-advice') || {}).textContent);
    check('My area switches language in place', after !== before && after.length > 10, { before: before.slice(0, 30), after: after.slice(0, 30) });
  }
  await page.evaluate(() => TWIN.store.go('/', { replace: true }));
  await pageReady();

  // 2. Tabs and links: crisis registry, a crisis, then the twin framed on it.
  await click('#nav a[data-nav="/crises"]');
  await pageReady();
  pg = await page.evaluate(() => ({ hash: location.hash, rows: document.querySelectorAll('.crisis-row').length, first: (document.querySelector('.crisis-row .cr-id a') || {}).textContent, gantt: !!document.querySelector('#crHist svg') }));
  check('Crises tab → registry with rows and history', /^#\/crises\?city=raleigh&s=tropical$/.test(pg.hash) && pg.rows > 0 && pg.gantt, pg);
  const cid = pg.first;
  await click('.crisis-row .cr-id a');
  await pageReady();
  pg = await page.evaluate(() => ({ hash: location.hash, h1: document.querySelector('#page h1').textContent, members: document.querySelectorAll('.tbl tbody tr').length, events: document.querySelectorAll('.events li').length, map: !!document.querySelector('.citymap polygon') }));
  check('crisis link → its detail page', pg.hash.startsWith(`#/crises/${cid}?`) && pg.h1.includes(cid) && pg.members > 0 && pg.events > 0 && pg.map, pg);
  if (out) await page.screenshot({ path: `${out}/routes-crisis.png` });
  await click('.pg-actions a.btn');
  await ready(); await settle();
  let st = await state();
  const chip = await page.evaluate(() => (document.querySelector('.crumb-crisis a') || {}).textContent);
  check('"Open on the 3D twin" boots the twin on that crisis', st.crisis === cid && chip === cid && new RegExp(`c=${cid}`).test(st.hash), { st, chip });
  const labels = await page.evaluate(() => ({
    tag: document.getElementById('clockTag').textContent, clock: document.getElementById('clockD').textContent,
    badge: document.getElementById('simBadge').textContent, modes: [...document.querySelectorAll('.topbar .mode-toggle button')].map((b) => b.textContent.trim()).join('/'),
    option: document.getElementById('scenario').selectedOptions[0].textContent,
  }));
  check('simulation labels', labels.tag === 'SIM NOW' && labels.clock.startsWith('SCENARIO') && /Simulation/.test(labels.badge) && labels.modes === 'Now/Replay' && /modeled/.test(labels.option), labels);
  await click('#crisisOff');
  await hashLike(/^(?!.*c=)/);
  st = await state();
  check('closing the crisis chip clears it from the URL', st.crisis === null && !/c=/.test(st.hash), st);

  // 3. Selecting a facility pushes it into the URL; Escape clears it.
  await page.evaluate(() => TWIN.app.select(TWIN.app.geo.facilities.findIndex((f) => f.id === 'HSP-WMR'), { fly: false }));
  await hashLike(/[?&]a=HSP-WMR/);
  st = await state();
  check('selection written to URL', /[?&]a=HSP-WMR/.test(st.hash), st);
  const tag = await page.evaluate(() => document.getElementById('feedTag').textContent);
  check('inspector feed labelled simulated', /· SIM/.test(tag) && !/LIVE/.test(tag), tag);

  // 4. Scrubbing writes the time; back returns to the previous selection state.
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

  // 5. Leaving the twin pauses it; the crisis page reads the twin's time; coming back resumes.
  await click('#nav a[data-nav="/crises"]');
  await pageReady();
  pg = await page.evaluate(() => ({ hash: location.hash, paused: TWIN.app.paused, asof: document.querySelector('.pg-asof').textContent }));
  check('twin → Crises tab keeps the context and pauses the twin', /^#\/crises\?city=raleigh&s=tropical&t=40&a=HSP-WMR$/.test(pg.hash) && pg.paused && /T\+34\.5h/.test(pg.asof), pg);
  await click('#nav a[data-nav="/twin"]');
  await ready(); await settle();
  st = await state();
  check('back on the twin: resumed with the same selection and time', !(await page.evaluate(() => TWIN.app.paused)) && st.sel === 'HSP-WMR' && st.t === 40, st);

  // 6. Deep link on a fresh load: scenario, time and selection restored.
  await page.goto('about:blank');
  await page.goto(base + '#/twin?city=raleigh&s=flash&t=40&a=HSP-WMR', { waitUntil: 'domcontentloaded' });
  await ready(); await until(() => TWIN.app.state.selected != null, null, 30000); await settle();
  st = await state();
  check('fresh deep link restores scenario, time, selection', st.scenario === 'flash' && st.t === 40 && st.sel === 'HSP-WMR' && st.mode === 'live' && st.hash === '#/twin?city=raleigh&s=flash&t=40&a=HSP-WMR', st);
  if (out) await page.screenshot({ path: `${out}/routes-deeplink.png` });
  // An in-page link that changes scenario, mode and time together.
  await page.evaluate(() => { location.hash = '#/twin?s=tropical&t=20&m=replay'; });
  await until(() => TWIN.app.state.scenario === 'tropical' && TWIN.app.state.mode === 'historical', null, 30000).catch(() => {});
  await settle();
  st = await state();
  check('in-page link applies scenario, replay mode and time', st.scenario === 'tropical' && st.mode === 'historical' && st.t === 20 && /m=replay/.test(st.hash), st);

  // 7. Editing the address bar applies the change without a reload.
  await page.evaluate(() => { location.hash = '#/twin?s=tropical&a=EMS-02'; });
  await until(() => TWIN.app.state.selected != null && TWIN.app.geo.facilities[TWIN.app.state.selected].id === 'EMS-02', null, 20000).catch(() => {});
  await settle();
  st = await state();
  check('hash edit applies selection and mode', st.sel === 'EMS-02' && st.mode === 'live', st);

  // 8. Unknown facility and scenario are dropped; unknown paths go to the overview.
  await page.evaluate(() => { location.hash = '#/twin?s=nope&a=NOPE'; });
  await settle(); await page.waitForTimeout(600);
  st = await state();
  check('unknown values dropped from URL', !/nope|NOPE/.test(st.hash), st);
  await page.evaluate(() => { location.hash = '#/nowhere?s=tropical'; });
  await pageReady();
  const nf = await page.evaluate(() => ({ hash: location.hash, toast: document.getElementById('siteToast').innerText }));
  check('unknown path → overview with a note', /^#\/\?/.test(nf.hash) && /no page/i.test(nf.toast), nf);

  // 9. The twin without a city opens the default city: its data, clock, scenarios and systems.
  await page.goto('about:blank');
  await page.goto(base + '#/twin', { waitUntil: 'domcontentloaded' });
  await ready(); await settle();
  st = await state();
  const ng = await page.evaluate(() => ({ title: document.getElementById('brandTitle').textContent, clock: document.getElementById('clockD').textContent, telecom: !!document.getElementById('ly-telecom'), options: document.getElementById('scenario').options.length }));
  check('twin link without a city opens Nagpur on its own scenarios and clock', st.city === 'nagpur' && st.scenario === 'monsoon2023' && st.nowT >= 37 && st.nowT < 42 && /Nagpur/.test(ng.title) && /IST/.test(ng.clock) && ng.telecom && ng.options === 7 && /city=nagpur&s=monsoon2023/.test(st.hash), { st, ng });
  // The crisis pages follow the city; a crisis that is not in the registry says when it is.
  await page.evaluate(() => { location.hash = '#/crises/CR-NAG-5627?t=37'; });
  await pageReady();
  pg = await page.evaluate(() => ({ hash: location.hash, h1: document.querySelector('#page h1').textContent, clock: document.querySelector('.pg-asof').textContent }));
  check('Nagpur crisis detail at T+37', /city=nagpur&s=monsoon2023&t=37/.test(pg.hash) && /Urban flood/.test(pg.h1) && /CR-NAG-5627/.test(pg.h1) && /T\+37\.0h \(FRI 19:00\)/.test(pg.clock), pg);
  await page.evaluate(() => { location.hash = '#/crises/CR-NAG-0000'; });
  await pageReady();
  pg = await page.evaluate(() => ({ lede: document.querySelector('.pg-lede').textContent, hist: document.getElementById('crHist').textContent }));
  check('unknown crisis id → "not in the registry" with its history', /Not in the registry/.test(pg.lede) && /does not appear/.test(pg.hist), pg);
  // Switching city from the address bar on the twin reloads into it.
  await page.evaluate(() => { location.hash = '#/twin?city=raleigh'; });
  await page.waitForTimeout(1500);
  await ready(); await settle();
  st = await state();
  check('city change reloads into Raleigh', st.city === 'raleigh' && st.scenario === 'tropical', st);

  console.log('console errors:', errors.length ? '\n  ' + [...new Set(errors)].join('\n  ') : 'none');
  console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
  await browser.close();
  process.exit(fails || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

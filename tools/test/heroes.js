// Hero-model check: select facilities of each model type, wait for the model, screenshot.
//   node tools/test/heroes.js <url> <outdir> [name ...]
// Also scrubs the clock to show the daylight cycle on the first facility.
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8765/index.html';
  const out = process.argv[3] || '.';
  const names = process.argv.slice(4);
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], proxy });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  // Poll with evaluate: waitForFunction compiles its predicate with eval, which a strict
  // CSP (the single-page build under tools/test/csp_server.py) refuses.
  const until = async (fn, arg, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn, arg)) return; await page.waitForTimeout(250); } throw new Error('timed out'); };
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await until(() => !document.getElementById('loading'), null, 90000);
  await page.waitForTimeout(3500);
  const idle = () => page.evaluate(() => new Promise((r) => { const m = TWIN.app.map; const done = () => (TWIN.app.buildings && TWIN.app.buildings.stats.queued) ? setTimeout(done, 200) : r(); if (m.loaded() && m.areTilesLoaded()) done(); else m.once('idle', done); setTimeout(r, 20000); }));
  const list = names.length ? names : ['Duke Raleigh Hospital', 'Wake County EMS Station 2', 'Lake Boone Pumping Station', 'Warehouse District Substation', 'Capital Blvd at Peace St', 'Weather Station, Nash Square'];
  let first = true;
  for (const name of list) {
    const i = await page.evaluate((n) => TWIN_GEO.facilities.findIndex((f) => f.name.includes(n)), name);
    if (i < 0) { console.log('not found:', name); continue; }
    const t0 = Date.now();
    await page.evaluate((k) => TWIN.app.select(k, { fly: true }), i);
    await until((k) => TWIN.app.heroes.active === k, i, 60000).catch(() => console.log('hero not active:', name));
    await page.waitForTimeout(1500);
    await idle();
    const f = await page.evaluate((k) => { const f = TWIN_GEO.facilities[k]; return { name: f.name, type: f.type, subtype: f.subtype, model: TWIN.heroes.MODEL_OF(f), zoom: TWIN.app.map.getZoom().toFixed(2) }; }, i);
    console.log(JSON.stringify(f), Date.now() - t0, 'ms');
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await page.screenshot({ path: `${out}/hero-${slug}.png` });
    // Close-up of the model itself.
    await page.evaluate(() => { const m = TWIN.app.map; m.jumpTo({ zoom: m.getZoom() + 1.3 }); });
    await page.waitForTimeout(600);
    await idle();
    await page.screenshot({ path: `${out}/hero-${slug}-close.png`, clip: { x: 330, y: 150, width: 920, height: 640 } });
    await page.evaluate(() => { const m = TWIN.app.map; m.jumpTo({ zoom: m.getZoom() - 1.3 }); });
    if (first) {
      first = false;
      // Daylight: dawn, noon, dusk, night on the first facility.
      for (const [label, t] of [['dawn', 32], ['noon', 37], ['dusk', 42], ['night', 46]]) {
        await page.evaluate((tt) => { TWIN.app.scrub(tt); TWIN.app.scrubEnd(); }, t);
        await page.waitForTimeout(900);
        await idle();
        await page.screenshot({ path: `${out}/hero-${slug}-${label}.png` });
      }
      await page.evaluate(() => { TWIN.app.scrub(34.5); TWIN.app.scrubEnd(); });
    }
  }
  console.log('errors:', errors.length ? '\n  ' + [...new Set(errors)].slice(0, 25).join('\n  ') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

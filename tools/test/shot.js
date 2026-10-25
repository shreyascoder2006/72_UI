// Scripted screenshots for visual checks.
//   node tools/test/shot.js <url> <outdir> '<json steps>'
// Steps: {"time":37} {"layers":{"power":false}} {"select":"Duke Raleigh"} {"camera":{...jumpTo}}
//        {"wait":1000} {"shot":"name"} {"clip":[x,y,w,h]} {"eval":"js"}
const { chromium } = require('playwright');
(async () => {
  const [url, out, json] = process.argv.slice(2);
  const steps = JSON.parse(json || '[]');
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], proxy });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true })).newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 90000 });
  await page.waitForTimeout(3000);
  const idle = () => page.evaluate(() => new Promise((r) => { const m = TWIN.app.map; const done = () => (TWIN.app.buildings && TWIN.app.buildings.stats.queued) ? setTimeout(done, 200) : r(); if (m.loaded() && m.areTilesLoaded()) done(); else m.once('idle', done); setTimeout(r, 10000); }));
  let clip = null;
  for (const s of steps) {
    if (s.time != null) await page.evaluate((t) => { TWIN.app.scrub(t); TWIN.app.scrubEnd(); }, s.time);
    if (s.layers) await page.evaluate((L) => { for (const [k, v] of Object.entries(L)) TWIN.app.setLayer(k, v); }, s.layers);
    if (s.select) {
      await page.evaluate((n) => { const i = TWIN_GEO.facilities.findIndex((f) => f.name.includes(n)); TWIN.app.select(i, { fly: true }); }, s.select);
      await page.waitForTimeout(2600);
    }
    if (s.camera) await page.evaluate((c) => { TWIN.app.map.stop(); TWIN.app.map.jumpTo(c); }, s.camera);
    if (s.eval) console.log(JSON.stringify(await page.evaluate(s.eval)));
    if (s.clip) clip = s.clip.length ? { x: s.clip[0], y: s.clip[1], width: s.clip[2], height: s.clip[3] } : null;
    if (s.wait) await page.waitForTimeout(s.wait);
    if (s.shot) { await page.waitForTimeout(500); await idle(); await page.waitForTimeout(300); await page.screenshot({ path: `${out}/${s.shot}.png`, ...(clip ? { clip } : {}) }); }
  }
  console.log('errors:', errors.length ? '\n  ' + [...new Set(errors)].slice(0, 20).join('\n  ') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

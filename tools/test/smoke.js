// Headless smoke test: load the twin, exercise the main interactions, save screenshots.
//   node tools/test/smoke.js <url> <outdir>
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8765/index.html';
  const out = process.argv[3] || '.';
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], proxy });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errors = [], failed = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('requestfailed', (r) => failed.push(`${r.failure() && r.failure().errorText} ${r.url()}`));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 90000 });
  console.log('ready in', Date.now() - t0, 'ms');
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${out}/01-overview.png` });
  const info = await page.evaluate(() => ({
    renderer: TWIN.app.tm.renderer,
    layers: TWIN.app.map.getStyle().layers.length,
    tilesLoaded: TWIN.app.map.areTilesLoaded(),
    buildings: TWIN.app.map.queryRenderedFeatures({ layers: ['building-3d'] }).length,
    flows: TWIN.app.map.getSource('flows')._data.features.length,
    alerts: document.querySelectorAll('.alert').length,
    crit: document.getElementById('assetCrit').textContent,
    strip: document.getElementById('strip').innerText.replace(/\n/g, ' '),
  }));
  console.log(JSON.stringify(info));
  // Select WakeMed via the list
  await page.click('.row:has-text("WakeMed Raleigh Campus")');
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${out}/02-wakemed.png` });
  // Dependency graph
  await page.click('#btnGraph');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/03-graph.png` });
  // Interventions
  await page.click('#btnPlan');
  await page.waitForTimeout(2500);
  await page.click('#recBtn');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/04-plan.png` });
  await page.click('#btnPlan');
  // Alert click → fly + highlight
  await page.click('.alert >> nth=2');
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${out}/05-alert.png` });
  // Historical + validation
  await page.click('#modeHist');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/06-valid.png` });
  console.log('errors:', errors.length ? '\n  ' + errors.slice(0, 25).join('\n  ') : 'none');
  console.log('failed requests:', failed.length ? '\n  ' + failed.slice(0, 15).join('\n  ') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

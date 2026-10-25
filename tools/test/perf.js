// Frame times downtown with the city-building renderer in three configurations.
//   node tools/test/perf.js <url> [gpu]
// Default runs on SwiftShader (as the other headless tests); "gpu" asks Chromium for the
// hardware GPU. Each configuration loads the page fresh with TWIN_CONFIG overrides, waits
// for the tiles, then times rendered frames with gl.finish(): "static" frames reuse the
// cached shadow map, "moving" frames pan the camera so the shadow pass re-renders.
const { chromium } = require('playwright');
// The bare URL opens the overview of the default city; these checks are about Raleigh's
// twin (pass a URL with a hash for another page or city).
const twinUrl = (u) => (u.includes('#') ? u : u + '#/twin?city=raleigh');
(async () => {
  const url = twinUrl(process.argv[2] || 'http://127.0.0.1:8765/index.html');
  const gpu = process.argv[3] === 'gpu';
  const args = gpu ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const browser = await chromium.launch({ args });
  const CAM = { center: [-78.6405, 35.7765], zoom: 16.4, pitch: 60, bearing: -20 };
  const configs = [
    ['shadows', { cityBuildings: true, buildingShadows: true }],
    ['no shadows', { cityBuildings: true, buildingShadows: false }],
    ['fill-extrusion', { cityBuildings: false }],
  ];
  for (const [label, cfg] of configs) {
    const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
    await page.addInitScript((c) => { window.TWIN_CONFIG = c; }, cfg);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 120000 });
    await page.evaluate((c) => { const a = TWIN.app; a.setLayer('weather', false); a.map.stop(); a.map.jumpTo(c); }, CAM);
    await page.evaluate(() => new Promise((r) => {
      const m = TWIN.app.map;
      const done = () => (TWIN.app.buildings && TWIN.app.buildings.stats.queued) ? setTimeout(done, 200) : r();
      const go = () => (m.loaded() && m.areTilesLoaded() ? done() : m.once('idle', done));
      setTimeout(go, 500); setTimeout(r, 60000);
    }));
    const res = await page.evaluate(async (c) => {
      const m = TWIN.app.map, gl = m.painter.context.gl;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const frame = () => new Promise((r) => { m.once('render', () => { gl.finish(); r(); }); m.triggerRepaint(); });
      const time = async (n, move) => {
        const ts = [];
        for (let i = 0; i < n; i++) {
          if (move) m.jumpTo({ center: [c.center[0] + (i % 2 ? 0.0012 : -0.0012), c.center[1]] });
          const t0 = performance.now(); await frame(); ts.push(performance.now() - t0);
        }
        ts.sort((a, b) => a - b);
        return { median: Math.round(ts[n >> 1]), max: Math.round(ts[n - 1]) };
      };
      const passes = () => (TWIN.app.buildings ? TWIN.app.buildings.stats.shadowPasses : 0);
      await frame(); await frame();
      const p0 = passes();
      const stat = await time(9, false);
      const p1 = passes();
      const move = await time(9, true);
      stat.shadowPasses = p1 - p0; move.shadowPasses = passes() - p1;
      return { gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?', static: stat, moving: move, stats: TWIN.app.buildings ? TWIN.app.buildings.stats : null };
    }, CAM);
    console.log(label.padEnd(15), JSON.stringify(res));
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

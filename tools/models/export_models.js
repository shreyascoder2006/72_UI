// Build the facility hero models in headless Chromium and write data/models/*.glb.
//   node tools/models/export_models.js [previewDir]
// Needs Playwright with a Chromium build, and network access to cdn.jsdelivr.net (three.js).
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'data', 'models');
const previewDir = process.argv[2];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(8771, '127.0.0.1', r));
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], proxy });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true })).newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text()); });
  await page.goto('http://127.0.0.1:8771/tools/models/build.html');
  await page.waitForFunction(() => window.__ready, null, { timeout: 240000 });
  console.log(JSON.stringify(await page.evaluate(() => window.__stats), null, 0));

  // Generated decals → textures/gen_*.png
  const gen = await page.evaluate(() => window.__gen);
  for (const [k, url] of Object.entries(gen)) fs.writeFileSync(path.join(OUT, 'textures', `gen_${k}.png`), Buffer.from(url.split(',')[1], 'base64'));

  if (previewDir) {
    fs.mkdirSync(previewDir, { recursive: true });
    const views = { hospital: {}, ems: { camAz: 25 }, pump: { camAz: 30 }, substation: { camAz: 25 }, traffic: { camAz: 40, camEl: 40 }, weather: { camAz: 30, camEl: 26, dist: 1.9 } };
    for (const [name, opts] of Object.entries(views)) {
      await page.evaluate(([n, o]) => window.renderPreview(n, o), [name, opts]);
      await page.locator('canvas').screenshot({ path: path.join(previewDir, `${name}.png`) });
    }
  }
  const glbs = await page.evaluate(() => window.exportAll());
  for (const [name, b64] of Object.entries(glbs)) {
    const file = path.join(OUT, `${name}.glb`);
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  }
  await browser.close();
  server.close();
  // Point images at the external texture files and drop the placeholders.
  execFileSync('python3', ['-I', path.join(__dirname, 'externalize.py'), OUT], { stdio: 'inherit' });
})().catch((e) => { console.error(e); process.exit(1); });

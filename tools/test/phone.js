// Phone-width check: no horizontal overflow on the twin and the pages, drawer opens,
// inspector covers the screen.
const { chromium } = require('playwright');
// The bare URL opens the overview of the default city; these checks are about Raleigh's
// twin (pass a URL with a hash for another page or city).
const twinUrl = (u) => (u.includes('#') ? u : u + '#/twin?city=raleigh');
(async () => {
  const url = twinUrl(process.argv[2] || 'http://127.0.0.1:8765/index.html'), out = process.argv[3] || '.';
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(url);
  await p.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 90000 });
  await p.waitForTimeout(3000);
  await p.screenshot({ path: `${out}/10-phone.png` });
  console.log('horizontal overflow:', await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1));
  await p.tap('#drawerBtn'); await p.waitForTimeout(700);
  await p.screenshot({ path: `${out}/11-phone-drawer.png` });
  await p.tap('.row >> nth=0'); await p.waitForTimeout(2500);
  await p.screenshot({ path: `${out}/12-phone-inspector.png` });
  // Overview and crisis registry
  for (const [name, path] of [['13-phone-overview', '/'], ['14-phone-crises', '/crises']]) {
    await p.evaluate((h) => { location.hash = '#' + h; }, path);
    const t = Date.now();
    while (Date.now() - t < 60000 && !(await p.evaluate(() => { const g = document.getElementById('page'); return !document.getElementById('site').hidden && g.querySelector('.pg-wrap') && !g.querySelector('.loading-bar'); }))) await p.waitForTimeout(250);
    await p.screenshot({ path: `${out}/${name}.png` });
    console.log(`${name} horizontal overflow:`, await p.evaluate(() => { const g = document.getElementById('page'); return document.documentElement.scrollWidth > window.innerWidth + 1 || g.scrollWidth > g.clientWidth + 1; }));
  }
  console.log('errors:', errors.length ? errors.join(' | ') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

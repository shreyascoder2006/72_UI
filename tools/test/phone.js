// Phone-width check: no horizontal overflow, drawer opens, inspector covers the screen.
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8765/index.html', out = process.argv[3] || '.';
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
  console.log('errors:', errors.length ? errors.join(' | ') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

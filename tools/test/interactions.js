// Interaction test: streaming replay, scenario switch, phone viewport.
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:8765/index.html', out = process.argv[3] || '.';
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.click('#speed'); await page.click('#speed'); // 8x
  await page.click('#trigger');
  await page.waitForFunction(() => TWIN.app.state.t > 26, null, { timeout: 60000 });
  await page.screenshot({ path: `${out}/07-stream.png` });
  const s = await page.evaluate(() => ({ t: TWIN.app.state.t, nowT: TWIN.app.state.nowT, streaming: TWIN.app.state.streaming, toast: document.getElementById('toast').innerText, tag: document.getElementById('clockTag').textContent }));
  console.log('stream', JSON.stringify(s));
  await page.click('#reset');
  await page.waitForTimeout(800);
  // forecast scrub
  await page.evaluate(() => { TWIN.app.scrub(46); TWIN.app.scrubEnd(); });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/08-forecast.png` });
  console.log('forecast tag', await page.textContent('#clockTag'));
  // scenario switch
  await page.selectOption('#scenario', 'heat');
  await page.waitForFunction(() => TWIN.app.engine.scen.id === 'heat' && !document.querySelector('.loading:not(.done)'), null, { timeout: 60000 });
  await page.evaluate(() => { TWIN.app.scrub(42); TWIN.app.scrubEnd(); });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${out}/09-heat.png` });
  // phone
  const m = await browser.newContext({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p2 = await m.newPage();
  p2.on('pageerror', (e) => errors.push('[mobile pageerror] ' + e.message));
  await p2.goto(url);
  await p2.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 90000 });
  await p2.waitForTimeout(3000);
  await p2.screenshot({ path: `${out}/10-phone.png` });
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  console.log('phone horizontal overflow:', overflow);
  await p2.click('#drawerBtn'); await p2.waitForTimeout(600);
  await p2.screenshot({ path: `${out}/11-phone-drawer.png` });
  console.log('errors:', errors.length ? errors.join('\n  ') : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1860, height: 1200 }, deviceScaleFactor: 2 });
  for (const f of process.argv.slice(2)) {
    await p.goto('file://' + process.cwd() + '/' + f + '.html');
    await p.waitForTimeout(700);
    const el = await p.$('#f');
    const box = await el.boundingBox();
    await el.screenshot({ path: f + '.png' });
    console.log(f, Math.round(box.width) + 'x' + Math.round(box.height));
  }
  await b.close();
})();

const { chromium } = require('playwright');
const { mkdir } = require('node:fs/promises');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
(async () => {
  const directory = resolve(__dirname, '../docs/screenshots');
  await mkdir(directory, { recursive: true });
  const url = pathToFileURL(resolve(__dirname, '../index.html')).href;
  const browser = await chromium.launch();
  try {
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 1140 } });
    await desktop.goto(url); await desktop.locator('#start-button').waitFor();
    await desktop.screenshot({ path: resolve(directory, 'desktop.png'), fullPage: true });
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await mobile.goto(url); await mobile.locator('#start-button').waitFor();
    await mobile.screenshot({ path: resolve(directory, 'mobile.png'), fullPage: true });
    const playing = await browser.newPage({ viewport: { width: 1440, height: 1140 } });
    await playing.clock.install({ time: new Date('2026-10-04T06:00:00Z') });
    await playing.clock.pauseAt(new Date('2026-10-04T06:00:01Z'));
    await playing.addInitScript(() => {
      let seed = 71;
      Math.random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
    });
    await playing.goto(url);
    await playing.locator('[data-mode="arcade"]').click();
    await playing.locator('[data-difficulty="hard"]').click();
    await playing.locator('#start-button').click();
    await playing.clock.runFor(9000);
    for (let i = 0; i < 3; i++) await playing.locator('.balloon.regular').first().click();
    await playing.clock.runFor(850);
    await playing.screenshot({ path: resolve(directory, 'playing.png'), fullPage: true });
    console.log('Captured desktop, mobile and live arcade previews in docs/screenshots/.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

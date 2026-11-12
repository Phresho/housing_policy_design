// The four closed main blocks carry an icon at the most zoomed-out level.
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:8001/'); await openPanels(page); await page.waitForTimeout(4000);
console.log(JSON.stringify({ icons: await page.locator('.block-icon svg').count() }));
await page.locator('.map-canvas').screenshot({ path: out + '/icons.png' }); process.exit(0);

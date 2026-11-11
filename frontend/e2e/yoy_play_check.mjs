// Tour step 10: Play runs the year-on-year (CBS) card through time: dot + year mid-play, no marker at the end.
// Usage: node e2e/yoy_play_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 });
await page.getByRole('button', { name: /^Step 10:/ }).click(); await page.locator('.tour-steps button.on', { hasText: /^10$/ }).waitFor({ timeout: 120000 }); await page.waitForTimeout(8000);
await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(1500);
const s = page.locator('.react-flow__node[data-id="sensor"]'); const b = await s.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(3000);
const info = { before: await page.locator('.chart-card.cbs .mini-year').allTextContents() };
await page.getByRole('button', { name: 'Play through time' }).click(); await page.waitForTimeout(1500);
info.mid = await page.locator('.chart-card.cbs .mini-year').allTextContents();
await page.locator('.map-body').screenshot({ path: out + '/yoy_play_mid.png', timeout: 60000 });
await page.waitForTimeout(8000);
info.end = await page.locator('.chart-card.cbs .mini-year').allTextContents();
console.log(JSON.stringify({ info, errors }, null, 1)); process.exit(0);

// Read-only check: full-width layout on a wide screen. Usage: node e2e/wide_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 2200, height: 1200 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await openPanels(page); await page.waitForSelector('.react-flow__node', { timeout: 60000 });
await page.locator('.left-dock').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForSelector('.year-slider', { timeout: 120000 }); await page.waitForTimeout(1500);
await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/w_1.png` });
await page.screenshot({ path: `${out}/w_2.png`, fullPage: true });
console.log('canvas width', Math.round((await page.locator('.map-canvas').boundingBox()).width), 'errors', errors); await browser.close();

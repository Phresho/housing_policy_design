// Screenshot button: downloads a PNG of the whole page at high resolution. Usage: node e2e/shot_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await openPanels(page); await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).waitFor();
await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForSelector('.year-slider', { timeout: 120000 });
await page.waitForTimeout(1500);
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.getByRole('button', { name: 'Screenshot' }).click()]);
const path = `${out}/${dl.suggestedFilename()}`; await dl.saveAs(path);
const size = await page.evaluate(() => [document.body.scrollWidth, document.body.scrollHeight]);
const alert = await page.locator('[role=alert]').allTextContents();
console.log(JSON.stringify({ path, page_css_px: size, errors, alert }));
await browser.close();

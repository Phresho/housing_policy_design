// Read-only check: CBS bars behind the year-on-year chart. Usage: node e2e/cbs_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).waitFor();
await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForSelector('.result-bar', { timeout: 180000 }); await page.waitForTimeout(2500);
const panel = page.locator('section.panel', { hasText: 'Yearly house price change' }).first();
console.log(await panel.locator('.note').first().textContent());
await panel.screenshot({ path: `${out}/cbs_1.png` });
console.log('errors', errors); await browser.close();

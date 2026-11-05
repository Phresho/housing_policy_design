// Read-only check: 'Fitted to CBS' preset and the year-on-year chart. Usage: node e2e/fit_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector('.react-flow__node', { timeout: 60000 });
await page.locator('.left-dock').getByRole('button', { name: 'Fitted to CBS' }).click();
await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForSelector('.result-bar', { timeout: 120000 }); await page.waitForTimeout(2000);
const panel = page.locator('section.panel', { hasText: 'Yearly house price change' }).first();
await panel.scrollIntoViewIfNeeded(); await panel.screenshot({ path: `${out}/fit_1.png` });
console.log('errors', errors); await browser.close();

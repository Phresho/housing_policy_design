// Read-only check: 'Fitted to CBS' preset and the year-on-year chart. Usage: node e2e/fit_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await openPanels(page); await page.waitForSelector('.react-flow__node', { timeout: 60000 });
await page.locator('.left-dock').getByRole('button', { name: 'Fitted to CBS' }).click();
await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForSelector('.result-bar', { timeout: 120000 }); await page.waitForTimeout(2000);
const panel = page.locator('section.panel').filter({ has: page.locator('figcaption', { hasText: /^House price$/ }) }).first();
await panel.scrollIntoViewIfNeeded(); await panel.screenshot({ path: `${out}/fit_price.png` });
console.log('errors', errors); await browser.close();

// Read-only check: bank switch and income path. Usage: node e2e/bank_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).waitFor();
await page.getByRole('button', { name: 'Stable growth' }).click();
await page.getByRole('button', { name: 'Original CPB model (no bank)' }).click();
await page.screenshot({ path: `${out}/b_1_scenario.png`, fullPage: true });
await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).click();
await page.waitForSelector('.result-bar', { timeout: 120000 });
await page.waitForTimeout(1200);
await page.locator('.react-flow__node[data-id="system"]').click({ position: { x: 20, y: 40 } }); await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/b_2_map.png` });
console.log('errors', errors);
await browser.close();

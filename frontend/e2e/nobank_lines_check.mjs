// Bank off: tour step 1 fits the opened market; with the Housing Market open and the CPB box closed, x1 and x2 leave
// the right side of the CPB box. Usage: node e2e/nobank_lines_check.mjs outdir
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/');
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 }); await page.waitForTimeout(3000);
await page.locator('.map-canvas').screenshot({ path: out + '/nobank_open.png', timeout: 30000 });
await page.getByRole('button', { name: 'Leave tour' }).click();
await page.getByRole('button', { name: 'Original CPB model (no bank)' }).click();
await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForTimeout(3000);
await page.getByRole('button', { name: 'Collapse all' }).click(); await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Expand Housing Market' }).first().click(); await page.waitForTimeout(2000);
await page.locator('.map-canvas').screenshot({ path: out + '/nobank_closed.png', timeout: 30000 });
console.log(JSON.stringify({ errors })); process.exit(0);

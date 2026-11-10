// CPB open: construction payments (x1) and new construction (x2) start on their rails and run to CBS; without and
// with the bank. Usage: node e2e/xlines_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels, pin } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.formulas .katex').first().waitFor({ timeout: 120000 }); await page.waitForTimeout(3000);
await page.locator('.map-canvas').screenshot({ path: out + '/xlines_nobank.png', timeout: 60000 });
await page.getByRole('button', { name: 'Leave tour' }).click();
await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForTimeout(3000);
await page.getByRole('button', { name: 'Collapse all' }).click(); await page.waitForTimeout(800);
await page.locator('.react-flow__node[data-id="system"]').click({ position: { x: 20, y: 40 } }); await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Expand CPB Four Quadrants' }).first().click(); await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(1200);
await page.locator('.map-canvas').screenshot({ path: out + '/xlines_bank.png', timeout: 60000 });
console.log(JSON.stringify({ errors })); process.exit(0);

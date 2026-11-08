// Identification with a chosen target (adjustment, cycle) and screenshots of the step plot. Usage: node e2e/ident_case.mjs [adjust] [cycle] [outdir]
import { chromium } from 'playwright-core';
const adjust = process.argv[2] ?? '8', cycle = process.argv[3] ?? '7.5', out = process.argv[4] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).waitFor();
await page.getByRole('button', { name: 'Identify system' }).click(); await page.locator('.ident-line').waitFor({ timeout: 30000 }); await page.waitForTimeout(1500);
const nums = page.locator('.ident-form input[type=number]');
await nums.first().fill(adjust); await page.locator('.ident-form input[type=checkbox]').check(); await nums.nth(1).fill(cycle);
await page.getByRole('button', { name: 'Fit parameters' }).click(); await page.locator('.ident-preview').waitFor({ timeout: 60000 }); await page.waitForTimeout(2500);
await page.locator('[aria-label="Step response of the house price to the subsidy"]').screenshot({ path: `${out}/ident_case_step.png` });
const boxes = await page.locator('[aria-label="Step response of the house price to the subsidy"] .annotation').evaluateAll(as => as.map(a => { const r = a.getBoundingClientRect(); return [a.textContent, Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; }).filter(b => /Peak|Trough/.test(b[0])));
const overlaps = []; for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (a[1] < b[3] && a[3] > b[1] && a[2] < b[4] && a[4] > b[2]) overlaps.push([a[0], b[0]]); }
console.log(JSON.stringify({ boxes, overlaps, errors }));
await browser.close();

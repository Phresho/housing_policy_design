// Rental subsidy off -> no u1 arrow on the canvas (also not inside the opened Households circuit). Usage: node e2e/rental_arrow_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).waitFor();
await page.waitForTimeout(1200);
const open = async id => { await page.locator(`.react-flow__node[data-id="${id}"]`).click({ position: { x: 20, y: 40 } }); await page.waitForTimeout(800); };
await open('system'); await open('cpb'); await open('households');
const count = async () => ({ u1: await page.locator('.react-flow').getByText('u1', { exact: true }).count(), rentalSignal: await page.locator('.u-signal').filter({ hasText: /rental/i }).count(), signals: await page.locator('.u-signal').count() });
const on = await count(); await page.screenshot({ path: `${out}/rental_on.png` });
await page.locator('label.check', { hasText: 'Rental subsidy' }).locator('input').uncheck(); await page.waitForTimeout(800);
const off = await count(); await page.screenshot({ path: `${out}/rental_off.png` });
console.log(JSON.stringify({ on, off, errors }));
await browser.close();

// Loop open -> Parliament (reference governor) and summing junction greyed. Usage: node e2e/loopoff_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await openPanels(page); await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).waitFor();
await page.waitForTimeout(1200);
const state = async () => page.evaluate(() => [...document.querySelectorAll('.map-node.reference, .map-node.summing')].map(n => n.className));
const open = await state(); await page.screenshot({ path: `${out}/loop_open.png` });
await page.getByRole('button', { name: 'Closed loop', exact: true }).first().click(); await page.waitForTimeout(800);
const closed = await state(); await page.screenshot({ path: `${out}/loop_closed.png` });
console.log(JSON.stringify({ open, closed, errors }));
await browser.close();

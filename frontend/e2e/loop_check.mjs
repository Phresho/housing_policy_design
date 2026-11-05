// Read-only check: loop arrows (r, e, x, y) open cards; step input is marked while tuning. Usage: node e2e/loop_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).waitFor();
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Closed loop' }).first().click();
await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForSelector('.year-slider', { timeout: 120000 }); await page.waitForTimeout(800);
const clickEdge = async id => { const b = await page.locator(`.react-flow__edge[data-id="${id}"] .rail-hit`).first().boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(400); };
for (const id of ['r', 'e', 'x1', 'yout']) await clickEdge(id);
console.log('cards', await page.locator('.pin-card strong').allTextContents());
await page.locator('.react-flow__node[data-id="controller"]').dispatchEvent('click'); await page.waitForTimeout(1200);
await page.getByRole('button', { name: /Whole model/ }).click(); await page.waitForTimeout(2500);
console.log('steps', (await page.locator('.pin-card small').allTextContents()).join(' | '));
console.log('marker', await page.getByText('Unit step +1 enters here').count());
await page.screenshot({ path: `${out}/lp_1.png` });
console.log('errors', errors); await browser.close();

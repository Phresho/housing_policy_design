// Read-only check: Bode card between two probes, S/T/KS card from the dock. Usage: node e2e/bode_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).waitFor();
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Closed loop' }).first().click(); await page.waitForTimeout(500);
const clickEdge = async id => { const b = await page.locator(`.react-flow__edge[data-id="${id}"] .rail-hit`).first().boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(400); };
await clickEdge('r'); await clickEdge('yout');
await page.locator('.pin-card').nth(0).getByRole('button', { name: 'Bode from here' }).click(); await page.waitForTimeout(200);
await page.locator('.pin-card').nth(1).getByRole('button', { name: 'Bode to here' }).click(); await page.waitForTimeout(2500);
console.log('bode cards', await page.locator('.chart-card.bode').count(), await page.locator('.chart-card.bode small').allTextContents());
await page.locator('.react-flow__node[data-id="controller"]').dispatchEvent('click'); await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Pin S, T, KS on the canvas' }).click(); await page.waitForSelector('.chart-card.sens .sens-row', { timeout: 90000 });
await page.getByRole('button', { name: /Whole model/ }).click(); await page.waitForTimeout(1500);
console.log('sens', await page.locator('.chart-card.sens .sens-row span').allTextContents());
await page.screenshot({ path: `${out}/b_1.png` });
const c = await page.locator('.chart-card.bode').boundingBox(); await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -200); await page.waitForTimeout(150); }
await page.waitForTimeout(500); await page.screenshot({ path: `${out}/b_2.png` });
console.log('errors', errors); await browser.close();

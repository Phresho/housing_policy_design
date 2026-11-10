// Read-only check: signal arrows open cards; cards show step responses while tuning. Usage: node e2e/step_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await openPanels(page); await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).waitFor();
await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Closed loop' }).first().click();
await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForSelector('.year-slider', { timeout: 120000 });
await page.locator('.react-flow__node[data-id="system"]').click({ position: { x: 20, y: 40 } }); await page.waitForTimeout(1500);
console.log('edges', (await page.locator('.react-flow__edge').evaluateAll(es => es.map(e => e.getAttribute('data-id')))).join(',')); const clickEdge = async id => { console.log('click', id); const b = await page.locator(`.react-flow__edge[data-id="${id}"] .rail-hit`).first().boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(500); };
await clickEdge('u2'); await clickEdge('d_crisis'); await clickEdge('mortgages');
console.log('cards', await page.locator('.pin-card').count(), await page.locator('.pin-card strong').allTextContents());
await page.locator('.react-flow__node[data-id="controller"]').dispatchEvent('click'); await page.waitForTimeout(3000);
console.log('step mode', await page.locator('.pin-card.step-mode').count(), (await page.locator('.pin-card small').allTextContents()).join(' | '));
await page.screenshot({ path: `${out}/st_1.png` });
for (let i = 0; i < 5; i++) { await page.getByRole('button', { name: 'Kp up 10%' }).first().click(); await page.waitForTimeout(100); }
await page.waitForTimeout(2000);
console.log('after Kp up', (await page.locator('.pin-card small').allTextContents()).join(' | '));
await page.getByRole('button', { name: /Whole model/ }).click(); await page.waitForTimeout(1000); const cb = await page.locator('.pin-card').first().boundingBox(); await page.mouse.move(cb.x + 40, cb.y + 40); for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -250); await page.waitForTimeout(150); } await page.waitForTimeout(600); await page.screenshot({ path: `${out}/st_2.png` });
console.log('errors', errors); await browser.close();

// Read-only check: headers scale with zoom; pinned plots can be dragged. Usage: node e2e/drag_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).waitFor();
await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForSelector('.result-bar', { timeout: 120000 });
await page.waitForTimeout(1200);
await page.locator('.react-flow__node[data-id="system"]').click({ position: { x: 20, y: 40 } }); await page.waitForTimeout(1200);
await page.locator('.react-flow__node[data-id="finance"]').click({ position: { x: 20, y: 40 } }); await page.waitForTimeout(1200);
await page.locator('.probe-hit').nth(1).dispatchEvent('click'); await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Pin on canvas' }).click(); await page.waitForTimeout(400);
await page.getByRole('button', { name: /Whole model/ }).click(); await page.waitForTimeout(1000);
const box = await page.locator('.react-flow__viewport').boundingBox(), c = await page.locator('.map-canvas').boundingBox();
for (let i = 0; i < 3; i++) { await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2); await page.mouse.wheel(0, 300); await page.waitForTimeout(150); }
await page.waitForTimeout(500); await page.screenshot({ path: `${out}/d_1_zoomed_out.png` });
await page.getByRole('button', { name: /Whole model/ }).click(); await page.waitForTimeout(1000);
const card = page.locator('.pin-card'); const b = await card.boundingBox(); console.log('node class', await page.locator('.react-flow__node-pin').getAttribute('class'), b); const top = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e.className.baseVal ?? e.className; }, [b.x + b.width / 2, b.y + b.height / 2]); console.log('top element', top);
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x - 200, b.y + 200, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(400);
const b2 = await card.boundingBox(); console.log('moved', Math.round(b2.x - b.x), Math.round(b2.y - b.y));
await page.screenshot({ path: `${out}/d_2_dragged.png` });
console.log('errors', errors); await browser.close();

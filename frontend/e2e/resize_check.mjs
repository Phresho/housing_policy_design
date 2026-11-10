// Read-only check: cards on the canvas can be resized. Usage: node e2e/resize_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await openPanels(page); await page.waitForSelector('.react-flow__node', { timeout: 60000 });
await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForSelector('.year-slider', { timeout: 120000 }); await page.waitForTimeout(800);
await page.evaluate(() => window.scrollTo(0, 0));
const e = await page.locator('.react-flow__edge[data-id="u2"] .rail-hit').first().boundingBox(); await page.mouse.click(e.x + e.width / 2, e.y + e.height / 2 + 120); await page.waitForTimeout(200);
await page.mouse.click(e.x + e.width / 2, e.y + e.height / 2); await page.waitForTimeout(600);
const card = page.locator('.pin-card').first(); const b = await card.boundingBox();
console.log('handles', await card.locator('.card-resize').count(), JSON.stringify(await card.locator('.card-resize').evaluate(e => { const s = getComputedStyle(e); return [s.position, s.width, s.height, e.getBoundingClientRect().toJSON()]; }))); const h = await card.locator('.card-resize').boundingBox(); console.log('elementAt', await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className, [h.x + h.width / 2, h.y + h.height / 2]));
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down(); await page.mouse.move(h.x + 300, h.y + 200, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(400);
const b2 = await card.boundingBox(); console.log('card', Math.round(b.width), 'x', Math.round(b.height), '->', Math.round(b2.width), 'x', Math.round(b2.height), 'svg width', await card.locator('svg').first().getAttribute('width'));
await card.screenshot({ path: `${out}/rs_1.png` });
console.log('errors', errors); await browser.close();

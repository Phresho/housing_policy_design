// Card buttons hidden behind the arrow. Usage: node e2e/pintools_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 3 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).waitFor();
await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForSelector('.year-slider', { timeout: 120000 });
await page.getByRole('button', { name: 'Identify system' }).click(); await page.locator('.pin-card').first().waitFor(); await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Collapse panel' }).click(); await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(1200); { const m = await page.locator('.map-canvas').boundingBox(); await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2); for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 250); await page.waitForTimeout(120); } await page.waitForTimeout(500); } const card = page.locator('.pin-card').first();
const before = await card.locator('.pin-head button').allInnerTexts();
{ const b = await card.boundingBox(); await page.screenshot({ path: `${out}/pintools_closed.png`, clip: b }); }
await card.getByRole('button', { name: 'Show the card buttons' }).click(); await page.waitForTimeout(200);
const after = await card.locator('.pin-head button').allInnerTexts(); const cbb = await card.boundingBox(); const btns = await card.locator('.pin-head button').evaluateAll(bs => bs.map(b => { const r = b.getBoundingClientRect(); return [b.innerText, Math.round(r.left), Math.round(r.right)]; })); const tl = await card.locator('.pin-tools').evaluate(e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return [Math.round(r.left), Math.round(r.right), cs.position, cs.right]; }); console.log(JSON.stringify({ card: [Math.round(cbb.x), Math.round(cbb.x + cbb.width)], btns, tl }));
const cb = await card.boundingBox(), tb = await card.locator('.pin-tools').boundingBox(); console.log(JSON.stringify({ cardRight: cb.x + cb.width, toolsRight: tb.x + tb.width })); { const b = await card.boundingBox(); await page.screenshot({ path: `${out}/pintools_open.png`, clip: b }); }
console.log(JSON.stringify({ before, after, errors }));
await browser.close();

// Read-only check: left scenario dock and the CBS card from the sensor. Usage: node e2e/left_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await openPanels(page); await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).waitFor();
await page.waitForTimeout(1000);
console.log('left dock', await page.locator('.left-dock h3').textContent());
await page.locator('.left-dock').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForSelector('.year-slider', { timeout: 120000 }); await page.waitForTimeout(800);
const s = await page.locator('.react-flow__node[data-id="sensor"]').boundingBox(); await page.mouse.click(s.x + s.width / 2, s.y + s.height / 2); await page.waitForTimeout(800);
console.log('cbs card', await page.locator('.chart-card.cbs').count(), await page.locator('.chart-card.cbs small').textContent());
await page.screenshot({ path: `${out}/left_1.png` });
const c = await page.locator('.chart-card.cbs').boundingBox(); await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -250); await page.waitForTimeout(150); }
await page.waitForTimeout(500); await page.screenshot({ path: `${out}/left_2.png` });
console.log('errors', errors); await browser.close();

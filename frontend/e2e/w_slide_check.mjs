// Preset 'W crisis (slide)': run it, open the market and pin the firms crisis shock; the card shows a W.
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page); await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'W crisis (slide)' }).click(); await page.waitForTimeout(500);
await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForTimeout(12000);
await page.locator('.react-flow__node[data-id="system"] button').first().dispatchEvent('click'); await page.waitForTimeout(1500);
await page.locator('.react-flow__controls-fitview').click(); await page.waitForTimeout(1500);
const e = page.locator('.react-flow__edge[data-id="d_crisis"] path').last(); const b = await e.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(1000);
await page.getByRole('button', { name: 'Play through time' }).click(); await page.waitForTimeout(9000);
const c = await page.locator('.pin-card').first().boundingBox();
await page.screenshot({ path: out + '/w_slide.png', clip: { x: c.x - 4, y: c.y - 4, width: c.width + 8, height: c.height + 8 } });
console.log(JSON.stringify({ title: await page.locator('.pin-card .pin-head strong').first().textContent(), errors })); process.exit(0);

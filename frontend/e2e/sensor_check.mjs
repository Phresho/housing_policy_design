// Read-only check: two measurements into CBS. Usage: node e2e/sensor_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).waitFor();
await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForSelector('.result-bar', { timeout: 120000 });
await page.waitForTimeout(1200);
await page.locator('.react-flow__node[data-id="sensor"]').click(); await page.waitForTimeout(500);
const box = await page.locator('.react-flow__node[data-id="sensor"]').boundingBox();
await page.screenshot({ path: `${out}/s_1.png`, clip: { x: box.x - 330, y: box.y - 80, width: 560, height: 260 } });
await page.screenshot({ path: `${out}/s_2.png` });
console.log('errors', errors); await browser.close();

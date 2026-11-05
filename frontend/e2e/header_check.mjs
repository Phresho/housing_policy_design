// Read-only check: sticky block headers at each zoom level. Usage: node e2e/header_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).waitFor();
await page.waitForTimeout(1200);
const click = async id => { await page.locator(`.react-flow__node[data-id="${id}"]`).click({ position: { x: 20, y: 40 } }); await page.waitForTimeout(1000); };
await page.screenshot({ path: `${out}/h_0_loop.png` }); await click('system'); await page.screenshot({ path: `${out}/h_1_markets.png` });
await click('cpb'); await page.screenshot({ path: `${out}/h_2_agents.png` });
await click('investors'); await page.screenshot({ path: `${out}/h_3_investor.png` });
const box = await page.locator('.map-canvas').boundingBox();
for (let i = 0; i < 6; i++) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -300); await page.waitForTimeout(150); }
await page.waitForTimeout(500); await page.screenshot({ path: `${out}/h_4_zoomed.png` });
console.log('heads', await page.locator('.sticky-head strong').allTextContents(), 'errors', errors);
await browser.close();

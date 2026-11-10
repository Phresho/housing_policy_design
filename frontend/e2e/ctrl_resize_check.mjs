// Opened controller: drag the corner grip to make the block bigger; double-click resets it.
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page); await page.waitForTimeout(2000);
await page.locator('.react-flow__node[data-id="controller"] button.toggle').first().dispatchEvent('click'); await page.waitForTimeout(1500);
const node = page.locator('.react-flow__node[data-id="controller"]');
const before = await node.boundingBox(); const g = await page.locator('.block-grip').boundingBox();
await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(g.x + g.width / 2 + i * 15, g.y + g.height / 2 + i * 8); await page.waitForTimeout(40); }
await page.mouse.up(); await page.waitForTimeout(1000);
const after = await node.boundingBox();
await page.locator('.map-body').screenshot({ path: out + '/ctrl_resize.png', timeout: 60000 });
{ const g2 = await page.locator('.block-grip').boundingBox(); const cx = g2.x + g2.width / 2, cy = g2.y + g2.height / 2; await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(80); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(1000); }
const reset = await node.boundingBox();
console.log(JSON.stringify({ before: [Math.round(before.width), Math.round(before.height)], after: [Math.round(after.width), Math.round(after.height)], reset: [Math.round(reset.width), Math.round(reset.height)], errors })); process.exit(0);

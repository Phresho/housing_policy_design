// Canvas pickers are hidden until their block is clicked: none at the start, the market ones after opening the
// Housing Market, the subsidy picker after clicking the Tax Authority. Usage: node e2e/chips_hidden_check.mjs
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page); await page.waitForTimeout(3000);
const n = () => page.locator('.chip-wrap').count(), r = { start: await n() };
await page.locator('.react-flow__node[data-id="system"]').click(); await page.waitForTimeout(2000); r.market = await n();
await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(1200);
await page.locator('.react-flow__node[data-id="controller"]').click(); await page.waitForTimeout(2000); r.ctrl = await n();
console.log(JSON.stringify({ r, errors })); process.exit(0);

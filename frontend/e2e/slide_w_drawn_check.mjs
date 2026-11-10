// Tour step 7: the fitted (slow) W is simulated; the firms crisis-shock card draws the slide W.
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
const runs = []; page.on('request', r => { if (r.url().endsWith('/api/runs') && r.method() === 'POST') { const b = JSON.parse(r.postData()); runs.push([b.crisis_w_fall_yr, b.crisis_w_start_yr]); } });
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 });
await page.getByRole('button', { name: /^Step 7:/ }).click(); await page.locator('.tour-steps button.on', { hasText: /^7$/ }).waitFor({ timeout: 120000 }); await page.waitForTimeout(9000);
await page.locator('.react-flow__node[data-id="system"] button').first().dispatchEvent('click'); await page.waitForTimeout(1500);
await page.locator('.react-flow__controls-fitview').click(); await page.waitForTimeout(1500);
const e = page.locator('.react-flow__edge[data-id="d_crisis"] path').last(); const b = await e.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(800);
const s = page.locator('.react-flow__node[data-id="sensor"]'); const sb = await s.boundingBox(); await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2); await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Play through time' }).click(); await page.waitForTimeout(9000);
await page.locator('.map-body').screenshot({ path: out + '/slide_w_drawn.png', timeout: 60000 });
console.log(JSON.stringify({ runs, errors })); process.exit(0);

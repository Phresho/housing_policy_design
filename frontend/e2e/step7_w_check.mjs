// Tour step 7 (fitted to CBS) has the W-shaped crisis: the CBS card shows the 2009 dip without a 2010-11 rebound.
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
const runs = []; page.on('request', r => { if (r.url().endsWith('/api/runs') && r.method() === 'POST') runs.push(JSON.parse(r.postData())); });
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Presenter tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 });
await page.getByRole('button', { name: /^Step 7:/ }).click(); await page.locator('.tour-steps button.on', { hasText: /^7$/ }).waitFor({ timeout: 120000 }); await page.waitForTimeout(6000);
await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(1500);
const s = page.locator('.react-flow__node[data-id="sensor"]'); const b = await s.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Play through time' }).click(); await page.waitForTimeout(9000);
const card = page.locator('.chart-card.cbs'); const cb = await card.boundingBox();
await page.screenshot({ path: out + '/step7_w.png', clip: { x: cb.x - 5, y: cb.y - 5, width: cb.width + 10, height: cb.height + 10 } });
const last = runs[runs.length - 1]; console.log(JSON.stringify({ w: last.crisis_w, fall: last.crisis_w_fall_yr, errors })); process.exit(0);

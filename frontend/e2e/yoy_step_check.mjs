// Tour step 9: the CBS year-on-year card and a pinned year-on-year card show the step response (from the price
// step), not the historical run. Usage: node e2e/yoy_step_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels, pin } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 });
await page.getByRole('button', { name: /^Step 9:/ }).click(); await page.locator('.tour-steps button.on', { hasText: /^9$/ }).waitFor({ timeout: 120000 }); await page.waitForTimeout(8000);
await pin(page, ['owner']).catch(() => {}); await page.waitForTimeout(1000);
const s = page.locator('.react-flow__node[data-id="sensor"]'); const b = await s.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(5000);
const r = { title: await page.locator('.chart-card.cbs .pin-head strong').textContent(), note: await page.locator('.chart-card.cbs small').allTextContents(),
  bars: await page.locator('.chart-card.cbs rect').count(), ghost: await page.locator('.chart-card.cbs polyline[stroke="#8a9692"]').count() };
await page.locator('.map-body').screenshot({ path: out + '/yoy_step.png', timeout: 60000 });
console.log(JSON.stringify({ r, errors })); process.exit(0);

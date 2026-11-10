// Tour step 10: the robustness dock shows S and T together, compact, with one shared legend. Usage: node e2e/robust_dock_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 });
await page.getByRole('button', { name: /^Step 10:/ }).click(); await page.locator('.robust-docked .js-plotly-plot').nth(1).waitFor({ timeout: 120000 }); await page.waitForTimeout(3000);
const box = async n => page.locator('.robust-docked .robust-card').nth(n).boundingBox();
const info = { intro: await page.locator('.robust-docked h2', { hasText: 'Robustness' }).count(), S: await box(0), T: await box(1), legend: await page.locator('.robust-legend').textContent() };
await page.screenshot({ path: out + '/robust_dock.png' });
console.log(JSON.stringify({ info, errors }, null, 1)); process.exit(0);

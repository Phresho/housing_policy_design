// Tour step 2: change the adjustment time; the fit runs by itself and the plot cards show the proposed run
// (blue dashed); "Use in the simulation" makes it the solid run. Usage: node e2e/tour_fit_check.mjs outdir
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/');
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 }); await page.waitForTimeout(1500);
await page.getByRole('button', { name: /^Step 3:/ }).click(); await page.locator('.tour-steps button.on', { hasText: '3' }).waitFor({ timeout: 120000 }); await page.waitForTimeout(3000);
await page.getByLabel('Full adjustment').fill('6');
await page.locator('.ghost-note').first().waitFor({ timeout: 60000 }); await page.waitForTimeout(1000);
await page.locator('.map-body').screenshot({ path: out + '/tour_fit.png', timeout: 30000 });
const ghosts = await page.locator('.ghost-note').count();
await page.getByRole('button', { name: 'Use in the simulation' }).click();
await page.waitForFunction(() => document.querySelectorAll('.ghost-note').length === 0, null, { timeout: 60000 }); await page.waitForTimeout(9000);
await page.locator('.map-body').screenshot({ path: out + '/tour_fit_used.png', timeout: 30000 });
console.log(JSON.stringify({ ghosts, line: await page.locator('.ident-line').textContent(), price: await page.locator('.pin-card small').last().textContent(), errors }));
process.exit(0);

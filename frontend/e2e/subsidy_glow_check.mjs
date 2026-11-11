// CPB backbone view: Budget and the subsidy formula light both subsidy arrows (rental drawn even when switched off) and
// the subsidy sources. Usage: node e2e/subsidy_glow_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels, pin } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Presenter tour' }).click(); await page.locator('.formulas .katex').first().waitFor({ timeout: 120000 }); await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Expand Households' }).first().click(); await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(1200);
const info = {};
for (const name of ['Budget', 'Subsidy formula']) {
  await page.locator('.formulas .eq', { hasText: name }).click(); await page.waitForTimeout(800);
  info[name] = { u1: await page.locator('.react-flow__edge.lit[data-id="u1"]').count(), u2: await page.locator('.react-flow__edge.lit[data-id="u2"]').count(), litElements: await page.locator('.map-node.agent.open .element.selected').count() };
  await page.locator('.map-canvas').screenshot({ path: `${out}/glow_${name.split(' ')[0]}.png`, timeout: 60000 });
}
console.log(JSON.stringify({ info, errors })); process.exit(0);

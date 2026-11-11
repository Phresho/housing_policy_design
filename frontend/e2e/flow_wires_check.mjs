// Equation highlight continues inside an opened agent: the wires carrying the lit flows are drawn in their colour.
// Usage: node e2e/flow_wires_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels, pin } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 3 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Presenter tour' }).click(); await page.locator('.formulas .katex').first().waitFor({ timeout: 120000 }); await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Expand Households' }).first().click(); await page.waitForTimeout(2500);
const info = {};
for (const name of ['Budget', 'Utility']) {
  await page.locator('.formulas .eq', { hasText: name }).click(); await page.waitForTimeout(800);
  info[name] = await page.locator('.map-node.agent.open .lit-wires path').count();
  await page.locator('.map-node.agent.open').first().screenshot({ path: `${out}/wires_${name}.png`, timeout: 60000 });
}
console.log(JSON.stringify({ info, errors })); process.exit(0);

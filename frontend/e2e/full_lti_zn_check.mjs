// Full LTI system: every block open, the CPB equations in the side panel (clickable); tour step 10: the Ziegler-Nichols
// PID as a dotted line on the plot cards. Usage: node e2e/full_lti_zn_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels, pin } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page); await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Closed loop' }).first().click(); await page.waitForTimeout(500);
await page.getByRole('button', { name: 'CPB formulas' }).click(); await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Full LTI system' }).click(); await page.waitForTimeout(3500);
const r = { open: await page.locator('.react-flow__node .map-node.open').count(), blockEq: await page.locator('.react-flow__node .formulas .eq').count(), dockEq: await page.locator('.dock-formulas .eq').count() };
await page.locator('.dock-formulas .eq', { hasText: 'Budget' }).click(); await page.waitForTimeout(1200);
r.lit = await page.locator('.react-flow__edge.lit').count(); r.litWires = await page.locator('.lit-wires path').count();
await page.screenshot({ path: out + '/full_lti.png' });
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 });
await page.getByRole('button', { name: /^Step 10:/ }).click(); await page.locator('.tour-steps button.on', { hasText: /^10$/ }).waitFor({ timeout: 120000 }); await page.waitForTimeout(8000);
await pin(page, ['yout']); await page.waitForTimeout(1500);
await page.getByRole('button', { name: /Ziegler–Nichols PID/ }).click(); await page.waitForTimeout(1500);
r.zn = await page.locator('.pin-card').first().evaluate(c => ({ dotted: c.querySelectorAll('polyline[stroke="#4a5550"]').length, note: c.querySelector('small')?.textContent }));
r.titles = await page.locator('.robust-docked h3').allTextContents();
await page.locator('.map-body').screenshot({ path: out + '/zn_compare.png', timeout: 60000 });
console.log(JSON.stringify({ r, errors }, null, 1)); process.exit(0);

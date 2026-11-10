// Open agents (tour step 1 opens the whole market): subsidy and shock arrows run unbroken to their element, no dashed
// copies inside; plot cards link to the nearest point of their line. Usage: node e2e/agent_inputs_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels, pin } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 300000 }); await page.waitForTimeout(4000);
for (const n of ['Expand Firms', 'Expand Households']) { await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(900); await page.getByRole('button', { name: n }).first().click(); await page.waitForTimeout(1500); }
await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(1200);
for (const id of ['consumption', 'rent']) { const r = page.locator(`.react-flow__edge[data-id="${id}"] .rail-hit`).first(); if (await r.count()) { const b = await r.boundingBox(); await page.mouse.click(b.x + b.width * 0.4, b.y + b.height / 2); await page.waitForTimeout(800); } }
await page.locator('.map-canvas').screenshot({ path: out + '/agent_inputs.png', timeout: 60000 });
console.log(JSON.stringify({ dashedInside: await page.locator('.d-input').count(), innerU: await page.locator('.u-signal').count(), cards: await page.locator('.pin-card').count(), leads: await page.locator('.pin-lead').count(), errors }));
process.exit(0);

// Tour step 9: the shock is a fifth of the crisis (not +1), its card can be pinned from the shock arrow; step 10: the
// CBS card (click the sensor) shows CBS bars, the H-inf run and the open loop. Usage: node e2e/tour_reject_shock_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels, pin } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 });
const go = async n => { await page.getByRole('button', { name: new RegExp(`^Step ${n}:`) }).click(); await page.locator('.tour-steps button.on', { hasText: new RegExp(`^${n}$`) }).waitFor({ timeout: 120000 }); await page.waitForTimeout(6000); };
const info = {};
await go(9); await pin(page, ['yout', 'shocks']); await page.waitForTimeout(4000);
info.step9 = await page.locator('.pin-card small').allTextContents();
info.shockLabel = await page.locator('.react-flow__edge[data-id="shocks"]').textContent();
await page.locator('.map-body').screenshot({ path: out + '/reject_shock.png', timeout: 60000 });
await go(10); await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(1500);
const s = page.locator('.react-flow__node[data-id="sensor"]'); const b = await s.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(3000);
info.step10 = await page.locator('.chart-card.cbs small').allTextContents();
info.cbsBars = await page.locator('.chart-card.cbs rect').count(); info.ghost = await page.locator('.chart-card.cbs polyline[stroke="#8a9692"]').count();
await page.locator('.map-body').screenshot({ path: out + '/hinf_cbs.png', timeout: 60000 });
console.log(JSON.stringify({ info, errors }, null, 1)); process.exit(0);

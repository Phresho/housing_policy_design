// Tour: step 6 (CPB fit peaks, CPB dashed in the CBS card), step 9 (disturbance rejection: step responses with the open
// loop grey; switch the shock to the interest rate), step 10 (H-inf with robustness and Nyquist in the dock); right-click
// Parliament removes it, the summing junction brings it back. Usage: node e2e/tour_new_steps_check.mjs outdir
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/');
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 });
const go = async n => { await page.getByRole('button', { name: new RegExp(`^Step ${n}:`) }).click(); await page.locator('.tour-steps button.on', { hasText: new RegExp(`^${n}$`) }).waitFor({ timeout: 120000 }); await page.waitForTimeout(6000); };
const info = {};
await go(6); info.step6 = { title: await page.locator('.tour-text strong').textContent(), cards: await page.locator('.pin-card').count() };
await page.locator('.map-body').screenshot({ path: out + '/new_step6.png', timeout: 60000 });
await go(9); await page.locator('.ghost-note').first().waitFor({ timeout: 60000 });
info.step9 = { notes: await page.locator('.pin-card small').allTextContents(), select: await page.locator('.step-pick select').inputValue() };
await page.locator('.step-pick select').selectOption('d_interest'); await page.waitForTimeout(3000);
info.step9interest = await page.locator('.pin-card small').allTextContents();
await page.locator('.map-body').screenshot({ path: out + '/new_step9.png', timeout: 60000 });
await go(10); await page.locator('.robust-docked .js-plotly-plot').first().waitFor({ timeout: 120000 }); await page.locator('.nyquist .js-plotly-plot').waitFor({ timeout: 60000 });
info.step10 = { robust: await page.locator('.robust-docked .js-plotly-plot').count(), nyquist: await page.locator('.nyquist p.small').first().textContent() };
await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(1200);
await page.locator('.react-flow__node[data-id="parliament"]').click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Remove Parliament' }).click(); await page.waitForTimeout(800);
info.parliamentAfterRemove = await page.locator('.react-flow__node[data-id="parliament"]').count();
await page.locator('.map-canvas').screenshot({ path: out + '/no_parliament.png', timeout: 60000 });
await page.locator('.react-flow__node[data-id="sum"]').click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Show Parliament again' }).click(); await page.waitForTimeout(800);
info.parliamentBack = await page.locator('.react-flow__node[data-id="parliament"]').count();
console.log(JSON.stringify({ info, errors }, null, 1)); process.exit(0);

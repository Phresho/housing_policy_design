// Tour step 1 (CPB backbone with formulas), the controller dock with the Nyquist plot, and the docked robustness
// view. A run does not start playing by itself. Usage: node e2e/analysis_dock_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels, pin } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
for (let i = 0; i < 40; i++) { try { await page.goto('http://127.0.0.1:8001/'); break; } catch { await page.waitForTimeout(500); } }
await openPanels(page);
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 }); await page.waitForTimeout(4000);
const info = { playingAfterRun: await page.getByRole('button', { name: 'Pause' }).count(), year: await page.locator('.year-slider output').textContent(), eqs: await page.locator('.formulas .eq').count() };
await page.locator('.map-canvas').screenshot({ path: out + '/step1_formulas.png', timeout: 60000 });
await page.getByRole('button', { name: 'Leave tour' }).click();
await page.getByRole('button', { name: 'Closed loop' }).click();
await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForTimeout(4000);
await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(1500); await page.locator('.react-flow__node[data-id="controller"]').click(); await page.locator('.nyquist .js-plotly-plot').waitFor({ timeout: 60000 }); await page.waitForTimeout(1500);
await page.locator('.nyquist').screenshot({ path: out + '/nyquist.png', timeout: 60000 });
info.nyquist = await page.locator('.nyquist p.small').first().textContent();
await page.getByRole('button', { name: /Robustness/ }).first().click(); await page.locator('.robust-docked .js-plotly-plot').first().waitFor({ timeout: 120000 }); await page.waitForTimeout(2000);
await page.locator('aside.inspector').last().screenshot({ path: out + '/robust_dock.png', timeout: 60000 });
info.robustPlots = await page.locator('.robust-docked .js-plotly-plot').count();
console.log(JSON.stringify({ info, errors }, null, 1)); process.exit(0);

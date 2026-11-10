// Arrows and blocks stay drawn during and after Play in the tour, also with the Tax Authority open and a proposal.
// Usage: node e2e/tour_lines_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels, pin } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
const state = () => page.evaluate(() => ({ hidden: [...document.querySelectorAll('.react-flow__node')].filter(n => getComputedStyle(n).visibility === 'hidden').length,
  nodes: document.querySelectorAll('.react-flow__node').length, edges: document.querySelectorAll('.react-flow__edge path').length, year: document.querySelector('.year-slider output')?.textContent }));
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 }); await page.waitForTimeout(1500);
await page.getByRole('button', { name: /^Step 2:/ }).click(); await page.locator('.tour-steps button.on', { hasText: '2' }).waitFor({ timeout: 120000 }); await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Expand Tax Authority' }).click();
const log = [];
for (const t of [1000, 2000, 6000]) { await page.waitForTimeout(t); log.push(await state()); }
await page.locator('.map-canvas').screenshot({ path: out + '/lines_after_play.png', timeout: 30000 });
await pin(page, ['u2', 'yout']);
await page.getByLabel('Full adjustment').fill('6'); await page.locator('.ghost-note').first().waitFor({ timeout: 60000 }); await page.waitForTimeout(1500);
log.push(await state());
await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(1200); await page.locator('.map-canvas').screenshot({ path: out + '/lines_with_proposal.png', timeout: 30000 });
console.log(JSON.stringify({ log, errors }));
process.exit(0);

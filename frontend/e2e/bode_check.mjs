// Bode card between two pinned plots (Bode → Bode to here) and the right-click transfer function (input, output) in
// the dock. Usage: node e2e/bode_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
import { openPanels, pin } from './_lib.mjs';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [], bad = []; page.on('pageerror', e => errors.push(String(e))); page.on('response', r => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
await page.goto(`http://127.0.0.1:${port}/`); await openPanels(page);
await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForTimeout(8000);
await pin(page, ['u2', 'yout']);
const cards = await page.locator('.pin-card').count();
await page.locator('.pin-card').nth(0).locator('.tools-toggle').click(); await page.locator('.pin-card').nth(0).getByRole('button', { name: 'Bode from here' }).click(); await page.waitForTimeout(300);
await page.locator('.pin-card').nth(1).getByRole('button', { name: 'Bode to here' }).click(); await page.waitForTimeout(4000);
const bode = { cards: await page.locator('.chart-card.bode').count(), text: await page.locator('.chart-card.bode').allTextContents(), svg: await page.locator('.chart-card.bode svg polyline, .chart-card.bode svg path').count() };
await page.screenshot({ path: `${out}/b_card.png` });
const rclick = async id => { const b = await page.locator(`.react-flow__edge[data-id="${id}"] .rail-hit`).first().boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' }); await page.waitForTimeout(400); };
await rclick('u2'); await page.getByRole('menuitem', { name: 'Use as input' }).click(); await page.waitForTimeout(300);
await rclick('yout'); await page.getByRole('menuitem', { name: 'Use as output' }).click(); await page.waitForTimeout(5000);
const tf = { plots: await page.locator('.js-plotly-plot').count(), text: (await page.locator('body').textContent()).match(/Bode[^.]{0,80}/g)?.slice(0, 3) };
await page.screenshot({ path: `${out}/b_tf.png` });
console.log(JSON.stringify({ cards, bode, tf, errors, bad }, null, 1)); await browser.close();

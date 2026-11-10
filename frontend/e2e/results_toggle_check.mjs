// Results folded behind a bar; the price card title in step mode. Usage: node e2e/results_toggle_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await openPanels(page); await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).waitFor();
await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForSelector('.year-slider', { timeout: 120000 }); await page.waitForTimeout(800);
const h1 = await page.evaluate(() => document.body.scrollHeight), charts1 = await page.locator('.results-area').count();
const bar = await page.locator('.results-toggle').innerText();
await page.screenshot({ path: `${out}/results_closed.png`, fullPage: true });
await page.locator('.results-toggle').click(); await page.waitForTimeout(1500);
const h2 = await page.evaluate(() => document.body.scrollHeight), charts2 = await page.locator('.results-area .panel').count();
await page.getByRole('button', { name: 'Identify system' }).click(); await page.locator('.pin-card').first().waitFor(); await page.waitForTimeout(1500);
const title = await page.locator('.pin-card .pin-head strong').first().innerText();
console.log(JSON.stringify({ bar, closed: { height: h1, results: charts1 }, open: { height: h2, panels: charts2 }, title, errors }));
await browser.close();

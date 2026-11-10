// Plots are grey until Play is pressed once, then coloured. Usage: node e2e/play_colour_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels, pin } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 });
await page.getByRole('button', { name: /^Step 3:/ }).click(); await page.locator('.tour-steps button.on', { hasText: /^3$/ }).waitFor({ timeout: 120000 }); await page.waitForTimeout(6000);
await pin(page, ['yout']); await page.waitForTimeout(1500);
const stroke = () => page.locator('.pin-card .mini-plot polyline').evaluateAll(ps => ps.map(p => p.getAttribute('stroke')));
const before = await stroke();
await page.getByRole('button', { name: 'Play through time' }).click(); await page.waitForTimeout(8000);
const after = await stroke();
await page.locator('.map-body').screenshot({ path: out + '/play_colour.png', timeout: 60000 });
console.log(JSON.stringify({ before, after, errors })); process.exit(0);

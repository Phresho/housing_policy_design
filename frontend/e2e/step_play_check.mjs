// Tour step 9: Play runs the step-response cards through time (dot + "x yr" label mid-play, full line at the end).
// Usage: node e2e/step_play_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels, pin } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 });
await page.getByRole('button', { name: /^Step 9:/ }).click(); await page.locator('.tour-steps button.on', { hasText: /^9$/ }).waitFor({ timeout: 120000 }); await page.waitForTimeout(8000); await pin(page, ['yout', 'shocks']); await page.waitForTimeout(4000);
const info = { before: await page.locator('.pin-card.step-mode .mini-year').allTextContents() };
await page.getByRole('button', { name: 'Play through time' }).click(); await page.waitForTimeout(1500);
info.mid = await page.locator('.pin-card.step-mode .mini-year').allTextContents();
await page.locator('.map-body').screenshot({ path: out + '/step_play_mid.png', timeout: 60000 });
await page.waitForTimeout(6000);
info.end = await page.locator('.pin-card.step-mode .mini-year').allTextContents();
console.log(JSON.stringify({ info, errors }, null, 1)); process.exit(0);

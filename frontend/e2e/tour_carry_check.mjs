// Step 2 -> Next: step 3 keeps step 2's settings (fitted model parameters) and adds the growth path (income from 80,
// +2% a year). Usage: node e2e/tour_carry_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels, pin } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 });
await page.getByRole('button', { name: /^Step 2:/ }).click(); await page.locator('.tour-steps button.on', { hasText: /^2$/ }).waitFor({ timeout: 120000 }); await page.waitForTimeout(3000);
await pin(page, ['u2', 'yout']);
await page.getByLabel('Full adjustment').fill('6'); await page.locator('.ghost-note').first().waitFor({ timeout: 60000 });
await page.getByRole('button', { name: 'Use in the simulation' }).click(); await page.waitForTimeout(6000);
await page.getByRole('button', { name: /Next/ }).click(); await page.locator('.tour-steps button.on', { hasText: /^3$/ }).waitFor({ timeout: 120000 }); await page.waitForTimeout(6000);
await pin(page, ['d_income', 'u2', 'yout']); await page.waitForTimeout(800);
const info = { cards: await page.locator('.pin-card small').allTextContents(), paramDot: await page.locator('.lgroup', { hasText: 'Model parameters' }).count() };
await page.locator('.map-body').screenshot({ path: out + '/tour_step3_carry.png', timeout: 60000 });
console.log(JSON.stringify({ info, errors })); process.exit(0);

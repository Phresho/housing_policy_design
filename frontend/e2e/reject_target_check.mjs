// Tour step 9: switching the step to the target r gives closed-loop step responses (no open-loop error).
import { chromium } from 'playwright-core';
import { openPanels, pin } from './_lib.mjs';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Presenter tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 });
await page.getByRole('button', { name: /^Step 9:/ }).click(); await page.locator('.tour-steps button.on', { hasText: /^9$/ }).waitFor({ timeout: 120000 }); await page.waitForTimeout(6000);
await pin(page, ['yout', 'u2']); await page.waitForTimeout(2000);
await page.locator('.step-pick select').selectOption('y_reference'); await page.waitForTimeout(5000);
const cards = await page.locator('.pin-card').evaluateAll(cs => cs.map(c => ({ title: c.querySelector('.pin-head strong')?.textContent, plot: c.querySelectorAll('polyline').length, text: c.innerText.slice(0, 120) })));
await page.locator('.step-pick select').selectOption('d_interest'); await page.waitForTimeout(5000);
const interest = await page.locator('.pin-card').evaluateAll(cs => cs.map(c => c.querySelectorAll('polyline[stroke-dasharray]').length));
console.log(JSON.stringify({ cards, interestGhosts: interest, errors }, null, 1)); process.exit(0);

// Tour step 9 starts on step responses and stays there after a click elsewhere; the toolbar switch flips to the time
// path and back. Usage: node e2e/plot_mode_check.mjs
import { chromium } from 'playwright-core';
import { openPanels, pin } from './_lib.mjs';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 });
await page.getByRole('button', { name: /^Step 9:/ }).click(); await page.locator('.tour-steps button.on', { hasText: /^9$/ }).waitFor({ timeout: 120000 }); await page.waitForTimeout(6000);
await pin(page, ['yout']); await page.waitForTimeout(2500);
const mode = () => page.locator('.pin-card').first().evaluate(c => c.classList.contains('step-mode') ? 'step' : 'time');
const r = { start: await mode() };
const pane = await page.locator('.react-flow__pane').boundingBox(); await page.mouse.click(pane.x + 30, pane.y + pane.height - 30); await page.waitForTimeout(2500);
r.afterMisclick = await mode();
await page.getByRole('button', { name: 'Time path' }).click(); await page.waitForTimeout(1500); r.time = await mode();
await page.getByRole('button', { name: 'Step response' }).click(); await page.waitForTimeout(2500); r.step = await mode();
await page.getByRole('button', { name: /^Step 8:/ }).click(); await page.locator('.tour-steps button.on', { hasText: /^8$/ }).waitFor({ timeout: 120000 }); await page.waitForTimeout(5000);
r.step8pressed = await page.getByRole('button', { name: 'Time path' }).getAttribute('aria-pressed');
console.log(JSON.stringify({ r, errors })); process.exit(0);

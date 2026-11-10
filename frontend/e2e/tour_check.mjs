// Guided tour: start it, step through all seven steps, screenshot the page at each. Usage: node e2e/tour_check.mjs outdir
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
for (let i = 0; i < 40; i++) { try { await page.goto('http://127.0.0.1:8001/'); break; } catch { await page.waitForTimeout(500); } }
await page.getByRole('button', { name: 'Guided tour' }).click();
const steps = [];
for (let i = 0; i < 10; i++) {
  if (i) await page.getByRole('button', { name: /Next/ }).click();
  await page.locator('.tour-steps button.on', { hasText: String(i + 1) }).waitFor({ timeout: 120000 });
  await page.waitForTimeout(8500);
  await page.screenshot({ path: `${out}/tour${i + 1}.png` });
  steps.push({ step: i + 1, title: await page.locator('.tour-text strong').textContent(), cards: await page.locator('.pin-card').count(), year: await page.locator('.year-slider output').textContent(), alert: await page.locator('[role=alert]').allTextContents() });
}
console.log(JSON.stringify({ steps, errors }, null, 1));
await browser.close();

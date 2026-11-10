// Tour step 2: subsidy step with the identification dock (poles, step response) for the model without the bank.
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
for (let i = 0; i < 40; i++) { try { await page.goto('http://127.0.0.1:8001/'); break; } catch { await page.waitForTimeout(500); } }
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 }); await page.waitForTimeout(1500);
await page.getByRole('button', { name: /^Step 2:/ }).click(); await page.locator('.tour-steps button.on', { hasText: '2' }).waitFor({ timeout: 120000 }); await page.waitForTimeout(9000);
await page.locator('.map-body').screenshot({ path: out + '/tour_step2.png', timeout: 30000 });
console.log(JSON.stringify({ title: await page.locator('.ident-first').textContent().catch(() => null), line: await page.locator('.ident-line').textContent().catch(() => null), cards: await page.locator('.pin-card').count(), stepMode: await page.locator('.pin-card.step-mode').count(), errors }));
process.exit(0);

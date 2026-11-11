// Tour step 1: the market-price formula lights the maintenance branch (L1, R9) and the gross rents, not the exit to the right.
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Presenter tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 }); await page.waitForTimeout(5000);
await page.locator('.react-flow__controls-fitview').click(); await page.waitForTimeout(2000); if (!(await page.locator('svg[aria-label*="nvestors"]').count())) { await page.locator('.react-flow__node[data-id="investors"] button').first().dispatchEvent('click'); await page.waitForTimeout(2500); } await page.locator('.eq', { hasText: 'Market price' }).first().dispatchEvent('click'); await page.waitForTimeout(1500);
const svg = page.locator('svg[aria-label*="nvestors"]');
const lit = await page.evaluate(() => [...document.querySelectorAll('svg')].filter(s => (s.getAttribute('aria-label') ?? '').includes('circuit')).map(s => [s.getAttribute('aria-label'), s.querySelectorAll('.lit-wires path').length, s.querySelectorAll('.wires path').length]));
{ const b0 = await svg.boundingBox(); await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2); for (let i = 0; i < 2; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(250); } await page.waitForTimeout(1200); }
console.log(JSON.stringify(lit)); const b = await svg.boundingBox({ timeout: 3000 }).catch(() => null); await page.screenshot({ path: out + '/price_lit.png', clip: b && b.width > 10 ? { x: Math.max(0, b.x - 40), y: Math.max(0, b.y - 200), width: Math.min(1600, b.width + 80), height: Math.min(1000, b.height + 220) } : undefined });
console.log(JSON.stringify({ lit, box: b, errors })); process.exit(0);

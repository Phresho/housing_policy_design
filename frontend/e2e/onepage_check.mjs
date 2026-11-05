// Read-only check: one page (no tabs), policy in the left dock, results below, moving dots. Usage: node e2e/onepage_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector('.react-flow__node', { timeout: 60000 }); await page.waitForTimeout(800);
console.log('tabs', await page.locator('nav.steps').count(), 'policy in dock', await page.locator('.left-dock h3', { hasText: 'Policy' }).count());
await page.locator('.left-dock').getByRole('button', { name: 'Closed loop' }).click().catch(() => {});
await page.locator('.left-dock').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForSelector('.year-slider', { timeout: 120000 }); await page.waitForTimeout(1500);
console.log('dots', await page.locator('.flow-dots').count(), 'results charts', await page.locator('.results-area figure').count());
await page.screenshot({ path: `${out}/one_1.png` });
await page.locator('summary', { hasText: 'Robustness' }).click(); await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/one_2.png`, fullPage: true });
console.log('errors', errors); await browser.close();

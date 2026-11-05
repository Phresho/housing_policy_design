// Read-only check: shortest-cycle limit in the dock root locus. Usage: node e2e/cycle_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1300 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector('.react-flow__node', { timeout: 60000 });
await page.locator('.map-head').getByRole('button', { name: 'Closed loop' }).click();
await page.locator('.react-flow__node[data-id="controller"]').click(); await page.waitForSelector('.dock-locus .verdict', { timeout: 90000 }); await page.waitForTimeout(1000);
const verdict = () => page.locator('.dock-locus .verdict').textContent();
console.log('no limit:', await verdict());
await page.locator('.dock-locus .cycle-limit input[type=checkbox]').check(); await page.waitForTimeout(400);
await page.locator('.dock-locus .cycle-limit input[type=number]').fill('3'); await page.waitForTimeout(1500);
console.log('shortest cycle 3 yr:', await verdict(), '| label', await page.locator('.dock-locus .pp-spec-label', { hasText: 'shortest cycle' }).textContent());
await page.locator('.dock-locus').screenshot({ path: `${out}/cyc_1.png` });
console.log('errors', errors); await browser.close();

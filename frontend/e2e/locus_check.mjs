// Read-only check: root locus in the controller dock follows the gain steppers. Usage: node e2e/locus_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await openPanels(page); await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).waitFor();
await page.waitForTimeout(1200);
await page.locator('.react-flow__node[data-id="controller"]').click(); await page.waitForSelector('.dock-locus .pole-plot', { timeout: 60000 }); await page.waitForTimeout(1500);
const verdict = async () => page.locator('.dock-locus .verdict').textContent();
console.log('verdict', await verdict());
await page.screenshot({ path: `${out}/l_1.png` });
for (let i = 0; i < 8; i++) { await page.getByRole('button', { name: 'Kp up' }).first().click(); await page.waitForTimeout(150); }
await page.waitForTimeout(1500); console.log('Kp', await page.locator('.gain-step output').first().textContent(), 'verdict', await verdict());
await page.locator('.dock-locus .chips button', { hasText: /Ziegler/ }).first().click(); await page.waitForTimeout(1500);
console.log('ZN Kp', await page.locator('.gain-step output').first().textContent(), 'verdict', await verdict());
await page.screenshot({ path: `${out}/l_2.png` });
console.log('errors', errors); await browser.close();

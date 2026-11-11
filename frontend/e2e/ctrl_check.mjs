// Read-only check: steppers on P/I/D in the controller move the dock root locus; P/I/D breadboards open. Usage: node e2e/ctrl_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await openPanels(page); await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).waitFor();
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Closed loop' }).first().click(); await page.waitForTimeout(500);
await page.locator('.react-flow__node[data-id="controller"]').click(); await page.waitForTimeout(1500);
await page.waitForSelector('.dock-locus .pole-plot', { timeout: 60000 }); await page.waitForTimeout(1200);
const poles = async () => page.locator('.dock-locus .pp-pole').evaluateAll(es => es.map(e => e.getAttribute('d')?.slice(0, 14)).join('|'));
const before = await poles();
for (let i = 0; i < 5; i++) { await page.locator('[aria-label="kp up"]').dispatchEvent('click'); await page.waitForTimeout(120); }
await page.waitForTimeout(1500);
console.log('Kp now', await page.locator('.gain-step output').first().textContent(), 'poles moved', before !== await poles());
await page.screenshot({ path: `${out}/k_1.png` });
await page.locator('[aria-label="Open the I breadboard"]').dispatchEvent('click'); await page.waitForTimeout(600);
await page.locator('.react-flow__node[data-id="controller"]').screenshot({ path: `${out}/k_2_I.png` });
await page.locator('.bb-head').dispatchEvent('click'); await page.waitForTimeout(300);
await page.locator('[aria-label="Open the D breadboard"]').dispatchEvent('click'); await page.waitForTimeout(600);
await page.locator('.react-flow__node[data-id="controller"]').screenshot({ path: `${out}/k_3_D.png` });
console.log('errors', errors); await browser.close();

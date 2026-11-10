// Read-only check: shock arrows at scale 0 disappear. Usage: node e2e/zero_shock_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1050 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await openPanels(page); await page.waitForSelector('.react-flow__node', { timeout: 60000 });
const edges = async () => (await page.locator('.react-flow__edge').evaluateAll(es => es.map(e => e.getAttribute('data-id')))).filter(id => id.startsWith('d_') || id === 'shocks');
console.log('loop level', await edges(), await page.locator('.react-flow__edge[data-id="shocks"] .sig-sub').textContent());
await page.locator('.left-dock').getByRole('button', { name: 'CPB comparison' }).click(); await page.waitForTimeout(600);
console.log('CPB comparison, loop level', await edges(), await page.locator('.react-flow__edge[data-id="shocks"] .sig-sub').textContent().catch(() => '-'));
await page.locator('.react-flow__node[data-id="system"]').click({ position: { x: 20, y: 40 } }); await page.waitForTimeout(1200);
console.log('CPB comparison, markets', await edges());
console.log('errors', errors); await browser.close();

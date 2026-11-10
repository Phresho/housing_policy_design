// Tour step 10 (compare on): a disturbance card has no grey dashed open-loop line, the price card still has it.
import { chromium } from 'playwright-core';
import { openPanels, pin } from './_lib.mjs';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 });
await page.getByRole('button', { name: /^Step 10:/ }).click(); await page.locator('.tour-steps button.on', { hasText: /^10$/ }).waitFor({ timeout: 120000 }); await page.waitForTimeout(8000);
await page.locator('.react-flow__node[data-id="system"] button').first().dispatchEvent('click'); await page.waitForTimeout(1500);
await page.locator('.react-flow__controls-fitview').click(); await page.waitForTimeout(1500);
for (const id of ['d_covid', 'yout', 'r', 'e']) { const e = page.locator(`.react-flow__edge[data-id="${id}"] path`).last(); const b = await e.boundingBox(); if (b) { await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(600); } } await page.waitForTimeout(2000);
const cards = await page.locator('.pin-card').evaluateAll(cs => cs.map(c => ({ title: c.querySelector('.pin-head strong')?.textContent, ghost: c.querySelectorAll('polyline[stroke-dasharray]').length, note: c.querySelector('small')?.textContent })));
console.log(JSON.stringify({ cards, errors }, null, 1)); process.exit(0);

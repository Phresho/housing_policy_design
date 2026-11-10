// Bank off, all four CPB agents open, formulas on: equations beside the circuits (Constructors left, Investors and
// Households right); none overflow. Usage: node e2e/formula_side_check.mjs outdir [label size]
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots', lab = process.argv[3] ?? '1.3';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page); await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Original CPB model (no bank)' }).click(); await page.waitForTimeout(1500);
await page.getByRole('slider', { name: 'Label size' }).fill(lab); await page.waitForTimeout(500);
await page.getByRole('button', { name: 'CPB formulas' }).click(); await page.waitForTimeout(1500);
for (const a of ['constructors', 'investors', 'firms', 'households']) { await page.locator(`.react-flow__node[data-id="${a}"] button`).first().dispatchEvent('click'); await page.waitForTimeout(1200); }
// collapse both side panels for the slide view
for (const name of ['Collapse scenario panel', 'Collapse panel']) { const b = page.getByRole('button', { name, exact: true }); if (await b.count()) await b.first().click(); }
await page.waitForTimeout(800); await page.locator('.react-flow__controls-fitview').click(); await page.waitForTimeout(1500);
const r = await page.evaluate(() => [...document.querySelectorAll('.formula-strip')].map(s => ({ agent: s.closest('.react-flow__node').dataset.id, side: s.className, over: s.scrollWidth - s.clientWidth > 2 || s.scrollHeight - s.clientHeight > 2 })));
const b = await page.locator('.react-flow__node[data-id="system"]').boundingBox();
await page.locator('.map-canvas').screenshot({ path: `${out}/formula_side_${lab}.png`, timeout: 60000 });
console.log(JSON.stringify({ r, market: [Math.round(b.width), Math.round(b.height)], errors })); process.exit(0);

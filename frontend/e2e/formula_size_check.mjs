// CPB formulas grow with the label-size slider and still fit their boxes. Usage: node e2e/formula_size_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page); await page.waitForTimeout(3000);
await page.getByRole('button', { name: 'CPB formulas' }).click(); await page.waitForTimeout(1500);
const measure = () => page.evaluate(() => ({ font: getComputedStyle(document.querySelector('.formulas .eq .eq-body')).fontSize,
  overflow: [...document.querySelectorAll('.formulas')].map(f => { const box = f.parentElement; return box.scrollHeight - box.clientHeight > 2 || box.scrollWidth - box.clientWidth > 2; }) }));
const r = {};
for (const v of ['1', '1.3', '2.5']) { await page.getByRole('slider', { name: 'Label size' }).fill(v); await page.waitForTimeout(1200); r[v] = await measure(); }
await page.locator('.react-flow__node[data-id="households"] button').first().dispatchEvent('click'); await page.waitForTimeout(2000);
r.openHouseholds = await measure();
await page.locator('.react-flow__controls-fitview').click(); await page.waitForTimeout(1500);
await page.locator('.map-body').screenshot({ path: out + '/formula_size.png', timeout: 60000 });
// Firms opened at the largest labels: its header band sits above the circuit
await page.locator('.react-flow__node[data-id="firms"] button').first().dispatchEvent('click'); await page.waitForTimeout(2000);
const fn = page.locator('.react-flow__node[data-id="firms"]'); const fb = await fn.boundingBox();
await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2); for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(250); } await page.waitForTimeout(1200);
r.firms = await page.evaluate(() => { const n = document.querySelector('.react-flow__node[data-id="firms"]'), c = n.querySelector('svg.circuit').getBoundingClientRect(), b = n.getBoundingClientRect();
  const heads = [...document.querySelectorAll('.sticky-head')].map(h => h.getBoundingClientRect()).filter(h => h.left < c.right && h.right > c.left && Math.abs(h.top - b.top) < 4);
  return { circuitTop: Math.round(c.top - b.top), header: heads.length ? Math.round(heads[0].height) : null }; });
await page.locator('.map-body').screenshot({ path: out + '/firms_band.png', timeout: 60000 });
await page.getByRole('slider', { name: 'Label size' }).fill('1.3');
console.log(JSON.stringify({ r, errors })); process.exit(0);

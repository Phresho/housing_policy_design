// Tour step 2: set a new adjustment and cycle, fit, use in the simulation; the pole plot then shows no netlist
// crosses and every pole (and the path) inside the axes. Usage: node e2e/ident_apply_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 });
await page.getByRole('button', { name: /^Step 2:/ }).click(); await page.locator('.ident-form').waitFor({ timeout: 120000 }); await page.waitForTimeout(3000);
const adj = page.locator('.ident-form input[type=number]').first(); await adj.fill('4');
await page.locator('.ident-form input[type=checkbox]').check(); await page.locator('.ident-form input[type=number]').nth(1).fill('6');
await page.getByRole('button', { name: 'Use in the simulation' }).waitFor({ timeout: 120000 });
await page.getByRole('button', { name: 'Use in the simulation' }).click(); await page.waitForTimeout(9000);
const plot = page.locator('[aria-label="Poles of the subsidy to price path"]');
const info = await plot.evaluate(el => { const gd = el; const ya = gd._fullLayout.yaxis.range, xa = gd._fullLayout.xaxis.range;
  const outside = gd.data.flatMap(t => (t.y ?? []).map((y, i) => [t.x[i], y]).filter(([x, y]) => y < ya[0] || y > ya[1] || x < xa[0] || x > xa[1]).map(() => t.name));
  return { names: gd.data.map(t => t.name), yrange: ya, outside }; });
await plot.evaluate(el => el.scrollIntoView({ block: 'center' })); await page.waitForTimeout(500); await plot.screenshot({ path: out + '/ident_apply.png' });
console.log(JSON.stringify({ info, errors })); process.exit(0);

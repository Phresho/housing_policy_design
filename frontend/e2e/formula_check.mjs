// Tour step 1: CPB equations (KaTeX) on the agents; clicking one lights up its flows; opening an agent keeps the
// equations above its circuit. Usage: node e2e/formula_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels, pin } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.formulas .katex').first().waitFor({ timeout: 120000 }); await page.waitForTimeout(3000);
const info = { cards: await page.locator('.formulas .eq').count(), katex: await page.locator('.formulas .katex').count(), steps: await page.locator('.tour-steps button').count() };
await page.locator('.formulas .eq', { hasText: 'Budget' }).click(); await page.waitForTimeout(800);
info.litRails = await page.locator('.react-flow__edge.selected, .rail.selected, .react-flow__edge [class*="selected"]').count();
await page.locator('.map-canvas').screenshot({ path: out + '/formulas_closed.png', timeout: 60000 });
for (const n of ['Expand Households', 'Expand Investors']) { await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(900); await page.getByRole('button', { name: n }).first().click(); await page.waitForTimeout(1500); }
await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(1200);
await page.locator('.formulas .eq', { hasText: 'Subsidy formula' }).click(); await page.waitForTimeout(800);
info.stripCards = await page.locator('.formula-strip .eq').count(); info.litElements = await page.locator('.map-node.agent.open .selected').count();
await page.locator('.map-canvas').screenshot({ path: out + '/formulas_open.png', timeout: 60000 });
console.log(JSON.stringify({ info, errors })); process.exit(0);

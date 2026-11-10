// Controller dock: root locus with the Nyquist plot right below it, both in view together; the page screenshot shows
// the dock as scrolled (not its top) and no action bar. Usage: node e2e/locus_nyquist_shot_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page); await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'Closed loop' }).first().click(); await page.waitForTimeout(800);
await page.locator('.react-flow__node[data-id="controller"]').dispatchEvent('click'); await page.waitForTimeout(1500);
await page.locator('.dock-locus .js-plotly-plot').first().waitFor({ timeout: 120000 }); await page.locator('.nyquist .js-plotly-plot').waitFor({ timeout: 120000 }); await page.waitForTimeout(1500);
await page.locator('.dock-locus h4').first().evaluate(el => el.scrollIntoView({ block: 'start' })); await page.waitForTimeout(800);
const box = async s => page.locator(s).first().boundingBox();
const locus = await box('.dock-locus .js-plotly-plot'), nyq = await box('.nyquist .js-plotly-plot');
const both = locus.y >= 0 && nyq.y + nyq.height <= 1000;
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.getByRole('button', { name: /Screenshot page/ }).click()]);
await dl.saveAs(out + '/page_shot.png');
console.log(JSON.stringify({ locus: [Math.round(locus.y), Math.round(locus.height)], nyquist: [Math.round(nyq.y), Math.round(nyq.height)], bothInView: both, errors })); await browser.close();

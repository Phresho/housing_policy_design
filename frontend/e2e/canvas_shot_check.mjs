// Canvas screenshot + label size. Usage: node e2e/canvas_shot_check.mjs [port] [outdir] [labelSize]
import { chromium } from 'playwright-core';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots', lab = process.argv[4] ?? '2';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).waitFor();
await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForSelector('.year-slider', { timeout: 120000 });
const open = async id => { await page.locator(`.react-flow__node[data-id="${id}"]`).click({ position: { x: 20, y: 40 }, force: true }); await page.waitForTimeout(700); };
await open('system'); await open('cpb');
for (const a of ['households', 'investors', 'constructors', 'firms']) await open(a);
await page.getByRole('button', { name: 'Collapse scenario panel' }).click(); await page.getByRole('button', { name: 'Collapse panel' }).click();
await page.getByRole('slider', { name: 'Label size' }).fill(lab); await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/canvas_view_${lab}.png` });
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.getByRole('button', { name: 'Screenshot canvas' }).click()]);
const path = `${out}/canvas_${lab}.png`; await dl.saveAs(path);
console.log(JSON.stringify({ path, errors }));
await browser.close();

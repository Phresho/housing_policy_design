// Page screenshot with the side panels collapsed (their tabs are grid columns). Usage: node e2e/page_shot_collapsed_check.mjs [outdir]
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).waitFor();
await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForSelector('.year-slider', { timeout: 120000 });
await page.getByRole('button', { name: 'Identify system' }).click(); await page.locator('.ident-line').waitFor({ timeout: 30000 });
await page.getByRole('button', { name: 'Collapse scenario panel' }).click(); await page.waitForTimeout(1200);
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.getByRole('button', { name: 'Screenshot page' }).click()]);
await dl.saveAs(`${out}/page_collapsed.png`);
const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.getByRole('button', { name: 'Screenshot canvas' }).click()]);
await dl2.saveAs(`${out}/canvas_collapsed.png`);
const visible = await page.locator('.dock-handle').first().evaluate(n => getComputedStyle(n).visibility);
console.log(JSON.stringify({ handleVisibleAfter: visible, errors }));
await browser.close();

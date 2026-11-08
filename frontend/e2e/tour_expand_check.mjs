// Tour step 1 opens the whole market down to the elements. Usage: node e2e/tour_expand_check.mjs outdir
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/');
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 }); await page.waitForTimeout(4000);
await page.locator('.map-canvas').screenshot({ path: out + '/tour_expand.png', timeout: 30000 });
console.log(JSON.stringify({ nodes: await page.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map(n => n.getAttribute('data-id')).join(',')), errors }));
process.exit(0);

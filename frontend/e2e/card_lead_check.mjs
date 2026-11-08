// Outside the tour: open the market, pin a flow, drag its card away; a dashed link runs from the nearest point of the
// line to the card's edge. Usage: node e2e/card_lead_check.mjs outdir
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/');
const run = page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }); await run.waitFor();
await run.click(); await page.waitForSelector('.year-slider', { timeout: 300000 }); await page.waitForTimeout(2000);
await page.locator('.react-flow__node[data-id="system"]').click({ position: { x: 20, y: 40 } }); await page.waitForTimeout(2500);
const r = page.locator('.react-flow__edge[data-id="mortgages"] .rail-hit').first(); const b = await r.boundingBox();
await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(800);
const card = page.locator('.pin-card').first(); const c = await card.boundingBox();
await page.mouse.move(c.x + 40, c.y + 10); await page.mouse.down(); await page.mouse.move(c.x - 160, c.y - 120, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(800);
await page.locator('.map-canvas').screenshot({ path: out + '/card_lead.png', timeout: 60000 });
console.log(JSON.stringify({ leads: await page.locator('.pin-lead').count(), errors }));
process.exit(0);

// Outside the tour: closed loop, a step in a disturbance -> the step-response cards also show the grey dashed
// response without the controller. Usage: node e2e/free_step_ghost_check.mjs outdir
import { chromium } from 'playwright-core';
import { openPanels, pin } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Closed loop' }).click(); await page.waitForTimeout(8000);
await pin(page, ['yout']); await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'Step response' }).click(); await page.waitForTimeout(1500);
const c = page.locator('.react-flow__node[data-id="controller"]'); const b = await c.boundingBox(); await page.mouse.click(b.x + 20, b.y + 8); await page.waitForTimeout(1500);
const r = {};
await page.locator('.step-pick select').selectOption('d_crisis'); await page.waitForTimeout(5000);
r.ghostCrisis = await page.locator('.pin-card.step-mode polyline[stroke="#8a9692"]').count();
await page.locator('.map-body').screenshot({ path: out + '/free_step_ghost.png', timeout: 60000 });
await page.locator('.step-pick select').selectOption('y_reference'); await page.waitForTimeout(5000);
r.ghostTarget = await page.locator('.pin-card.step-mode polyline[stroke="#8a9692"]').count();
console.log(JSON.stringify({ r, errors })); process.exit(0);

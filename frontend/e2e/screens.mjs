// High-resolution screenshots for the presentation (3x pixel density), each cropped to the drawing.
// Read-only: no saves. Usage: node e2e/screens.mjs [port] [outdir]
import { chromium } from 'playwright-core';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1050 }, deviceScaleFactor: 3 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
const wait = ms => page.waitForTimeout(ms);
const node = id => page.locator(`.react-flow__node[data-id="${id}"]`);
const open = async id => { await node(id).click({ position: { x: 20, y: 40 } }); await wait(1200); };
const whole = async () => { await page.getByRole('button', { name: /Whole model/ }).click(); await wait(1300); };
const run = async () => { await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForSelector('.year-slider', { timeout: 120000 }); await wait(1500); await page.evaluate(() => window.scrollTo(0, 0)); await wait(300); };
// Fresh page for every shot, scenario dock collapsed, zoom buttons and legend hidden.
const fresh = async () => {
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector('.react-flow__node', { timeout: 60000 });
  await page.addStyleTag({ content: '.react-flow__controls, .map-key { display:none !important; }' });
  await page.getByRole('button', { name: 'Collapse scenario panel' }).click(); await wait(300);
};
// Crop to everything drawn on the canvas (blocks, arrows, their labels), plus a margin.
const drawing = async (name, margin = 24) => {
  const box = await page.evaluate(m => {
    const c = document.querySelector('.map-canvas').getBoundingClientRect();
    const els = [...document.querySelectorAll('.react-flow__node, .react-flow__edge path, .react-flow__edge text, .react-flow__edge circle, .sticky-head, .pin-card')];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of els) { const r = e.getBoundingClientRect(); if (r.width < 1 && r.height < 1) continue; x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); }
    x0 = Math.max(c.left, x0 - m); y0 = Math.max(c.top, y0 - m); x1 = Math.min(c.right, x1 + m); y1 = Math.min(c.bottom, y1 + m);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }, margin);
  await page.screenshot({ path: `${out}/${name}.png`, clip: box });
};
const closed = async () => { await page.locator('.map-head').getByRole('button', { name: 'Closed loop' }).click(); await wait(300); };
const noBank = async () => {
  await page.getByRole('button', { name: 'Open scenario panel' }).click(); await wait(300);
  await page.locator('.left-dock').getByRole('button', { name: 'Original CPB model (no bank)' }).click();
  await page.getByRole('button', { name: 'Collapse scenario panel' }).click(); await wait(300);
};

await fresh(); await closed(); await run(); await whole(); await drawing('01_loop_closed');
await fresh(); await closed(); await run(); await open('system'); await whole(); await drawing('02_markets_with_bank');
await open('cpb'); await whole(); await drawing('03_agents_with_bank');
await fresh(); await closed(); await noBank(); await run(); await open('system'); await whole(); await drawing('05_cpb_only_markets');
await open('cpb'); await whole(); await drawing('06_cpb_only_agents');
// controller with P/I/D and the root locus in the dock: the whole model panel
await fresh(); await closed();
await node('controller').click(); await page.waitForSelector('.dock-locus .pole-plot', { timeout: 60000 }); await wait(2000);
await page.locator('.map-panel').screenshot({ path: `${out}/04_controller_root_locus.png` });
// results: year-on-year with CBS
await fresh(); await run();
const yoy = page.locator('section.panel', { hasText: 'Yearly house price change' }).first();
await yoy.scrollIntoViewIfNeeded(); await wait(800); await yoy.screenshot({ path: `${out}/07_yoy_with_cbs.png` });
console.log('errors', errors); await browser.close();

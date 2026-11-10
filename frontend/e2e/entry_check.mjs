// Dashed arrows inside open agents: where each disturbance (red) and subsidy (blue) enters. Usage: node e2e/entry_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await openPanels(page); await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).waitFor();
await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).click(); await page.waitForSelector('.year-slider', { timeout: 120000 });
await page.getByRole('button', { name: 'Collapse scenario panel' }).click(); await page.getByRole('button', { name: 'Collapse panel' }).click();
const isOpen = id => page.locator(`.react-flow__node[data-id="${id}"] .map-node.open`).count();
const open = async id => { if (await isOpen(id)) return; const t = page.locator(`.react-flow__node[data-id="${id}"] .toggle`).first(); if (await t.count()) await t.evaluate(el => el.click()); else await page.locator(`.react-flow__node[data-id="${id}"]`).click({ position: { x: 20, y: 40 }, force: true }); await page.waitForTimeout(700); };
await open('system'); await open('cpb'); await open('finance');
for (const a of ['firms', 'households', 'bank']) await open(a);
const res = {};
for (const a of ['firms', 'households', 'bank']) res[a] = { open: await isOpen(a), shocks: await page.locator(`.react-flow__node[data-id="${a}"] .d-input`).count(), subsidies: await page.locator(`.react-flow__node[data-id="${a}"] .u-signal`).count() };
for (const id of ['firms', 'households', 'bank']) {
  await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(900);
  const b = await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox(), m = await page.locator('.map-canvas').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -250); await page.waitForTimeout(120); }
  await page.waitForTimeout(500); await page.screenshot({ path: `${out}/entry_${id}.png`, clip: m });
}
console.log(JSON.stringify({ res, errors }));
await browser.close();

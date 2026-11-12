// The dots on the lines stand still, and run while Play runs.
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Run simulation' }).last().click(); await page.waitForTimeout(12000);
const state = () => page.locator('.flow-dots').evaluateAll(ds => ({ n: ds.length, shown: ds.filter(d => getComputedStyle(d).display !== 'none').length, states: [...new Set(ds.map(d => getComputedStyle(d).animationPlayState))] }));
const r = { before: await state() };
await page.getByRole('button', { name: 'Play through time' }).click(); await page.waitForTimeout(800);
r.playing = await state(); r.cls = await page.locator('.map-canvas').getAttribute('class');
console.log(JSON.stringify(r)); process.exit(0);

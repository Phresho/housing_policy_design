// Opened Firms with the CPB formulas on: the shock and income arrows enter the circuit level, not on a slant.
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page); await page.waitForTimeout(3000);
await page.getByRole('button', { name: 'CPB formulas' }).click(); await page.waitForTimeout(1500);
await page.locator('.react-flow__node[data-id="firms"] button').first().dispatchEvent('click'); await page.waitForTimeout(2000);
await page.locator('.react-flow__controls-fitview').click(); await page.waitForTimeout(1500);
const fb = await page.locator('.react-flow__node[data-id="firms"]').boundingBox();
await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2); for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(250); } await page.waitForTimeout(1200);
// slanted segments of the red disturbance edges
const slant = await page.evaluate(() => [...document.querySelectorAll('.react-flow__edge path')].filter(p => (p.getAttribute('stroke') ?? '').toLowerCase().includes('b3322a') || getComputedStyle(p).stroke.includes('179, 50, 42')).flatMap(p => { const d = p.getAttribute('d') ?? ''; const pts = [...d.matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map(m => [+m[1], +m[2]]); return pts.slice(1).filter((q, i) => Math.abs(q[0] - pts[i][0]) > 1 && Math.abs(q[1] - pts[i][1]) > 1).length; }).reduce((a, b) => a + b, 0));
const b = await page.locator('.react-flow__node[data-id="firms"]').boundingBox();
await page.screenshot({ path: out + '/firms_input.png', clip: { x: Math.max(0, b.x - 300), y: Math.max(0, b.y - 40), width: Math.min(1600 - Math.max(0, b.x - 300), b.width + 340), height: Math.min(1000 - Math.max(0, b.y - 40), b.height + 80) } });
console.log(JSON.stringify({ slant, errors })); process.exit(0);

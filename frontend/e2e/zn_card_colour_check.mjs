// Tour step 10 with the ZN toggle on: the dotted ZN line takes each card's colour (subsidy cyan, year-on-year green).
import { chromium } from 'playwright-core';
import { openPanels, pin } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Guided tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 });
await page.getByRole('button', { name: /^Step 10:/ }).click(); await page.locator('.tour-steps button.on', { hasText: /^10$/ }).waitFor({ timeout: 120000 }); await page.waitForTimeout(8000);
await pin(page, ['u2']); await page.waitForTimeout(800);
const s = page.locator('.react-flow__node[data-id="sensor"]'); const sb = await s.boundingBox(); await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2); await page.waitForTimeout(1500);
await page.getByRole('button', { name: /Ziegler–Nichols PID/ }).click(); await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Play through time' }).click(); await page.waitForTimeout(9000);
const cols = await page.locator('.pin-card').evaluateAll(cs => cs.map(c => ({ title: c.querySelector('.pin-head strong')?.textContent?.slice(0, 30), dotted: [...c.querySelectorAll('polyline')].filter(p => (p.getAttribute('stroke-dasharray') ?? '').startsWith('0.5')).map(p => p.getAttribute('stroke')) })));
await page.locator('.map-body').screenshot({ path: out + '/zn_card_colour.png', timeout: 60000 });
console.log(JSON.stringify({ cols, errors })); process.exit(0);

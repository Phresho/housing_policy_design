// Left column groups: fold/unfold, change dot, Reset all, model-parameter reset. Usage: node e2e/left_groups_check.mjs [port] [outdir]
import { chromium } from 'playwright-core';
const port = process.argv[2] ?? '8001', out = process.argv[3] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await page.locator('.action-bar').getByRole('button', { name: 'Run simulation' }).waitFor(); await page.waitForTimeout(800);
const left = page.locator('.left-dock');
const groups = await left.locator('.lgroup > summary .lg-title').allInnerTexts();
await left.screenshot({ path: `${out}/left_closed.png` });
await left.locator('.lgroup > summary', { hasText: 'Interest rate' }).click(); await page.waitForTimeout(200);
await left.getByRole('slider').first().fill('2');
await page.waitForTimeout(300);
const dots1 = await left.locator('.lg-dirty').count();
await left.screenshot({ path: `${out}/left_open.png` });
await left.getByRole('button', { name: 'Reset all' }).click(); await page.waitForTimeout(300);
const dots2 = await left.locator('.lg-dirty').count();
console.log(JSON.stringify({ groups, dotsAfterChange: dots1, dotsAfterReset: dots2, errors }));
await browser.close();

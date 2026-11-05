// Read-only check: 'Fitted to CBS' sets every slider, also after the CPB comparison changed them. Usage: node e2e/fitted_preset_check.mjs [port]
import { chromium } from 'playwright-core';
const port = process.argv[2] ?? '8001';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1700, height: 1300 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/`); await page.waitForSelector('.react-flow__node', { timeout: 60000 });
const dock = page.locator('.left-dock');
await dock.getByRole('button', { name: 'CPB fit (peaks)' }).click(); await page.waitForTimeout(300);
await dock.getByRole('button', { name: 'Fitted to CBS' }).click(); await page.waitForTimeout(300);
const out = await dock.locator('label.slider').evaluateAll(ls => ls.map(l => `${l.querySelector('.slider-head span')?.textContent}: ${l.querySelector('output')?.textContent}`));
console.log(out.join('\n'));
console.log('bank', await dock.getByText('Bank (financial sector)').locator('xpath=ancestor::label//input').isChecked(), '| income path historical', await dock.getByRole('button', { name: 'Historical', exact: true }).nth(1).getAttribute('aria-pressed'));
console.log('errors', errors); await browser.close();

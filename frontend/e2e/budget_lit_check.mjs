// Tour step 1: clicking the Budget formula lights only the green money flows (no services, goods or subsidies).
import { chromium } from 'playwright-core';
import { openPanels } from './_lib.mjs';
const out = process.argv[2] ?? 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto('http://127.0.0.1:8001/'); await openPanels(page);
await page.getByRole('button', { name: 'Presenter tour' }).click(); await page.locator('.tour-steps button.on').waitFor({ timeout: 120000 }); await page.waitForTimeout(5000);
await page.locator('.eq', { hasText: 'Budget' }).first().click(); await page.waitForTimeout(1500);
const lit = await page.locator('.react-flow__edge.lit').evaluateAll(es => [...new Set(es.map(e => e.getAttribute('data-id')))]);
await page.locator('.map-body').screenshot({ path: out + '/budget_lit.png', timeout: 60000 });
console.log(JSON.stringify({ lit, errors })); process.exit(0);

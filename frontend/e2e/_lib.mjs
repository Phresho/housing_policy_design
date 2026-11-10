// Shared helpers for the e2e scripts: the side panels start closed and the guided tour pins no plots by itself.
export async function openPanels(page) {
  await page.locator('.map-canvas').waitFor({ timeout: 120000 });  // the panel buttons exist once the model map has loaded
  for (const name of ['Open scenario panel', 'Open panel']) { const b = page.getByRole('button', { name, exact: true }); if (await b.count()) await b.first().click(); }
}
// Pin plot cards by clicking lines (edge ids, e.g. 'yout' for the price, 'u2' for the owner subsidy) in the whole-model view.
export async function pin(page, ids) {
  await page.getByRole('button', { name: 'Whole model' }).click(); await page.waitForTimeout(1000);
  for (const id of ids) { const r = page.locator(`.react-flow__edge[data-id="${id}"] .rail-hit`).first(); if (!(await r.count())) continue; const b = await r.boundingBox(); if (b) { await page.mouse.click(b.x + b.width * 0.5, b.y + b.height / 2); await page.waitForTimeout(500); } }
}

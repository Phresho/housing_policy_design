// Save a DOM element as a high-resolution PNG (up to 3x), capped at the browser's canvas limits.
// Elements with a data-no-shot attribute, and the canvas zoom buttons, are left out of the image.
export async function savePng(el: HTMLElement, name: string): Promise<void> {
  const { toPng } = await import('html-to-image');
  const w = el.scrollWidth, h = el.scrollHeight;
  const ratio = Math.min(3, 32000 / w, 32000 / h, Math.sqrt(2.5e8 / (w * h)));
  let bg = getComputedStyle(el).backgroundColor;
  if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') bg = getComputedStyle(document.body).backgroundColor || '#ffffff';
  const url = await toPng(el, { pixelRatio: ratio, width: w, height: h, backgroundColor: bg,
    filter: n => !(n instanceof HTMLElement && (n.dataset.noShot !== undefined || n.classList.contains('react-flow__controls'))) });
  const a = document.createElement('a');
  a.href = url; a.download = `${name}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`; a.click();
}

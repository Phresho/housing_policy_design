// Save a DOM element as a high-resolution PNG (up to 3x), capped at the browser's canvas limits.
// Elements with a data-no-shot attribute, and the canvas zoom buttons, are made invisible during the capture.
// They are hidden, not removed: some are columns of a CSS grid (the collapsed dock tabs), and removing them
// would shift the other columns (the right dock then lands on top of the canvas).
export async function savePng(el: HTMLElement, name: string): Promise<void> {
  const { toPng } = await import('html-to-image');
  const w = el.scrollWidth, h = el.scrollHeight;
  const ratio = Math.min(3, 32000 / w, 32000 / h, Math.sqrt(2.5e8 / (w * h)));
  let bg = getComputedStyle(el).backgroundColor;
  if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') bg = getComputedStyle(document.body).backgroundColor || '#ffffff';
  const hidden = [...document.querySelectorAll<HTMLElement>('[data-no-shot], .react-flow__controls, .dock-toggle')];
  document.documentElement.classList.add('shooting');  // no scrollbars in the image (style.css)
  const before = hidden.map(n => n.style.visibility);
  hidden.forEach(n => { n.style.visibility = 'hidden'; });
  try {
    const url = await toPng(el, { pixelRatio: ratio, width: w, height: h, backgroundColor: bg });
    const a = document.createElement('a');
    a.href = url; a.download = `${name}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`; a.click();
  } finally {
    hidden.forEach((n, i) => { n.style.visibility = before[i]; });
    document.documentElement.classList.remove('shooting');
  }
}

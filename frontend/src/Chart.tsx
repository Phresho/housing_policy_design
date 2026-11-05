import { useEffect, useRef } from 'react';

export interface Line { name: string; x: number[]; y: number[]; color: string; dash?: string; width?: number; bar?: boolean; step?: boolean }

export function Chart({ title, unit, lines, height = 320 }: { title: string; unit: string; lines: Line[]; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    const node = box.current;
    void import('plotly.js-dist-min').then(({ default: Plotly }) => {
      if (!live || !node) return;
      Plotly.react(node, lines.map(l => l.bar ? { type: 'bar', name: l.name, x: l.x, y: l.y, width: 1 / 12 * 0.8, marker: { color: l.color }, hovertemplate: `%{y:.2f}<extra>${l.name}</extra>` } : ({ type: 'scatter', mode: 'lines', name: l.name, x: l.x, y: l.y, line: { color: l.color, dash: l.dash ?? 'solid', width: l.width ?? 2.5, shape: l.step ? 'hv' : 'linear' }, hovertemplate: `%{y:.2f}<extra>${l.name}</extra>` })), {
        bargap: 0,
        height, margin: { l: 58, r: 16, t: 8, b: 40 }, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', hovermode: 'x unified', font: { family: 'Inter, system-ui, sans-serif', size: 12, color: '#3c4a45' },
        legend: { orientation: 'h', y: -0.16 }, xaxis: { title: { text: '' }, gridcolor: '#e8ece9', dtick: 4, zeroline: false, tickformat: 'd' }, yaxis: { title: { text: unit }, gridcolor: '#e8ece9', zerolinecolor: '#aab5b0' },
      }, { displayModeBar: false, responsive: true });
    });
    return () => { live = false; };
  }, [lines, unit, height]);
  return <figure className="chart">{title && <figcaption>{title}</figcaption>}<div ref={box} style={{ minHeight: height }} aria-label={title || unit}/></figure>;
}

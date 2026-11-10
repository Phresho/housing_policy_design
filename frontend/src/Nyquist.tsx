import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { api } from './api';

type NyquistData = {
  re: number[]; im: number[]; cycle_yr: number[];
  gm: { ratio: number; db: number; cycle_yr: number; re: number } | null;
  pm: { deg: number; cycle_yr: number; re: number; im: number } | null;
  ms: number; stable: boolean;
};
const LOOP = '#2b6599', RED = '#c5352a', GM_C = '#a8660c', PM_C = '#3f9a1f';
const f = (v: number, d = 2) => (+v.toFixed(d)).toString();

/** Nyquist plot of the price loop L = C·G (PID times market) with gain and phase margin. Frequencies are shown as
 *  cycle lengths in years. The plot is zoomed on the region around -1, where the margins live. */
export function NyquistPanel({ K, filtered }: { K: [number, number, number]; filtered: boolean }) {
  const [d, setD] = useState<NyquistData>(); const [err, setErr] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true; setErr('');
    const t = window.setTimeout(() => { api<NyquistData>('/analysis/nyquist', { K, filtered }).then(r => { if (live) setD(r); }).catch(e => { if (live) setErr((e as Error).message); }); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [K.join(), filtered]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!d || !box.current) return;
    let live = true;
    const circle = Array.from({ length: 181 }, (_, i) => (i / 180) * 2 * Math.PI);
    const data: object[] = [
      { type: 'scatter', mode: 'lines', name: 'Unit circle |L| = 1', x: circle.map(Math.cos), y: circle.map(Math.sin), line: { color: '#b8c2bd', width: 1.2, dash: 'dot' }, hoverinfo: 'skip' },
      { type: 'scatter', mode: 'lines', name: 'L(jω), ω < 0', x: d.re, y: d.im.map(v => -v), line: { color: LOOP, width: 1.6, dash: 'dash' }, opacity: .45, hoverinfo: 'skip' },
      { type: 'scatter', mode: 'lines', name: 'L(jω) = C·G', x: d.re, y: d.im, customdata: d.cycle_yr, line: { color: LOOP, width: 2.6 }, hovertemplate: 'cycle %{customdata:.2f} yr<br>L = %{x:.2f} %{y:+.2f}j<extra></extra>' },
      { type: 'scatter', mode: 'markers', name: '−1 (instability)', x: [-1], y: [0], marker: { symbol: 'x-thin-open', size: 14, color: RED, line: { width: 3 } }, hoverinfo: 'skip' },
    ];
    const shapes: object[] = [], notes: object[] = [];
    if (d.gm) {
      data.push({ type: 'scatter', mode: 'markers', showlegend: false, x: [d.gm.re], y: [0], marker: { size: 9, color: GM_C }, hoverinfo: 'skip' });
      shapes.push({ type: 'line', x0: -1, x1: d.gm.re, y0: 0, y1: 0, line: { color: GM_C, width: 3 } });
      notes.push({ x: (d.gm.re - 1) / 2, y: 0, yshift: -16, text: `GM ${f(d.gm.ratio)} (${f(d.gm.db, 1)} dB)`, showarrow: false, font: { color: GM_C, size: 12 } });
    }
    if (d.pm) {
      // arc on the unit circle from -1 to the gain crossing
      const a1 = Math.PI, a2 = Math.atan2(d.pm.im, d.pm.re), sweep = ((a2 - a1 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      const arc = Array.from({ length: 41 }, (_, i) => a1 + sweep * i / 40);
      data.push({ type: 'scatter', mode: 'lines', showlegend: false, x: arc.map(Math.cos), y: arc.map(Math.sin), line: { color: PM_C, width: 3 }, hoverinfo: 'skip' },
        { type: 'scatter', mode: 'markers', showlegend: false, x: [d.pm.re], y: [d.pm.im], marker: { size: 9, color: PM_C }, hoverinfo: 'skip' });
      const mid = arc[20];
      notes.push({ x: 1.18 * Math.cos(mid), y: 1.18 * Math.sin(mid), text: `PM ${f(d.pm.deg, 0)}°`, showarrow: false, font: { color: PM_C, size: 12 } });
    }
    const layout = {
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { family: 'Inter, system-ui, sans-serif', size: 12, color: '#3c4a45' },
      height: 360, margin: { l: 48, r: 12, t: 8, b: 40 }, hovermode: 'closest', shapes, annotations: notes,
      xaxis: { title: { text: 'Re L' }, range: [-3, 1.5], zeroline: true, zerolinecolor: '#aab5b0', gridcolor: '#e8ece9' },
      yaxis: { title: { text: 'Im L' }, range: [-2.2, 2.2], scaleanchor: 'x', zeroline: true, zerolinecolor: '#aab5b0', gridcolor: '#e8ece9' },
      legend: { orientation: 'h', y: -0.2, font: { size: 11 } },
    };
    void import('plotly.js-dist-min').then(({ default: Plotly }) => { if (live && box.current) Plotly.react(box.current, data, layout, { displayModeBar: false, responsive: true }); });
    return () => { live = false; };
  }, [d]);
  if (err) return <p className="state-note">{err}</p>;
  if (!d) return <p className="muted small"><LoaderCircle className="spin" size={14}/> Nyquist plot…</p>;
  return <div className="nyquist">
    <h4>Nyquist <small className="muted">loop L = C·G of the price loop, zoomed around −1</small></h4>
    <div ref={box} role="img" aria-label="Nyquist plot of the price loop"/>
    <p className="small">{d.gm ? <>Gain margin <b>{f(d.gm.ratio)}</b> ({f(d.gm.db, 1)} dB) at a {f(d.gm.cycle_yr)}-year cycle</> : 'No −180° crossing: gain margin unlimited'}
      {' · '}{d.pm ? <>phase margin <b>{f(d.pm.deg, 0)}°</b> at a {f(d.pm.cycle_yr, 1)}-year cycle</> : 'no |L| = 1 crossing'}
      {' · '}closest to −1: <b>{f(1 / d.ms)}</b> (Ms {f(d.ms)}) · closed loop {d.stable ? 'stable' : <b style={{ color: RED }}>unstable</b>}</p>
    <p className="muted small">Gain margin: by how much all gains may grow before the loop reaches −1. Phase margin: how much extra delay (as phase) the loop tolerates at the cycle where |L| = 1. Linear model of the netlist at its 2015 operating point.</p>
  </div>;
}

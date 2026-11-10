// Analysis cards that live on the canvas: a Bode plot between two probes, and S, T, KS of the price loop.
import { useEffect, useState } from 'react';
import { api } from './api';
import { COLORS, getOverview, type K3 } from './Analysis';

type Pick = { kind: string; id: string };
type Line = { y: number[]; color: string; dash?: boolean; width?: number };
const tick = (v: number) => v !== 0 && (Math.abs(v) < 0.01 || Math.abs(v) >= 1e4) ? v.toExponential(0) : (+v.toPrecision(2)).toString();

/** Small log-log plot against the cycle length in years, long cycles on the left. */
export function CyclePlot({ x, lines, h = 70, w = 268, logY = true, yLabel, k = 1 }: { x: number[]; lines: Line[]; h?: number; w?: number; logY?: boolean; yLabel?: string; k?: number }) {
  const ok = (v: number) => Number.isFinite(v) && (!logY || v > 0);
  const all = lines.flatMap(l => l.y.filter(ok)), f = (v: number) => logY ? Math.log10(v) : v;
  const lo = Math.min(...all.map(f)), hi = Math.max(...all.map(f)), xl = x.map(v => Math.log10(v)), x0 = Math.max(...xl), x1 = Math.min(...xl);
  const L = 30 * k, B = 12 * k, sx = (v: number) => L + (x0 - Math.log10(v)) / (x0 - x1) * (w - L - 4), sy = (v: number) => h - B - (hi > lo ? (f(v) - lo) / (hi - lo) : .5) * (h - B - 6 * k);
  const ticks = [100, 10, 1, 0.1].filter(c => Math.log10(c) <= x0 && Math.log10(c) >= x1);
  return <svg width={w} height={h} className="mini-plot">
    <rect x={0} y={0} width={w} height={h} fill="#fff"/>
    {ticks.map(c => <g key={c}><line x1={sx(c)} x2={sx(c)} y1={4 * k} y2={h - B} stroke="#eef1ef"/><text x={sx(c)} y={h - 2 * k} textAnchor="middle" className="mini-tick">{c}</text></g>)}
    {logY && lo <= 0 && hi >= 0 && <line x1={L} x2={w} y1={sy(1)} y2={sy(1)} stroke="#c9d1cd"/>}
    {lines.map((l, i) => <polyline key={i} fill="none" stroke={l.color} strokeWidth={(l.width ?? 2.2) * k} strokeDasharray={l.dash ? '4 3' : undefined} points={x.map((v, j) => ok(l.y[j]) ? `${sx(v)},${sy(l.y[j])}` : '').filter(Boolean).join(' ')}/>)}
    <text x={2} y={10 * k} className="mini-tick">{logY ? tick(10 ** hi) : hi.toFixed(0)}</text><text x={2} y={h - B - 2 * k} className="mini-tick">{logY ? tick(10 ** lo) : lo.toFixed(0)}</text>
    {yLabel && <text x={w - 4} y={10 * k} textAnchor="end" className="mini-tick">{yLabel}</text>}
  </svg>;
}

type Transfer = { input: string; output: string; cycle_yr: number[]; gain: number[]; phase_deg: number[]; long_run_gain: number | null };
export function BodeBody({ input, output, feedback, K, filtered, w = 268, h = 140, k = 1 }: { input: Pick; output: Pick; feedback: boolean; K: K3; filtered: boolean; w?: number; h?: number; k?: number }) {
  const [tf, setTf] = useState<Transfer>(); const [err, setErr] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => api<Transfer>('/analysis/transfer', { input, output, feedback, K, filtered }).then(r => { setTf(r); setErr(''); }).catch(e => setErr((e as Error).message)), 120);
    return () => clearTimeout(t);
  }, [input.kind, input.id, output.kind, output.id, feedback, K.join(), filtered]);
  if (err) return <small className="muted">{err}</small>;
  if (!tf) return <small className="muted">Computing…</small>;
  return <>
    <CyclePlot x={tf.cycle_yr} lines={[{ y: tf.gain, color: '#1f6fc4' }]} yLabel="gain" w={w} h={Math.round(h * .6)} k={k}/>
    <CyclePlot x={tf.cycle_yr} lines={[{ y: tf.phase_deg, color: '#6b4fa0' }]} logY={false} w={w} h={Math.round(h * .4)} yLabel="phase °" k={k}/>
    <small>Cycle length in years, long cycles left · {feedback ? 'closed loop' : 'open loop'}{tf.long_run_gain !== null ? ` · long-run gain ${tf.long_run_gain.toPrecision(3)}` : ''}</small>
  </>;
}

type Evaluation = { S: number[]; T: number[]; KS: number[]; limits: Record<'S' | 'T' | 'KS', number> };
type Overview = { cycle_yr: number[]; WP: number[]; WT: number[]; ks_limit: number };
export function SensBody({ K, filtered, settling, overshoot, w = 268, h = 168, k = 1 }: { K: K3; filtered: boolean; settling: number; overshoot: number; w?: number; h?: number; k?: number }) {
  const [ev, setEv] = useState<Evaluation>(); const [ov, setOv] = useState<Overview>(); const [err, setErr] = useState('');
  useEffect(() => { getOverview().then(o => setOv(o as unknown as Overview)).catch(e => setErr(e.message)); }, []);
  useEffect(() => {
    const t = window.setTimeout(() => api<Evaluation>('/analysis/evaluate', { K, filtered, settling_yr: settling, overshoot_pct: overshoot }).then(setEv).catch(e => setErr((e as Error).message)), 120);
    return () => clearTimeout(t);
  }, [K.join(), filtered, settling, overshoot]);
  if (err) return <small className="muted">{err}</small>;
  if (!ev || !ov) return <small className="muted">Computing…</small>;
  const row = (name: 'S' | 'T' | 'KS', y: number[], bound: number[], what: string) => <div className="sens-row">
    <span><b style={{ color: COLORS[name] }}>{name}</b> {what} <em className={ev.limits[name] <= 1 ? 'ok' : 'bad'}>{ev.limits[name] <= 1 ? 'met' : 'missed'} ({ev.limits[name].toFixed(2)})</em></span>
    <CyclePlot x={ov.cycle_yr} w={w} h={Math.round(h / 3)} k={k} lines={[{ y: bound, color: '#E8642B', dash: true, width: 1.5 }, { y, color: COLORS[name] }]}/></div>;
  return <>
    {row('S', ev.S, ov.WP.map(v => 1 / v), 'shocks damped')}
    {row('T', ev.T, ov.WT.map(v => 1 / v), 'silent where the model is wrong')}
    {row('KS', ev.KS, ev.KS.map(() => ov.ks_limit), 'subsidy effort')}
    <small>Dashed: the limit (thesis weights). Cycle length in years, long cycles left.</small>
  </>;
}

/** Year-on-year change: CBS bars (moved by `lag` months) behind the model line. */
export function YoyBody({ year, model, cbs, lag, cpb, w = 356, h = 150, k = 1, ghost }: { year?: number[]; model?: number[]; cbs?: { year: number[]; yoy: number[] }; lag: number; cpb?: { year: number[]; yoy: number[] }; w?: number; h?: number; k?: number; ghost?: number[] }) {
  if (!cbs && !model) return <small className="muted">No data yet.</small>;
  const x0 = 1996, x1 = 2027, cy = cbs ? cbs.year.map(v => v + lag / 12) : [];
  const all = [...(cbs?.yoy ?? []), ...(model ?? []), ...(cpb?.yoy ?? []), ...(ghost ?? [])], lo = Math.min(-2, ...all), hi = Math.max(2, ...all);
  const L = 26 * k, B = 16 * k, sx = (v: number) => L + (v - x0) / (x1 - x0) * (w - L - 4), sy = (v: number) => 6 * k + (hi - v) / (hi - lo) * (h - B - 6 * k), bw = (w - L - 4) / (x1 - x0) / 12;
  return <svg width={w} height={h} className="mini-plot">
    <rect x={0} y={0} width={w} height={h} fill="#fff"/>
    {[2000, 2005, 2010, 2015, 2020, 2025].map(y => <g key={y}><line x1={sx(y)} x2={sx(y)} y1={6 * k} y2={h - B} stroke="#eef1ef"/><text x={sx(y)} y={h - 4 * k} textAnchor="middle" className="mini-tick">{y}</text></g>)}
    {[-5, 0, 5, 10, 15, 20].filter(v => v >= lo && v <= hi).map(v => <g key={v}><line x1={L} x2={w} y1={sy(v)} y2={sy(v)} stroke={v === 0 ? '#aab5b0' : '#f1f3f2'}/><text x={L - 4 * k} y={sy(v) + 3 * k} textAnchor="end" className="mini-tick">{v}</text></g>)}
    {cbs && cy.map((t, i) => t >= x0 && t <= x1 && <rect key={i} x={sx(t) - bw * .4} width={bw * .8} y={Math.min(sy(0), sy(cbs.yoy[i]))} height={Math.abs(sy(cbs.yoy[i]) - sy(0))} fill="#c4c9c6"/>)}
    {cpb && <polyline fill="none" stroke="#3f9a1f" strokeWidth={3.2 * k} strokeDasharray={`${8 * k} ${5 * k}`} points={cpb.year.flatMap((t, i) => [`${sx(t)},${sy(cpb.yoy[i])}`, `${sx(t + 1)},${sy(cpb.yoy[i])}`]).join(' ')}/>}
    {ghost && year && ghost.length === year.length && <polyline fill="none" stroke="#8a9692" strokeWidth={2.6 * k} strokeDasharray={`${7 * k} ${4 * k}`} points={year.map((t, i) => `${sx(t)},${sy(ghost[i])}`).join(' ')}/>}
    {model && year && <polyline fill="none" stroke="#3f9a1f" strokeWidth={4 * k} strokeLinejoin="round" points={year.map((t, i) => `${sx(t)},${sy(model[i])}`).join(' ')}/>}
  </svg>;
}

// System identification (open loop): subsidy u -> house price. Poles, step response, and a design step that changes
// model parameters (factors on R, L, C) to reach a chosen adjustment time / cycle. Backend: analysis.identify,
// analysis.sensitivity, analysis.design_params. All on the linear model at the 2015 operating point.
import { useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { api } from './api';
import type { Scenario } from './types';

interface IdPole { re: number; im: number; cycle_yr: number | null; weight: number }
interface IdMetrics { adjust_yr: number | null; cycle_yr: number | null; dominant: { re: number; im: number } | null; stable: boolean }
export interface Ident {
  poles: IdPole[]; metrics: IdMetrics; final: number | null; step_years: number[]; step: number[];
  peak: { t: number; y: number }; trough: { t: number; y: number } | null; settle_5pct_yr: number | null; scale: Record<string, number>;
  design?: { target_adjust_yr: number; target_cycle_yr: number | null; elements: string[]; changed: Record<string, number>; bounds: [number, number] };
}
interface PathStep { lam: number; poles: [number, number][]; dominant: [number, number] | null }
interface SensRow { name: string; agent: string | null; d_adjust_yr: number; d_cycle_yr: number }

const GREEN = '#3f9a1f', GREY = '#9a9a9a', BLUE = '#2F6FB5', RED = '#c5352a';
const fmt = (v: number | null | undefined, d = 1) => v === null || v === undefined ? '—' : (+v.toFixed(d)).toString();
// Names by place in the circuit only (no economic reading claimed): C2 sits on node N030 (gross imputed rent), C3 on N028 (gross rent).
const LABEL: Record<string, string> = { 'L§Gross_rent': 'L Gross rent', 'L§Gross_imputed_rent': 'L Gross imputed rent', C2: 'C2 (gross-imputed-rent node)', C3: 'C3 (gross-rent node)' };
const nameOf = (n: string) => LABEL[n] ?? n.replace('§', ' ').replace('_', ' ');

function usePlotly(node: React.RefObject<HTMLDivElement | null>, data: object[], layout: object, deps: unknown[]) {
  useEffect(() => {
    let live = true;
    void import('plotly.js-dist-min').then(({ default: Plotly }) => { if (live && node.current) Plotly.react(node.current, data, layout, { displayModeBar: false, responsive: true }); });
    return () => { live = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}
const BASE = { paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { family: 'Inter, system-ui, sans-serif', size: 12, color: '#3c4a45' }, hovermode: 'closest' };

/** Pole map: real part in 1/year; imaginary axis labelled with the cycle length in years (2π/Im), not in rad/year. */
function PoleMap({ id, nominal, preview, path, target }: { id: Ident; nominal?: Ident; preview?: Ident; path?: PathStep[]; target?: { adjust: number | null; cycle: number | null } }) {
  const box = useRef<HTMLDivElement>(null);
  const dom = id.metrics.dominant;
  const pathDom = (preview ? path ?? [] : []).map(st => st.dominant).filter((d): d is [number, number] => !!d);
  // Adjustment time as a decay rate: the response is within 5% after T years when the slowest decay is 3/T (ln 20 = 3.0).
  const rate = (T: number | null | undefined) => T ? -Math.log(20) / T : null;
  const lines = [rate(target?.adjust), rate(id.metrics.adjust_yr), rate(preview?.metrics.adjust_yr)].filter((v): v is number => v !== null);
  const xmin = Math.min(-2.5, ...(dom ? [dom.re * 2.2] : []), ...pathDom.map(d => d[0] * 1.25), ...lines.map(v => v * 1.3));
  const shown = (p: IdPole) => p.re >= xmin;
  // every pole drawn fits: current, proposed, and the dots of the path between them
  const trailIm = (preview ? path ?? [] : []).flatMap(st => st.poles.filter(q => q[0] >= xmin).map(q => Math.abs(q[1])));
  const ims = [...id.poles.filter(shown).map(p => Math.abs(p.im)), ...pathDom.map(d => d[1]), ...trailIm, ...(preview?.poles.filter(shown).map(p => Math.abs(p.im)) ?? []), ...(target?.cycle ? [2 * Math.PI / target.cycle] : [])], ymax = Math.max(1, ...ims) * 1.3;
  // cycle ticks at least ymax/7 apart, so the long cycles near the axis do not pile up
  const cyc = [1, 1.5, 2, 3, 5, 10, 20].filter(c => 2 * Math.PI / c <= ymax && 2 * Math.PI / c >= ymax / 6).reduce<number[]>((kept, c) => kept.length && 2 * Math.PI / kept[kept.length - 1] - 2 * Math.PI / c < ymax / 6 ? kept : [...kept, c], []);
  const ticks = [...cyc.map(c => 2 * Math.PI / c), 0, ...cyc.map(c => -2 * Math.PI / c)];
  const ticktext = [...cyc.map(c => `${c} yr`), '0', ...cyc.map(c => `${c} yr`)];
  const off = id.poles.filter(p => !shown(p)).length;
  const isDom = (p: IdPole) => !!dom && Math.abs(p.re - dom.re) < 1e-3 && Math.abs(Math.abs(p.im) - dom.im) < 1e-3;
  const pts = (ps: IdPole[]) => ({ x: ps.map(p => p.re), y: ps.map(p => p.im) });
  const data: object[] = [];
  if (nominal) data.push({ type: 'scatter', mode: 'markers', name: 'Netlist values', ...pts(nominal.poles.filter(p => p.re >= xmin)), marker: { symbol: 'x-thin-open', size: 11, color: '#c4cbc8', line: { width: 2 } }, hovertemplate: 'netlist pole %{x:.2f}<extra></extra>' });
  data.push({ type: 'scatter', mode: 'markers', name: 'Other poles', ...pts(id.poles.filter(p => shown(p) && !isDom(p))), marker: { symbol: 'x-thin-open', size: 13, color: GREY, line: { width: 3 } }, hovertemplate: 'Re %{x:.2f} /yr<extra></extra>' });
  data.push({ type: 'scatter', mode: 'markers', name: 'Dominant pair', ...pts(id.poles.filter(isDom)), marker: { symbol: 'x-thin-open', size: 18, color: GREEN, line: { width: 4 } }, hovertemplate: 'Re %{x:.2f} /yr<extra></extra>' });
  // Where the poles travel while the parameters move step by step from the old to the new values.
  const moving = !!preview && !!path && path.length > 1, tone = BLUE;
  if (moving) {
    const trail = path!.slice(1, -1).flatMap(st => st.poles.filter(q => q[0] >= xmin));
    data.unshift({ type: 'scatter', mode: 'markers', name: 'Path', x: trail.map(q => q[0]), y: trail.map(q => q[1]), marker: { size: 4, color: tone, opacity: 0.35 }, hoverinfo: 'skip' });
    for (const sgn of [1, -1]) data.push({ type: 'scatter', mode: 'lines', showlegend: false, x: pathDom.map(d => d[0]), y: pathDom.map(d => sgn * d[1]), line: { color: tone, width: 2.4 }, hoverinfo: 'skip' });
  }
  if (preview) data.push({ type: 'scatter', mode: 'markers', name: 'Proposed', x: preview.poles.filter(p => p.re >= xmin).map(p => p.re), y: preview.poles.filter(p => p.re >= xmin).map(p => p.im), marker: { symbol: 'x-thin-open', size: 15, color: BLUE, line: { width: 3 } }, hovertemplate: 'proposed %{x:.2f}<extra></extra>' });
  // Dashed lines from a dominant pole: across to the y-axis (its cycle) and down to the real axis, labelled with the
  // time this pair needs to fall to 5% (3 / decay rate). Green: current model; blue: proposed parameters (labels on the other side).
  // Dashed: the model's full adjustment (vertical, as a decay rate; the same number as the text below) and the cycle of
  // its dominant pair (horizontal). Orange dotted: the values you set.
  const guide = (m: Ident['metrics'] | undefined, color: string, below: boolean, dash = 'dash', label = '', yLabel?: number, mine?: { adjust?: number | null; cycle?: number | null }) => {
    // a value you set that lies on this line (within 3%) is named in its label: '… (yours 4.5)'
    const yours = (v: number | null | undefined, own: number | null | undefined) => own && v && fmt(own, 1) !== fmt(v, 1) && Math.abs(own - v) <= 0.03 * v ? ` (yours ${fmt(own, 1)})` : '';
    const shapes: object[] = [], notes: object[] = [];
    if (!m) return { shapes, notes };
    const x = rate(m.adjust_yr), yc = m.cycle_yr ? 2 * Math.PI / m.cycle_yr : null;
    if (yc) { shapes.push({ type: 'line', x0: xmin, x1: 0, y0: yc, y1: yc, line: { color, width: 1.6, dash } });
      notes.push({ x: xmin, y: yc, xanchor: 'left', yanchor: below ? 'top' : 'bottom', yshift: below ? -3 : 3, xshift: 4, text: `${label}cycle ${fmt(m.cycle_yr, 1)} yr${yours(m.cycle_yr, mine?.cycle)}`, showarrow: false, font: { color, size: 12.5 } }); }
    if (x) { const right = x > xmin * 0.3; shapes.push({ type: 'line', x0: x, x1: x, yref: 'paper', y0: 0, y1: 1, line: { color, width: 1.6, dash } });
      notes.push({ x, y: yLabel ?? (below ? 0.04 : 0.96), yref: 'paper', xanchor: right ? 'right' : 'left', yanchor: below ? 'bottom' : 'top', xshift: right ? -5 : 5, text: `${label}full adjustment ${fmt(m.adjust_yr, 1)} yr${yours(m.adjust_yr, mine?.adjust)}`, showarrow: false, font: { color, size: 12 }, bgcolor: 'rgba(255,255,255,.8)' }); }
    return { shapes, notes };
  };
  const ORANGE = '#e0602b';
  const mine = target ? { adjust: target.adjust, cycle: target.cycle } : undefined;
  const gNow = guide(id.metrics, GREEN, false, 'dash', '', undefined, preview ? undefined : mine), gNew = guide(preview?.metrics, BLUE, true, 'dash', '', undefined, mine);
  // your values: only where they differ from what the model (or the proposal) already shows, so labels do not pile up
  const near = (a: number | null | undefined, b: number | null | undefined) => !!a && !!b && Math.abs(a - b) <= 0.03 * b;
  const shown_ = (v: number | null | undefined, key: 'adjust_yr' | 'cycle_yr') => v && !near(v, id.metrics[key]) && !near(v, preview?.metrics[key]) ? v : null;
  const set = target ? guide({ ...id.metrics, adjust_yr: shown_(target.adjust, 'adjust_yr'), cycle_yr: shown_(target.cycle, 'cycle_yr') }, ORANGE, true, 'dot', 'your ', 0.5) : { shapes: [], notes: [] };
  const guides = [...gNow.shapes, ...gNew.shapes, ...set.shapes];
  const notes: object[] = [...gNow.notes, ...gNew.notes, ...set.notes];
  if (moving && pathDom.length > 3) for (const k of [Math.floor(pathDom.length / 3), Math.floor(2 * pathDom.length / 3), pathDom.length - 1]) for (const sgn of [1, -1]) {
    const [x1, y1] = pathDom[k], [x0, y0] = pathDom[Math.max(0, k - 1)];
    if (Math.hypot(x1 - x0, y1 - y0) > 1e-4) notes.push({ x: x1, y: sgn * y1, ax: x0, ay: sgn * y0, axref: 'x', ayref: 'y', text: '', showarrow: true, arrowhead: 2, arrowsize: 1.4, arrowwidth: 2, arrowcolor: tone } as never);
  }
  if (off) notes.push({ xref: 'paper', yref: 'paper', x: 0, y: 1, xanchor: 'left', yanchor: 'bottom', yshift: 2, text: `← ${off} faster pole${off > 1 ? 's' : ''} further left`, showarrow: false, font: { color: GREY, size: 11 } } as never);
  usePlotly(box, data, {
    ...BASE, height: moving || preview ? 370 : 340, margin: { l: 64, r: 14, t: 22, b: moving || preview ? 108 : 88 }, legend: { orientation: 'h', y: -0.27, yanchor: 'top', entrywidth: 0.5, entrywidthmode: 'fraction', font: { size: 11 }, tracegroupgap: 0 },
    shapes: [...guides, { type: 'rect', xref: 'x', yref: 'paper', x0: 0, x1: 1e3, y0: 0, y1: 1, fillcolor: 'rgba(197,53,42,0.12)', line: { width: 0 }, layer: 'below' },
      { type: 'line', xref: 'x', yref: 'paper', x0: 0, x1: 0, y0: 0, y1: 1, line: { color: '#1f2a26', width: 1.5 } }],
    annotations: [...notes, { x: 0.15, y: ymax * 0.8, text: 'unstable', showarrow: false, font: { color: RED, size: 11 }, textangle: -90 }],
    xaxis: { title: { text: 'Re(s)  [1/year]  (decay rate)' }, range: [xmin, 0.35], gridcolor: '#e8ece9', zeroline: false },
    yaxis: { title: { text: 'Im(s)  as cycle length' }, range: [-ymax, ymax], tickvals: ticks, ticktext, gridcolor: '#e8ece9', zerolinecolor: '#aab5b0' },
  }, [id, nominal, preview, path, target?.adjust, target?.cycle]);
  return <div ref={box} style={{ minHeight: 320 }} role="img" aria-label="Poles of the subsidy to price path"/>;
}

/** Step response of the price to a permanent +1 in the subsidy, with the CPB's zero-order shape for comparison. */
function StepView({ id, nominal, preview }: { id: Ident; nominal?: Ident; preview?: Ident }) {
  const box = useRef<HTMLDivElement>(null);
  const fin = id.final ?? id.step[id.step.length - 1];
  const env = (t: number) => id.poles.reduce((s, p) => s + p.weight * Math.exp(p.re * t), 0);
  const tE = id.step_years.filter(t => t > 0), up = tE.map(t => fin + env(t)), dn = tE.map(t => fin - env(t));
  const pre = [-2, 0];
  const data: object[] = [
    { type: 'scatter', mode: 'lines', name: 'CPB (zero order)', x: [-2, 0, 0, id.step_years[id.step_years.length - 1]], y: [0, 0, fin, fin], line: { color: GREY, dash: 'dash', width: 2.4 } },
  ];
  if (nominal) data.push({ type: 'scatter', mode: 'lines', name: 'Netlist values', x: [...pre, ...nominal.step_years], y: [0, 0, ...nominal.step], line: { color: '#b9c2be', width: 2.4, dash: 'dot' } });
  data.push({ type: 'scatter', mode: 'lines', name: 'Envelope (5%)', x: tE, y: up, line: { color: GREEN, dash: 'dot', width: 1.2 }, hoverinfo: 'skip' },
    { type: 'scatter', mode: 'lines', showlegend: false, x: tE, y: dn, line: { color: GREEN, dash: 'dot', width: 1.2 }, hoverinfo: 'skip' },
    { type: 'scatter', mode: 'lines', name: 'Multiport model', x: [...pre, ...id.step_years], y: [0, 0, ...id.step], line: { color: GREEN, width: 3.4 }, hovertemplate: '%{x:.1f} yr → %{y:.3f}<extra></extra>' });
  if (preview) data.push({ type: 'scatter', mode: 'lines', name: 'Proposed', x: [...pre, ...preview.step_years], y: [0, 0, ...preview.step], line: { color: BLUE, width: 2.6, dash: 'dash' } });
  const all = [...id.step, ...(preview?.step ?? [])], ymin = Math.min(0, ...all), ymax = Math.max(fin, ...all), span = ymax - ymin;
  const shapes: object[] = [], notes: object[] = [];
  const labels: { x: number; y: number; text: string; color: string; prefer: string[] }[] = [];
  // Peak and trough with their times, the gap between them, and the full-adjustment bar, for one response.
  const annotate = (r: Ident, color: string, k: number) => {
    const ink = k ? color : '#1f2a26';  // current model: green lines, black text; the proposal stays blue
    const ms = [{ ...r.peak, label: 'Peak' }, ...(r.trough ? [{ ...r.trough, label: 'Trough' }] : [])];
    data.push({ type: 'scatter', mode: 'markers', showlegend: false, x: ms.map(m => m.t), y: ms.map(m => m.y),
      marker: { size: 10, color: '#fff', line: { color: k ? BLUE : '#1f2a26', width: 2.2 } }, hoverinfo: 'skip' });
    // labels as boxes with a white background (readable over the curves): peak to the left, trough to the right,
    // current model above its markers, the proposal below
    ms.forEach((m, i) => labels.push({ x: m.t, y: m.y, text: `${m.label} · ${fmt(m.t, 1)} yr`, color: k ? BLUE : '#1f2a26', prefer: k ? (i ? ['br', 'tr', 'bl', 'tl'] : ['bl', 'tl', 'br', 'tr']) : (i ? ['tr', 'br', 'tl', 'bl'] : ['tl', 'bl', 'tr', 'br']) }));
    if (r.trough) { const y = ymax + span * (0.2 + 0.14 * k);  // dimension line: peak to trough, one row per response
      shapes.push({ type: 'line', x0: r.peak.t, x1: r.trough.t, y0: y, y1: y, line: { color, width: 1.4 } },
        { type: 'line', x0: r.peak.t, x1: r.peak.t, y0: y - span * 0.025, y1: y + span * 0.025, line: { color, width: 1.4 } }, { type: 'line', x0: r.trough.t, x1: r.trough.t, y0: y - span * 0.025, y1: y + span * 0.025, line: { color, width: 1.4 } });
      notes.push({ x: (r.peak.t + r.trough.t) / 2, y, yanchor: 'bottom', yshift: 1, text: `${fmt(r.trough.t - r.peak.t, 1)} yr`, showarrow: false, font: { color: ink, size: 11.5 } }); }
    const adj = r.metrics.adjust_yr; if (!adj) return;
    const y = ymin - span * (0.12 + 0.13 * k), f = r.final ?? r.step[r.step.length - 1];
    shapes.push({ type: 'line', x0: 0, x1: adj, y0: y, y1: y, line: { color, width: 2 } }, { type: 'line', x0: adj, x1: adj, y0: y, y1: f, line: { color, width: 1, dash: 'dot' } });
    notes.push({ x: adj, y, xanchor: 'left', xshift: 6, text: `full adjustment ≈ ${fmt(adj, 1)} yr`, showarrow: false, font: { color: ink, size: 12.5 } });
  };
  annotate(id, GREEN, 0); if (preview) annotate(preview, BLUE, 1);
  const adj = Math.max(id.metrics.adjust_yr ?? 0, preview?.metrics.adjust_yr ?? 0) || null;
  const lowY = ymin - span * (preview ? 0.38 : 0.24), highY = ymax + span * (preview ? 0.5 : 0.36);
  // Place the peak/trough labels without overlap: estimate each label's box in pixels and take the first corner
  // (top/bottom, left/right of its marker) that hits no label placed so far and no marker.
  {
    const x1 = Math.min(id.step_years[id.step_years.length - 1], Math.max(10, (adj ?? 5) * 2));
    const W = Math.max(300, (box.current?.clientWidth ?? 450) - 78), H = (preview ? 400 : 340) - 10 - 98;
    const px = (x: number) => (x + 2) / (x1 + 2) * W, py = (y: number) => (highY - y) / (highY - lowY) * H;
    const taken: [number, number, number, number][] = labels.map(l => [px(l.x) - 7, py(l.y) - 7, px(l.x) + 7, py(l.y) + 7]);
    const hit = (b: number[]) => taken.some(t => b[0] < t[2] && b[2] > t[0] && b[1] < t[3] && b[3] > t[1]);
    for (const l of labels) {
      const w = l.text.length * 6.1 + 4, h = 15, cx = px(l.x), cy = py(l.y);
      const boxOf = (c: string) => { const left = c[1] === 'l' ? cx - 7 - w : cx + 7, top = c[0] === 't' ? cy - 7 - h : cy + 7; return [left, top, left + w, top + h]; };
      const corner = l.prefer.find(c => !hit(boxOf(c))) ?? l.prefer[0];
      taken.push(boxOf(corner) as [number, number, number, number]);
      notes.push({ x: l.x, y: l.y, text: l.text, showarrow: false, xanchor: corner[1] === 'l' ? 'right' : 'left', yanchor: corner[0] === 't' ? 'bottom' : 'top',
        xshift: corner[1] === 'l' ? -6 : 6, yshift: corner[0] === 't' ? 6 : -6, bgcolor: 'rgba(255,255,255,0.88)', borderpad: 1, font: { color: l.color, size: 11 } });
    }
  }
  usePlotly(box, data, {
    ...BASE, height: preview ? 400 : 340, margin: { l: 64, r: 14, t: 10, b: 98 }, legend: { orientation: 'h', y: -0.3, yanchor: 'top', entrywidth: 0.5, entrywidthmode: 'fraction', font: { size: 11 }, tracegroupgap: 0 }, shapes, annotations: notes,
    xaxis: { title: { text: 'Years after the subsidy change' }, range: [-2, Math.min(id.step_years[id.step_years.length - 1], Math.max(10, (adj ?? 5) * 2))], gridcolor: '#e8ece9', zeroline: false },
    yaxis: { title: { text: 'Change in house price' }, range: [lowY, highY], gridcolor: '#e8ece9', zerolinecolor: '#aab5b0' },
  }, [id, nominal, preview]);
  return <div ref={box} style={{ minHeight: 320 }} role="img" aria-label="Step response of the house price to the subsidy"/>;
}

export function IdentPanel({ scenario, update, onPreview, auto }: { scenario: Scenario; update: (p: Partial<Scenario>) => void; onPreview?: (scale: Record<string, number> | null) => void; auto?: boolean }) {
  // Bank off (original CPB model): the linear model leaves the bank out too (NO_BANK marker, analysis.NO_BANK).
  const own = scenario.param_scale ?? {}, nb: Record<string, number> = scenario.bank ? {} : { NO_BANK: 0 };
  const applied = { ...own, ...nb }, changed = Object.keys(own).length > 0;
  const [id, setId] = useState<Ident>(); const [error, setError] = useState('');
  const [sens, setSens] = useState<SensRow[]>([]); const [chosen, setChosen] = useState<string[] | null>(null);
  const [adjust, setAdjust] = useState<number | null>(null); const [useCycle, setUseCycle] = useState(false); const [cycle, setCycle] = useState<number | null>(null);
  const [preview, setPreview] = useState<Ident>(); const [busy, setBusy] = useState(false);
  const [path, setPath] = useState<PathStep[]>();
  // path from the current model to the proposal, or (no proposal) from the netlist values to the applied ones
  const pathKey = JSON.stringify([applied, preview?.scale ?? null]);
  useEffect(() => {
    const end = preview ? { ...preview.scale, ...nb } : changed ? applied : null, start = preview ? applied : nb;
    if (!end) { setPath(undefined); return; }
    let live = true;
    api<{ path: PathStep[] }>('/analysis/pole_path', { start, end }).then(r => { if (live) setPath(r.path); }).catch(() => undefined);
    return () => { live = false; };
  }, [pathKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = JSON.stringify(applied);
  useEffect(() => {
    setError(''); setPreview(undefined);
    api<Ident>('/analysis/identify', { scale: applied }).then(r => { setId(r); setAdjust(a => a ?? (r.metrics.adjust_yr !== null ? +r.metrics.adjust_yr.toFixed(1) : null)); setCycle(c => c ?? (r.metrics.cycle_yr !== null ? +r.metrics.cycle_yr.toFixed(1) : null)); }).catch(e => setError((e as Error).message));
    api<{ rows: SensRow[] }>('/analysis/sensitivity', { scale: applied }).then(r => { setSens(r.rows); setChosen(c => c ?? r.rows.slice(0, 6).map(x => x.name)); }).catch(() => undefined);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const find = async () => {
    if (!adjust || !chosen?.length) return;
    setBusy(true); setError('');
    try { setPreview(await api<Ident>('/analysis/design_params', { adjust_yr: adjust, cycle_yr: useCycle ? cycle : null, elements: chosen, scale: applied })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  // The proposal goes to the canvas (run with these parameters, blue dashed in the plot cards).
  useEffect(() => { onPreview?.(preview ? preview.scale : null); }, [JSON.stringify(preview?.scale ?? null)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onPreview?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Guided tour: a new adjustment time or cycle fits by itself after a short pause (a fit takes 1-6 s).
  const touched = useRef(false);
  useEffect(() => {
    if (!auto || !touched.current) return;
    const t = window.setTimeout(() => { void find(); }, 700);
    return () => clearTimeout(t);
  }, [auto, adjust, cycle, useCycle]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = id?.metrics;
  // Only elements that matter: +10% changes the adjustment time or the cycle by at least 2% (Claude's threshold).
  const REL = 0.02;
  const rows = useMemo(() => sens.filter(r => (m?.adjust_yr && Math.abs(r.d_adjust_yr) >= REL * m.adjust_yr) || (m?.cycle_yr && Math.abs(r.d_cycle_yr) >= REL * m.cycle_yr)), [sens, m?.adjust_yr, m?.cycle_yr]);
  useEffect(() => { if (rows.length && chosen) { const keep = chosen.filter(n => rows.some(r => r.name === n)); if (keep.length !== chosen.length) setChosen(keep); } }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>
    {error && <p className="state-note">{error}</p>}
    {!id && !error && <p className="muted"><LoaderCircle className="spin" size={14}/> Computing…</p>}
    {id && m && <>
      <h4 className="ident-first">Poles · subsidy → house price, loop open{scenario.bank ? '' : ' · no bank (CPB model)'}</h4><PoleMap id={id} preview={preview} path={path} target={{ adjust, cycle: useCycle ? cycle : null }}/>
      <h4>Step response · +1 in the subsidy</h4><StepView id={id} preview={preview}/>
      <p className="ident-line">Long-run <b>{fmt(id.final, 3)}</b> · peak <b>{fmt(id.peak.y, 3)}</b> after {fmt(id.peak.t, 1)} yr · full adjustment <b>{fmt(m.adjust_yr, 1)} yr</b> · cycle <b>{fmt(m.cycle_yr, 1)} yr</b></p>
      <hr/>
      <h4>Change the model</h4>
      <p className="muted small">Choose how fast the price should adjust; the model finds factors on the chosen R, L, C values (between 0.2 and 5, Claude's bounds, with a small penalty on large changes). The table lists only the values where +10% changes the adjustment time or the cycle by at least 2%; the others hardly matter for this path.</p>
      <div className="ident-form">
        <label>Full adjustment <input type="number" min={0.3} max={40} step={0.1} value={adjust ?? ''} onChange={e => { touched.current = true; setAdjust(Number(e.target.value)); }}/> yr</label>
        <label><input type="checkbox" checked={useCycle} onChange={e => { touched.current = true; setUseCycle(e.target.checked); }}/> and cycle <input type="number" min={0.5} max={40} step={0.1} disabled={!useCycle} value={cycle ?? ''} onChange={e => { touched.current = true; setCycle(Number(e.target.value)); }}/> yr</label>
      </div>
      <table className="pole-table ident-sens"><thead><tr><th></th><th>Element</th><th>Agent</th><th>+10%: adjustment</th><th>cycle</th></tr></thead><tbody>
        {rows.map(r => <tr key={r.name}><td><input type="checkbox" aria-label={`Allow ${r.name} to change`} checked={!!chosen?.includes(r.name)} onChange={e => setChosen(c => e.target.checked ? [...(c ?? []), r.name] : (c ?? []).filter(x => x !== r.name))}/></td>
          <td title={r.name}>{nameOf(r.name)}</td><td>{r.agent ?? ''}</td><td>{r.d_adjust_yr > 0 ? '+' : ''}{fmt(r.d_adjust_yr, 2)} yr</td><td>{r.d_cycle_yr > 0 ? '+' : ''}{fmt(r.d_cycle_yr, 2)} yr</td></tr>)}
      </tbody></table>
      <div className="row"><button className="secondary" disabled={busy || !chosen?.length || !adjust} onClick={find}>{busy ? <><LoaderCircle className="spin" size={14}/> Fitting…</> : 'Fit parameters'}</button>
        {changed && <button className="ghost" onClick={() => update({ param_scale: {} })}>Back to the netlist values</button>}</div>
      {preview?.design && <div className="ident-preview">
        <p><b>Proposed</b> (blue dashed above): full adjustment {fmt(preview.metrics.adjust_yr, 1)} yr (target {fmt(preview.design.target_adjust_yr, 1)}), cycle {fmt(preview.metrics.cycle_yr, 1)} yr{preview.design.target_cycle_yr ? ` (target ${fmt(preview.design.target_cycle_yr, 1)})` : ''}, long-run effect {fmt(preview.final, 3)}{preview.metrics.stable ? '' : ' · UNSTABLE'}.</p>
        <table className="pole-table"><thead><tr><th>Element</th><th>Factor</th></tr></thead><tbody>{Object.entries(preview.design.changed).map(([n, f]) => <tr key={n}><td title={n}>{nameOf(n)}</td><td>× {fmt(f, 2)}</td></tr>)}</tbody></table>
        <button className="primary" onClick={() => update({ param_scale: preview.scale })}>Use in the simulation</button>
      </div>}
      {changed && <p className="state-note">The model runs with changed parameters: {Object.entries(own).map(([n, f]) => `${nameOf(n)} × ${fmt(f, 2)}`).join(', ')}. The H∞ and Ziegler–Nichols gains were designed for the netlist values; check them again. The operating point and the linearised B4 stay those of the netlist.</p>}
      <details className="ident-notes"><summary>About these plots</summary>
        <p className="muted small">A permanent +1 in the owner-occupied subsidy u (model units), loop open. Linear model of the netlist at its 2015 operating point; checked against the simulated netlist (difference below 0.03).</p>
        {path && preview && <p className="muted small">Blue: where the poles move from the current model to the proposed parameters. Dots: all poles at {path.length} steps in between.</p>}
        <p className="muted small">Full adjustment: the time after which all decaying terms of the response together are below 5% of the long-run change (Claude's definition; the measured 5% settling time is {fmt(id.settle_5pct_yr, 1)} yr). Dominant pair: the oscillating poles that show most in the price, not the slowest ones. The CPB line has the same long-run size by construction: only its shape (an immediate jump) is the CPB's.</p>
      </details>
    </>}
  </>;
}

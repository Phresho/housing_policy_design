import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BaseEdge, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, useStore, type Edge, type EdgeProps, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Activity, Camera, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, LoaderCircle, Maximize2, Minus, Pause, Play, Plus } from 'lucide-react';
import { savePng } from './shot';
import { IdentPanel } from './Ident';
import { api } from './api';
import { Chart, type Line } from './Chart';
import { AgentCircuit, CONTROLLER_SIZE, ControllerCircuit, STATE_NOTE, stateOf, type GainKey } from './Schematic';
import type { Element, Flow, MapData, Result, Scenario, Selection } from './types';
import { ControllerLocus, TransferPanel, type Design, type K3, type Pick } from './Analysis';
import { BodeBody, SensBody, YoyBody } from './Cards';

type Point = [number, number];
type Side = 'L' | 'R' | 'T' | 'B';
type Rect = { x: number; y: number; w: number; h: number };
const COLOR = { money: '#4f9a4f', real: '#c98a1b', policy: '#38b2d3' };
const SHOCK = '#c5352a', LOOP = '#3f9a1f';
const NONE: Selection = { kind: 'none', id: '' };
const fmt = (v: number) => Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(3);

export function readTrace(result: Result, signal: string): number[] | undefined {
  if (['owner_subsidy', 'rental_subsidy', 'share_target', 'rental_share'].includes(signal)) return result.series[signal];
  if (signal === 'yoy') return result.series.yoy;
  const lookup = (name: string) => { const wanted = name.toLowerCase(); const key = Object.keys(result.traces).find(k => k.toLowerCase() === wanted); return key ? result.traces[key] : undefined; };
  const pair = /^V\(([^,]+),([^)]+)\)$/.exec(signal);
  if (pair) {
    const a = pair[1] === '0' ? undefined : lookup(`V(${pair[1]})`), b = pair[2] === '0' ? undefined : lookup(`V(${pair[2]})`);
    const base = a ?? b; if (!base) return undefined;
    return base.map((_, i) => (a?.[i] ?? 0) - (b?.[i] ?? 0));
  }
  return lookup(signal);
}
function Spark({ y, color, at }: { y?: number[]; color: string; at: number }) {
  if (!y) return null;
  const lo = Math.min(...y), hi = Math.max(...y), span = hi - lo || 1, w = 64, h = 20, sx = (i: number) => i / (y.length - 1) * w, sy = (v: number) => h - 2 - (v - lo) / span * (h - 4);
  return <svg className="spark" width={w} height={h} aria-hidden="true"><path d={y.filter((_, i) => i % 4 === 0).map((v, i) => `${i ? 'L' : 'M'}${sx(i * 4).toFixed(1)} ${sy(v).toFixed(1)}`).join('')} fill="none" stroke={color} strokeWidth={1.5}/><circle cx={sx(at)} cy={sy(y[at])} r={2.4} fill={color}/></svg>;
}

// ---------- geometry
const SCALE = { collapsed: 0.22, expanded: 0.5, controller: 0.34 };
const len = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const along = (a: Point, b: Point, t: number): Point => { const l = len(a, b) || 1; return [a[0] + (b[0] - a[0]) / l * t, a[1] + (b[1] - a[1]) / l * t]; };
const toPath = (pts: Point[]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
function offset(points: Point[], d: number): Point[] {
  const normal = (a: Point, b: Point): Point => { const l = len(a, b) || 1; return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]; };
  return points.map((p, i) => {
    const n1 = i > 0 ? normal(points[i - 1], p) : normal(p, points[i + 1]), n2 = i < points.length - 1 ? normal(p, points[i + 1]) : n1;
    const same = Math.abs(n1[0] - n2[0]) + Math.abs(n1[1] - n2[1]) < 1e-6;
    return same ? [p[0] + n1[0] * d, p[1] + n1[1] * d] : [p[0] + (n1[0] + n2[0]) * d, p[1] + (n1[1] + n2[1]) * d];
  });
}
function crossings(a: Point[], b: Point[]) {
  let n = 0;
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    const [p, q, r, s] = [a[i - 1], a[i], b[j - 1], b[j]];
    const av = p[0] === q[0], bv = r[0] === s[0];
    if (av === bv) continue;
    const [v1, v2, h1, h2] = av ? [p, q, r, s] : [r, s, p, q];
    const x = v1[0], y = h1[1];
    if (x > Math.min(h1[0], h2[0]) + .5 && x < Math.max(h1[0], h2[0]) - .5 && y > Math.min(v1[1], v2[1]) + .5 && y < Math.max(v1[1], v2[1]) - .5) n++;
  }
  return n;
}
function permutations<T>(xs: T[]): T[][] { return xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map(r => [x, ...r])); }
/** Orthogonal route from P to Q, with the jog on the given lane coordinate. */
function route(P: Point, sp: Side, Q: Point, lane: number): Point[] {
  if ((sp === 'L' || sp === 'R')) return Math.abs(P[1] - Q[1]) < .5 ? [P, Q] : [P, [lane, P[1]], [lane, Q[1]], Q];
  return Math.abs(P[0] - Q[0]) < .5 ? [P, Q] : [P, [P[0], lane], [Q[0], lane], Q];
}
type Wire = { id: string; P: Point; sp: Side; Q: Point; channel: string };
function assignLanes(wires: Wire[], channels: Record<string, [number, number]>) {
  const out: Record<string, Point[]> = {};
  for (const [name, [lo, hi]] of Object.entries(channels)) {
    const group = wires.filter(w => w.channel === name);
    if (!group.length) continue;
    const lanes = group.map((_, i) => lo + (hi - lo) * (i + .5) / group.length);
    let best: Point[][] = [], score = Infinity;
    for (const order of permutations(group.map((_, i) => i)).slice(0, 720)) {
      const paths = group.map((w, i) => route(w.P, w.sp, w.Q, lanes[order[i]]));
      let c = 0;
      for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) c += crossings(paths[i], paths[j]) + crossings(offset(paths[i], 12), paths[j]) + crossings(paths[i], offset(paths[j], 12));
      if (c < score) { score = c; best = paths; }
    }
    group.forEach((w, i) => { out[w.id] = best[i]; });
  }
  return out;
}

// ---------- nodes
type BlockData = { label: string; sub?: string; tone: string; width: number; height: number; selected?: boolean; children?: React.ReactNode; toggle?: () => void; open?: boolean; tab?: 'tl' | 'br' | 'bl' | 'above'; headSpace?: number };
// Open CBS block: how the published numbers are made from the two measurements (netlist 19okt):
//   house price index  = I(Construction_cost) = x1, unscaled;
//   year-on-year (%)   = (x1(t) - x1(t - 1 yr)) / x1(t - 1 yr) x 100   (B§Year_on_year_change1, delay 6 s = 1 year);
//   x2 (new construction) is recorded but does not enter the index.
// Drawn in its own units (1000 x 520); x1 enters at y 218, x2 at 342, the index leaves at 280 (where the canvas wires are).
const CBS_SIZE: Point = [1000, 520], CBS_Y = { x1: 218, x2: 342, out: 280 };
function CbsCircuit({ result, at }: { result: Result | null; at: number }) {
  const x1 = result ? readTrace(result, 'I(Construction_cost)') : undefined, x2 = result ? readTrace(result, 'I(Construction)') : undefined;
  const yr = result ? Math.round(1 / (result.year[1] - result.year[0])) : 10, back = at - yr;
  const v = (t: number[] | undefined, i: number) => t && i >= 0 ? fmt(t[i]) : '–';
  const yoy = result && back >= 0 ? result.series.yoy[at] : undefined;
  const year = result ? result.year[at].toFixed(1) : '';
  const box = (x: number, y: number, w: number, title: string, formula: string, value: string, tone = '') => <g className={'cbs-box ' + tone}>
    <rect x={x} y={y - 46} width={w} height={92} rx={8}/><text className="t" x={x + w / 2} y={y - 14}>{title}</text>
    <text className="f" x={x + w / 2} y={y + 12}>{formula}</text>{result && <text className="v" x={x + w / 2} y={y + 36}>{value}</text>}</g>;
  const wire = (pts: number[][], cls = '') => <path className={'cbs-wire ' + cls} d={pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('')}/>;
  const { x1: a, x2: b, out } = CBS_Y;
  return <svg className="circuit embedded" viewBox={`0 0 ${CBS_SIZE[0]} ${CBS_SIZE[1]}`} preserveAspectRatio="none" role="img" aria-label="Inside CBS: house price index and year-on-year change">
    {wire([[0, a], [300, a]])}{wire([[90, a], [90, 80], [130, 80]])}{wire([[380, 80], [460, 80]])}{wire([[230, a], [230, 160], [630, 160], [630, 126]])}
    <circle cx={90} cy={a} r={7} className="cbs-dot"/><circle cx={230} cy={a} r={7} className="cbs-dot"/>
    {wire([[560, a], [900, a], [900, out], [1000, out]])}{wire([[800, 80], [1000, 80]])}{wire([[0, b], [300, b]], 'muted')}
    {box(130, 80, 250, 'One year earlier', 'x₁(t − 1 yr)', `${v(x1, back)}`)}
    {box(460, 80, 340, 'Year-on-year change', '(x₁(t) − x₁(t−1 yr)) / x₁(t−1 yr) × 100', yoy !== undefined ? `${yoy.toFixed(1)} % a year` : '–', 'yoy')}
    {box(300, a, 260, 'House price index', 'y = x₁ (no scaling)', `${v(x1, at)}`, 'index')}
    {box(300, b, 260, 'New construction', 'x₂: recorded, not in the index', `${v(x2, at)}`, 'muted')}
    <text className="cbs-port" x={8} y={a - 12}>x₁ payments</text><text className="cbs-port" x={8} y={b - 12}>x₂ houses</text>
    <text className="cbs-port" x={992} y={68} textAnchor="end">year-on-year</text><text className="cbs-port" x={992} y={out - 12} textAnchor="end">index y</text>
    <text className="cbs-note" x={20} y={500}>{result ? `Values in ${year}. ` : ''}Year-on-year needs one year of history: it starts after the first model year.</text>
  </svg>;
}
function Block({ data }: NodeProps<Node<BlockData>>) {
  const button = data.toggle && <button className="toggle nodrag" aria-label={`${data.open ? 'Collapse' : 'Expand'} ${data.label}`} onClick={e => { e.stopPropagation(); data.toggle!(); }}>{data.open ? <Minus size={13}/> : <Plus size={13}/>}</button>;
  return <div className={`map-node ${data.tone}${data.open ? ' open' : ''}${data.selected ? ' selected' : ''}`} style={{ width: data.width, height: data.height }}>
    <Handle type="target" position={Position.Left} className="hidden-handle"/><Handle type="source" position={Position.Right} className="hidden-handle"/>
    {data.open ? data.headSpace ? <div className="open-body" style={{ top: data.headSpace }}>{data.children}</div> : <>{data.children}</> : data.label ? <><div className="block-head"><strong>{data.label.replace('\n', ' ')}</strong>{button}</div><div className="block-body">{data.sub && <span>{data.sub}</span>}{data.children}</div></> : <>{button}{data.children}</>}
  </div>;
}
// ---------- probes: one effort e and one flow f per port (supervisor 3.1-3.3)
export type Probe = { flow: string; q: 'e' | 'f' | 's' };  // s: a signal arrow (a disturbance or a subsidy input)
type XY = { x: number; y: number };
type ChartCard = { id: string; kind: 'bode'; from: Probe; to: Probe } | { id: string; kind: 'sens' } | { id: string; kind: 'cbs' };
type CbsData = { year: number[]; yoy: number[]; lag_months: number; corr: number; corr_zero: number; source: string };
type Ctx = { K: K3; filtered: boolean; feedback: boolean; settling: number; overshoot: number };
/** What a probe means as the input of a transfer function (null: it cannot be an input). */
function probeInput(map: MapData, p: Probe): { kind: string; id: string } | null {
  if (p.q === 'e') return null;
  if (p.q === 'f') return { kind: 'flow', id: p.flow };
  if (p.flow === 'y_reference') return { kind: 'signal', id: 'y_reference' };
  if (LOOP_SIGNALS[p.flow]) return null;
  return map.disturbances.some(d => d.id === p.flow) ? { kind: 'signal', id: p.flow } : { kind: 'flow', id: p.flow };
}
type ProbeState = { cardSize?: { w: number; h: number }; pins: Probe[]; sensed: Probe[]; unpin: (p: Probe) => void; dock: (p: Probe) => void; stepAt?: string; charts: ChartCard[]; bodeFrom: Probe | null; setBodeFrom: (p: Probe | null) => void; addBode: (from: Probe, to: Probe, at: XY) => void; addChart: (c: ChartCard, at: XY) => void; removeChart: (id: string) => void; openSensor: () => void; ctx: Ctx; cbs?: CbsData; lag: number; cpb?: { year: number[]; yoy: number[] }; pos: Record<string, XY>; setPos: (id: string, p: XY) => void; place: (p: Probe, at: XY) => void; sense: (p: Probe) => void; show?: (p: Probe, e: React.MouseEvent) => void };
type ProbeActions = { addSens: () => void; hasSens: boolean; pinned: (p: Probe) => boolean; sensed: (p: Probe) => boolean; pin: (p: Probe) => void; sense: (p: Probe) => void; list: Probe[]; count: number; stepInput: string; setStepInput: (id: string) => void };
const probeKey = (p: Probe) => `${p.flow}:${p.q}`;
const probeOf = (id: string): Probe => { const [flow, q] = id.split(':'); return { flow, q: q as Probe['q'] }; };
// Loop signals that open a card when clicked: what they read, their colour, their step output and what 'dock' opens.
const LOOP_SIGNALS: Record<string, { label: string; title: string; signal: string; unit: string; color: string; step: { kind: 'signal' | 'flow'; id: string }; dock: Selection }> = {
  y_reference: { label: 'Target r', title: 'Reference r · House price target', signal: 'I(Reference)', unit: 'Model units', color: '#2b6599', step: { kind: 'signal', id: 'y_reference' }, dock: { kind: 'signal', id: 'y_reference' } },
  y_error: { label: 'Gap e', title: 'Gap e · target minus price', signal: 'I(Error)', unit: 'Model units', color: '#1f2a26', step: { kind: 'signal', id: 'y_error' }, dock: { kind: 'signal', id: 'y_error' } },
  x1: { label: 'Construction payments', title: 'State x₁ · Construction payments', signal: 'I(Construction_cost)', unit: 'Model units', color: '#e0782a', step: { kind: 'signal', id: 'y_price' }, dock: { kind: 'signal', id: 'y_price' } },
  x2: { label: 'New construction', title: 'State x₂ · New construction', signal: 'I(Construction)', unit: '#/year', color: '#c98a1b', step: { kind: 'flow', id: 'houses' }, dock: { kind: 'flow', id: 'houses' } },
  y_price: { label: 'House price', title: 'Output y · House price', signal: 'I(Construction_cost)', unit: 'Model units', color: '#3f9a1f', step: { kind: 'signal', id: 'y_price' }, dock: { kind: 'signal', id: 'y_price' } },
};
function probeInfo(map: MapData, p: Probe) {
  const loop = p.q === 's' ? LOOP_SIGNALS[p.flow] : undefined;
  if (loop) return { f: { id: p.flow, label: loop.label, short: loop.label, kind: 'policy', port: null, unit: loop.unit } as unknown as Flow, signal: loop.signal, title: loop.title, unit: loop.unit, color: loop.color, step: loop.step };
  if (p.q === 's') {
    const d = map.disturbances.find(x => x.id === p.flow), f = map.flows.find(x => x.id === p.flow);
    const label = d?.label ?? f?.label ?? p.flow;
    return { f: f ?? { id: p.flow, label, short: label, kind: 'policy', port: null, unit: d?.unit ?? '' } as unknown as Flow, signal: d?.signal ?? f?.signal, title: `${label} · ${d ? 'disturbance d' : 'subsidy u'}`, unit: d?.unit ?? f?.unit ?? '', color: d ? SHOCK : COLOR.policy,
      step: f ? { kind: 'flow', id: f.id } as const : undefined };
  }
  const f = map.flows.find(x => x.id === p.flow)!;
  const signal = p.q === 'f' ? f.signal : f.port ? (f.port.ret === '0' ? `V(${f.port.node})` : `V(${f.port.node},${f.port.ret})`) : undefined;
  return { f, signal, title: `${f.label} · ${p.q === 'f' ? 'flow f' : 'effort e'}`, unit: p.q === 'f' ? f.unit : 'Model units (node voltage)', color: p.q === 'f' ? COLOR[f.kind] : '#6b4fa0',
    step: { kind: p.q === 'f' ? 'flow' : 'effort', id: f.id } as const };
}
function MiniPlot({ y, at, color, w = 240, h = 92, k = 1, label }: { y: number[]; at?: number; color: string; w?: number; h?: number; k?: number; label?: string }) {
  // White space above and below the line (10% of the range plus room for the max/min labels), so a step that jumps
  // straight to its final value does not run along the top edge.
  const lo = Math.min(...y), hi = Math.max(...y), pad = (hi - lo) * .1, top = 18 * k, bot = 16 * k;
  const sx = (i: number) => 4 + i / (y.length - 1) * (w - 8), sy = (v: number) => h - bot - (hi > lo ? (v - lo + pad) / (hi - lo + 2 * pad) : .5) * (h - top - bot);
  // With a time marker: the line up to that time is dark, the rest faint, and a dot with the year rides on it (Play).
  const pts = (a: number, b: number) => y.slice(a, b).map((v, i) => `${sx(a + i)},${sy(v)}`).join(' ');
  const lx = at !== undefined ? Math.min(Math.max(sx(at), 18 * k), w - 18 * k) : 0, ly = at !== undefined ? (sy(y[at]) < h / 2 ? sy(y[at]) + 15 * k : sy(y[at]) - 8 * k) : 0;
  return <svg width={w} height={h} className="mini-plot"><rect x={0} y={0} width={w} height={h} fill="#fff"/>
    {lo < 0 && hi > 0 && <line x1={0} x2={w} y1={sy(0)} y2={sy(0)} stroke="#d5dbd8"/>}
    <polyline fill="none" stroke={color} strokeOpacity={at !== undefined ? .22 : 1} strokeWidth={2.2 * k} strokeLinejoin="round" points={pts(0, y.length)}/>
    {at !== undefined && <><polyline fill="none" stroke={color} strokeWidth={2.4 * k} strokeLinejoin="round" points={pts(0, at + 1)}/>
      <line x1={sx(at)} x2={sx(at)} y1={2} y2={h - 2} stroke="#8a9692" strokeDasharray="3 3"/><circle cx={sx(at)} cy={sy(y[at])} r={3.6 * k} fill={color} stroke="#fff" strokeWidth={1.2 * k}/>
      {label && <text x={lx} y={ly} textAnchor="middle" className="mini-year">{label}</text>}</>}
    <text x={w - 4} y={11 * k} textAnchor="end" className="mini-tick">{fmt(hi)}</text><text x={w - 4} y={h - 6 * k} textAnchor="end" className="mini-tick">{fmt(lo)}</text></svg>;
}
// Card buttons (Bode, →CBS, dock, close) hidden behind a small arrow, so the title has room. Shown while a Bode plot
// is being built, so the output card's Bode→ can be clicked.
function PinTools({ children, keepOpen }: { children: React.ReactNode; keepOpen?: boolean }) {
  const [open, setOpen] = useState(false), show = open || !!keepOpen;
  return <span className={'pin-tools' + (show ? ' open' : '')}>{show && children}
    {!keepOpen && <button className="tools-toggle" aria-label={show ? 'Hide the card buttons' : 'Show the card buttons'} title={show ? 'Hide the buttons' : 'Bode, send to CBS, dock, remove'} onClick={() => setOpen(o => !o)}>{show ? '›' : '‹'}</button>}</span>;
}
// Plot cards live in their own layer, scaled with the canvas but drawn above the block headers.
const PIN_W = 252, PIN_H = 150;
export type StepData = { input: string; responses: Record<string, { t?: number[]; y?: number[]; error?: string }> } | null;
function PinLayer({ map, probes, result, at, fallback, steps }: { map: MapData; probes: ProbeState; result: Result | null; at: number; fallback: Record<string, XY>; steps?: StepData }) {
  const [tx, ty, k] = useStore(s => s.transform);
  const [live, setLive] = useState<{ id: string; x: number; y: number } | null>(null);
  const [size, setSize] = useState<Record<string, { w: number; h: number }>>({});  // card sizes in model units, kept while the canvas lives
  const resize = (id: string, start: { w: number; h: number }) => (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault(); const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY;
    const move = (m: PointerEvent) => setSize(old => ({ ...old, [id]: { w: Math.max(180, start.w + (m.clientX - x0) / k), h: Math.max(110, start.h + (m.clientY - y0) / k) } }));
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };
  const DEFAULT: Record<string, { w: number; h: number }> = { probe: probes.cardSize ?? { w: PIN_W, h: PIN_H }, cbs: { w: 372, h: 200 }, bode: { w: 284, h: 210 }, sens: { w: 284, h: 260 } };
  const sz = (id: string, kind: string) => size[id] ?? DEFAULT[kind];
  const handle = (id: string, kind: string) => <span className="card-resize" title="Drag to resize" aria-label="Resize" style={{ width: 18 / k, height: 18 / k }} onPointerDown={resize(id, sz(id, kind))}/>;
  const rf = useReactFlow();
  // Cards sit outside the zoom pane, so zoom around the pointer ourselves when the wheel turns over a card.
  const wheel = (e: React.WheelEvent) => {
    const box = (e.currentTarget as HTMLElement).closest('.react-flow')!.getBoundingClientRect(), px = e.clientX - box.left, py = e.clientY - box.top;
    const k2 = Math.min(4, Math.max(.1, k * Math.exp(-e.deltaY * .002)));
    rf.setViewport({ x: px - (px - tx) * k2 / k, y: py - (py - ty) * k2 / k, zoom: k2 });
  };
  const drag = (id: string, start: XY) => (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.stopPropagation(); const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY; let last = start;
    const move = (m: PointerEvent) => { last = { x: start.x + (m.clientX - x0) / k, y: start.y + (m.clientY - y0) / k }; setLive({ id, ...last }); };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); probes.setPos(id, last); setLive(null); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };
  const at_ = (id: string, i = 0): XY => (live?.id === id ? live : probes.pos[id] ?? fallback[id] ?? { x: 0, y: i * (PIN_H + 20) });
  const charts = probes.charts.map((c, i) => {
    const id = c.id, pos = at_(id, i), base = probes.pos[id] ?? fallback[id] ?? { x: 0, y: 0 };
    const title = c.kind === 'sens' ? 'S, T, KS · price loop' : c.kind === 'cbs' ? 'Year-on-year house price change · model and CBS' : `Bode · ${probeInfo(map, c.from).f.label} → ${probeInfo(map, c.to).f.label}`;
    const S = sz(id, c.kind), bw = S.w - 16, D = DEFAULT[c.kind], f = Math.max(1, Math.min(S.w / D.w, S.h / D.h));
    return <div key={id} className={'pin-card chart-card ' + c.kind} style={{ left: pos.x, top: pos.y, width: S.w, height: S.h, ['--s' as string]: f }} onPointerDown={drag(id, base)}>{handle(id, c.kind)}
      <div className="pin-head"><strong title={title}>{title}</strong>{c.kind === 'cbs' && <PinTools><button aria-label="Send to the dock" title="Open the CBS sensor in the dock" onClick={probes.openSensor}>⇥</button></PinTools>}<button className="pin-close" aria-label="Remove from the canvas" title="Remove from the canvas" onClick={() => probes.removeChart(id)}>×</button></div>
      {c.kind === 'cbs' ? <><YoyBody k={f} w={bw} h={S.h - 64 * f} year={result?.year} model={result?.scenario.inflation_pct ? result.series.yoy.map(v => v + result.scenario.inflation_pct) : result?.series.yoy} cbs={probes.cbs} lag={probes.lag} cpb={probes.cpb}/><small>Green: model run{result ? '' : ' (run the simulation)'}.{probes.cpb ? ' Green dashed: CPB model.' : ''} Grey: CBS index, moved {probes.lag} month{Math.abs(probes.lag) === 1 ? '' : 's'}. % a year.</small></>
      : c.kind === 'sens' ? <SensBody k={f} w={bw} h={S.h - 100 * f} K={probes.ctx.K} filtered={probes.ctx.filtered} settling={probes.ctx.settling} overshoot={probes.ctx.overshoot}/>
        : <BodeBody k={f} w={bw} h={S.h - 74 * f} input={probeInput(map, c.from)!} output={probeInfo(map, c.to).step!} feedback={probes.ctx.feedback} K={probes.ctx.K} filtered={probes.ctx.filtered}/>}</div>;
  });
  const links = probes.charts.filter(c => c.kind === 'bode').flatMap(c => { if (c.kind !== 'bode') return []; const b = at_(c.id), m = { x: b.x + PIN_W / 2, y: b.y };
    return ([[c.from, 'in'], [c.to, 'out']] as const).map(([p, role]) => { const a = at_(`pin-${probeKey(p)}`); return <g key={c.id + role}><line x1={a.x + PIN_W / 2} y1={a.y + PIN_H} x2={m.x} y2={m.y} className="bode-link"/><text x={(a.x + PIN_W / 2 + m.x) / 2 + 6} y={(a.y + PIN_H + m.y) / 2} className="bode-link-label">{role}</text></g>; }); });
  return <div className="pin-layer" style={{ transform: `translate(${tx}px, ${ty}px) scale(${k})` }} onWheel={wheel}><svg className="pin-links">{links}</svg>{charts}{probes.pins.map((p, i) => {
    const id = `pin-${probeKey(p)}`, info = probeInfo(map, p), base = probes.pos[id] ?? fallback[id] ?? { x: 0, y: i * (PIN_H + 20) }, pos = live?.id === id ? live : base;
    const y = result && info.signal ? readTrace(result, info.signal) : undefined, color = info.color;
    const st = steps && (info.step ? steps.responses[`${info.step.kind}:${info.step.id}`] : { error: 'An input: no step response' });
    const sent = probes.sensed.some(q => probeKey(q) === probeKey(p));
    const S = sz(id, 'probe'), f = Math.max(1, Math.min(S.w / PIN_W, S.h / PIN_H)), pw = S.w - 12 * f, ph = S.h - 58 * f;
    return <div key={id} className={'pin-card' + (steps ? ' step-mode' : '')} style={{ left: pos.x, top: pos.y, width: S.w, height: S.h, ['--s' as string]: f }} onPointerDown={drag(id, base)}>{handle(id, 'probe')}
      <div className="pin-head"><strong title={info.title}>{steps ? `${info.f.label} · step response` : info.title}</strong><PinTools keepOpen={!!probes.bodeFrom}>
        {(() => { const from = probes.bodeFrom, isFrom = !!from && probeKey(from) === probeKey(p), canIn = !!probeInput(map, p);
          return from ? <button className={isFrom ? 'on' : 'bode-ready'} title={isFrom ? 'Cancel the Bode plot' : 'Bode plot from the marked input to this signal'} aria-label={isFrom ? 'Cancel Bode' : 'Bode to here'}
              onClick={() => { if (isFrom) probes.setBodeFrom(null); else { const a = probes.pos[`pin-${probeKey(from)}`] ?? fallback[`pin-${probeKey(from)}`] ?? pos; probes.addBode(from, p, { x: (a.x + pos.x) / 2 + 20, y: (a.y + pos.y) / 2 + PIN_H + 30 }); } }}>{isFrom ? 'in ✕' : 'Bode→'}</button>
            : <button disabled={!canIn} title={canIn ? 'Use as the input of a Bode plot, then click Bode→ on the output card' : 'An effort or an output cannot be an input'} aria-label="Bode from here" onClick={() => probes.setBodeFrom(p)}>Bode</button>; })()}
        <button className={sent ? 'on' : ''} aria-label={sent ? 'Stop sending to CBS' : 'Send to CBS'} title={sent ? 'Stop sending to CBS' : 'Send to CBS'} onClick={() => probes.sense(p)}>→CBS</button>
        <button aria-label="Send to the dock" title="Send to the dock" onClick={() => probes.dock(p)}>⇥</button>
        </PinTools><button className="pin-close" aria-label="Remove from the canvas" title="Remove from the canvas" onClick={() => probes.unpin(p)}>×</button></div>
      {steps ? st?.y ? <><MiniPlot y={st.y} color={color} w={pw} h={ph} k={f}/><small>Step response to {steps.input} +1 · after {st.t![st.t!.length - 1].toFixed(0)} yr: <b>{fmt(st.y[st.y.length - 1])}</b></small></> : <small className="muted">{st?.error ?? 'Computing…'}</small>
        : y ? <><MiniPlot y={y} at={at} color={color} w={pw} h={ph} k={f} label={result!.year[at].toFixed(1)}/><small>{result!.year[at].toFixed(1)}: <b>{fmt(y[at])}</b></small></> : <small className="muted">Run the simulation to see this signal.</small>}</div>;
  })}</div>;
}
const nodeTypes = { block: Block };

// Header bars of open blocks, drawn in screen space so they keep one size and stay visible when zoomed in:
// a header sits on its block's top edge and, once that edge scrolls out of view, sticks to the top of the canvas
// (below the headers of the blocks that contain it) until the block itself leaves the view.
const HEAD_FLOW = 30, HEAD_MAX = 30; // header height in model units, and its cap in screen pixels
const DEPTH: Record<string, number> = { 'system-group': 0, controller: 0, 'sub-group': 1, agent: 2 };
function StickyHeaders({ nodes, lab = 1 }: { nodes: Node<BlockData>[]; lab?: number }) {
  const [tx, ty, k] = useStore(s => s.transform), W = useStore(s => s.width), H = useStore(s => s.height);
  return <div className="sticky-heads">{nodes.filter(n => n.data.open).map(n => {
    const d = n.data, depth = DEPTH[d.tone.split(' ')[0]] ?? 0, HEAD_H = Math.min(HEAD_MAX * lab, HEAD_FLOW * lab * k);
    const left = tx + n.position.x * k, top = ty + n.position.y * k, right = left + d.width * k, bottom = top + d.height * k;
    const x0 = Math.max(left, 0), x1 = Math.min(right, W);
    if (x1 - x0 < 20 || bottom < depth * HEAD_H + HEAD_H || top > H) return null;
    const y = Math.min(Math.max(top, depth * HEAD_H), bottom - HEAD_H);
    return <div key={n.id} className={`sticky-head ${d.tone}`} style={{ left: x0, top: y, width: x1 - x0, height: HEAD_H, zIndex: 10 + depth, fontSize: HEAD_H * .5, padding: `0 ${HEAD_H * .3}px` }}>
      <strong>{d.label.replace('\n', ' ')}</strong>
      {d.toggle && HEAD_H > 14 && <button className="toggle" style={{ width: HEAD_H * .7, height: HEAD_H * .7 }} aria-label={`Collapse ${d.label}`} onClick={e => { e.stopPropagation(); d.toggle!(); }}><Minus size={13}/></button>}
    </div>;
  })}</div>;
}

// ---------- edges
type RailData = { points: Point[]; color: string; name: string; value?: string; selected?: boolean; labelT: number; side: number; pick: (e?: React.MouseEvent) => void; menu?: (e: React.MouseEvent) => void; probe?: (q: 'e' | 'f', e: React.MouseEvent) => void; probed?: ('e' | 'f')[]; animate?: boolean };
function PortPair({ a, b, ra, rb, color }: { a: Point; b: Point; ra: Point; rb: Point; color: string }) {
  const e1 = along(a, b, 11), e2 = along(ra, rb, 11), em: Point = [(e1[0] + e2[0]) / 2, (e1[1] + e2[1]) / 2], f = along(a, b, 27), t1 = along(a, b, 39), t2 = along(ra, rb, 39);
  return <g className="pair-mark"><path d={`M${e1[0]} ${e1[1]}L${e2[0]} ${e2[1]}`} stroke={color} strokeWidth={1.2}/>
    <circle cx={em[0]} cy={em[1]} r={6.2} fill="#fff" stroke={color} strokeWidth={1.2}/><text x={em[0]} y={em[1] + 3} fill={color}>e</text>
    <circle cx={f[0]} cy={f[1]} r={6.2} fill="#fff" stroke={color} strokeWidth={1.2}/><text x={f[0]} y={f[1] + 3} fill={color}>f</text>
    <circle cx={t1[0]} cy={t1[1]} r={2.6} fill="#fff" stroke={color}/><circle cx={t2[0]} cy={t2[1]} r={2.6} fill="#fff" stroke={color}/></g>;
}
function longest(points: Point[]) { let k = 1; for (let i = 2; i < points.length; i++) if (len(points[i - 1], points[i]) > len(points[k - 1], points[k])) k = i; return k; }
function Rail({ id, data }: EdgeProps<Edge<RailData>>) {
  const d = data!, back = offset(d.points, 12 * d.side), n = d.points.length, k = longest(d.points);
  const [p, q] = [d.points[k - 1], d.points[k]], mid = along(p, q, len(p, q) * d.labelT), dir = along([0, 0], [q[0] - p[0], q[1] - p[1]], 1), vertical = Math.abs(dir[1]) > .5;
  const tri = along(p, q, len(p, q) * (d.labelT < .5 ? .62 : .38)), angle = Math.atan2(dir[1], dir[0]) * 180 / Math.PI;
  // Name on the flow-rail side, away from the return rail.
  const lx = vertical ? mid[0] - 8 * Math.sign(back[k][0] - p[0] || 1) : mid[0], ly = vertical ? mid[1] : mid[1] - 8 * Math.sign(back[k][1] - p[1] || 1) + (Math.sign(back[k][1] - p[1]) > 0 ? 0 : 9);
  const labelAngle = vertical ? -90 : 0;
  // Horizontal names sit at alternating ends of their segment, so parallel pairs never collide.
  // Horizontal names go to the far left or far right of the whole connection, at that end's height.
  const near = d.labelT < .5, ends = [d.points[0], d.points[n - 1]], flat = !vertical && d.points[0][1] === d.points[1][1] && d.points[n - 1][1] === d.points[n - 2][1];
  const pick = flat ? (near ? ends.reduce((a, b) => a[0] < b[0] ? a : b) : ends.reduce((a, b) => a[0] > b[0] ? a : b)) : null;
  const left = Math.min(p[0], q[0]), right = Math.max(p[0], q[0]);
  const anchor = vertical ? 'middle' : near ? 'start' : 'end';
  const tx = vertical ? lx : pick ? pick[0] + (near ? 48 : -48) : near ? left + 48 : right - 48;
  const ty = pick ? pick[1] - 8 * Math.sign(back[d.points.indexOf(pick) === 0 ? 0 : n - 1][1] - pick[1] || 1) + (Math.sign(back[d.points.indexOf(pick) === 0 ? 0 : n - 1][1] - pick[1]) > 0 ? 0 : 9) : ly;
  return <g className={'rail' + (d.selected ? ' selected' : '')}>
    <path d={toPath(back)} fill="none" stroke={d.color} strokeWidth={1.4} strokeOpacity={.75}/>
    <BaseEdge id={id} path={toPath(d.points)} style={{ stroke: d.color, strokeWidth: d.selected ? 4.2 : 2.4 }}/>
    {d.animate && <path d={toPath(d.points)} className="flow-dots" stroke={d.color}/>}
    <path d="M-6 -5L5 0L-6 5Z" fill={d.color} transform={`translate(${tri[0]} ${tri[1]}) rotate(${angle})`}/>
    <PortPair a={d.points[0]} b={d.points[1]} ra={back[0]} rb={back[1]} color={d.color}/><PortPair a={d.points[n - 1]} b={d.points[n - 2]} ra={back[n - 1]} rb={back[n - 2]} color={d.color}/>
    <text className="rail-name" transform={`translate(${tx} ${ty}) rotate(${labelAngle})`} textAnchor={anchor} fill={d.color}>{d.name}{d.value && <tspan className="rail-value" dx={5}>{d.value}</tspan>}</text>
    <path className="rail-hit" d={toPath(d.points)} onClick={d.pick} onContextMenu={d.menu}/><path className="rail-hit" d={toPath(back)} onClick={d.pick} onContextMenu={d.menu}/>
    {d.probe && ([[d.points[0], d.points[1], back[0], back[1]], [d.points[n - 1], d.points[n - 2], back[n - 1], back[n - 2]]] as Point[][]).map(([a, b, ra, rb], j) => {
      const e1 = along(a, b, 11), e2 = along(ra, rb, 11), em: Point = [(e1[0] + e2[0]) / 2, (e1[1] + e2[1]) / 2], f = along(a, b, 27);
      return <g key={j}>{(['e', 'f'] as const).map(q => { const c = q === 'e' ? em : f; return <circle key={q} cx={c[0]} cy={c[1]} r={7.5} className={'probe-hit' + (d.probed?.includes(q) ? ' on' : '')} stroke={d.color} onClick={e => { e.stopPropagation(); d.probe!(q, e); }}><title>{q === 'e' ? 'Effort e: click to plot' : 'Flow f: click to plot'}</title></circle>; })}</g>;
    })}
  </g>;
}
type SignalData = { points: Point[]; lab?: number; color: string; letter: string; name?: string; sub?: string; value?: string; markAt?: number; markDist?: number; dashed?: boolean; selected?: boolean; pick?: (e?: React.MouseEvent) => void; labelSide?: 'right' | 'left' | 'above' | 'below'; target?: Selection; menu?: (e: React.MouseEvent) => void; switchAt?: Point; switchOpen?: boolean; onSwitch?: () => void; animate?: boolean };
function Signal({ id, data }: EdgeProps<Edge<SignalData>>) {
  const d = data!, k = d.markAt ?? 1, [p, q] = [d.points[k - 1], d.points[k]], m = along(p, q, d.markDist ?? Math.min(len(p, q) / 2, 60));
  const side = d.labelSide ?? (Math.abs(q[0] - p[0]) < .5 ? 'right' : 'above');
  const L = d.lab ?? 1; // label size factor (Label size slider)
  const lx = side === 'right' ? m[0] + 13 : side === 'left' ? m[0] - 13 : m[0], ly = side === 'above' ? m[1] - (d.value ? 26 * L : 13 * L) : side === 'below' ? m[1] + 22 * L : m[1] - 2;
  return <g className={'signal' + (d.selected ? ' selected' : '')}>
    <defs><marker id={`s-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0 10 5 0 10z" fill={d.color}/></marker></defs>
    <BaseEdge id={id} path={toPath(d.points)} markerEnd={`url(#s-${id})`} style={{ stroke: d.color, strokeWidth: d.selected ? 3.2 : 1.6, strokeDasharray: d.dashed ? '6 5' : undefined }}/>
    {d.animate && !d.dashed && <path d={toPath(d.points)} className="flow-dots small" stroke={d.color}/>}
    <circle cx={m[0]} cy={m[1]} r={8} fill="#fff" stroke={d.color} strokeWidth={1.3}/><text className="sig-letter" x={m[0]} y={m[1] + 3.6} fill={d.color}>{d.letter}</text>
    {d.name && <text className="sig-name" style={{ fontSize: 11.5 * L }} x={lx} y={ly} textAnchor={side === 'right' ? 'start' : side === 'left' ? 'end' : 'middle'} fill={d.color}>{d.name}{d.value && <tspan className="sig-value" style={{ fontSize: 11 * L }} x={lx} dy={13 * L}>{d.value}</tspan>}</text>}
    {d.sub && <text className="sig-sub" style={{ fontSize: 11 * L }} x={side === 'right' ? m[0] - 13 : side === 'left' ? m[0] + 13 : m[0]} y={side === 'above' ? m[1] + 22 * L : side === 'below' ? m[1] - 13 * L : m[1] + 4} textAnchor={side === 'right' ? 'end' : side === 'left' ? 'start' : 'middle'} fill={d.color}>{d.sub}</text>}
    {d.pick && <path className="rail-hit" d={toPath(d.points)} onClick={d.pick} onContextMenu={d.menu}/>}
    {d.switchAt && <g className="loop-switch" role="switch" aria-checked={!d.switchOpen} aria-label="Feedback loop switch" tabIndex={0} onClick={e => { e.stopPropagation(); d.onSwitch?.(); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') d.onSwitch?.(); }}>
      <title>{d.switchOpen ? 'Loop open: click to close the feedback loop' : 'Loop closed: click to open the feedback loop'}</title>
      <rect x={d.switchAt[0] - 24} y={d.switchAt[1] - 24} width={48} height={36} fill="#fff" opacity={0.01}/>
      <line x1={d.switchAt[0] - 20} x2={d.switchAt[0] + 20} y1={d.switchAt[1]} y2={d.switchAt[1]} stroke="#fff" strokeWidth={5}/>
      <circle cx={d.switchAt[0] - 14} cy={d.switchAt[1]} r={3} fill="#fff" stroke={d.color} strokeWidth={1.6}/><circle cx={d.switchAt[0] + 14} cy={d.switchAt[1]} r={3} fill="#fff" stroke={d.color} strokeWidth={1.6}/>
      <line x1={d.switchAt[0] - 11} y1={d.switchAt[1]} x2={d.switchAt[0] + (d.switchOpen ? 9 : 11)} y2={d.switchAt[1] - (d.switchOpen ? 14 : 0)} stroke={d.color} strokeWidth={2.2} strokeLinecap="round"/>
      <text className="sig-sub" x={d.switchAt[0]} y={d.switchAt[1] + 22} textAnchor="middle" fill={d.color}>{d.switchOpen ? 'loop open' : 'loop closed'}</text>
    </g>}
  </g>;
}
const edgeTypes = { rail: Rail, signal: Signal };

const TAB: Record<string, 'tl' | 'br' | 'bl'> = { households: 'br', investors: 'br', firms: 'br', bank: 'br', constructors: 'bl' };

const STEP = 1.1; // one click = 10% up or down (Claude's choice of step)
export const stepPatch = (scenario: Scenario, k: GainKey, up: boolean): Partial<Scenario> => {
  const v = +(scenario[k] * (up ? STEP : 1 / STEP)).toFixed(3), min = k === 'ki' ? 0.01 : 0;
  return k.startsWith('s') ? { [k]: Math.max(min, v) } : { controller: 'custom', [k]: Math.max(min, v) };
};
function GainSteps({ scenario, update }: { scenario: Scenario; update: (patch: Partial<Scenario>) => void }) {
  const step = (k: GainKey, up: boolean) => update(stepPatch(scenario, k, up));
  const row = (k: GainKey, name: string) => <div className="gain-step" key={k}><span>{name}</span><output>{scenario[k].toFixed(3)}</output>
    <button className="ghost" aria-label={`${name} down 10%`} onClick={() => step(k, false)}><ChevronDown size={14}/></button><button className="ghost" aria-label={`${name} up 10%`} onClick={() => step(k, true)}><ChevronUp size={14}/></button></div>;
  return <><h4>{scenario.share_control && scenario.feedback ? 'Price PID gains' : 'PID gains'} <small className="muted">model units, ±10% a click</small></h4>
    {row('kp', 'Kp')}{row('ki', 'Ki')}{row('kd', 'Kd')}
    <label className="check"><input type="checkbox" checked={scenario.derivative_filter} onChange={e => update({ controller: 'custom', derivative_filter: e.target.checked })}/> Derivative filter (cycle of 0.5 years)</label>
    {scenario.share_control && scenario.feedback && <><h4>Rental-share PID gains</h4>{row('skp', 'Kp')}{row('ski', 'Ki')}{row('skd', 'Kd')}</>}
    {!scenario.feedback && <p className="muted small">The gains act once the loop switch is closed.</p>}
    <p className="muted small">A step sets the price PID to Custom. Run again to see the effect.</p></>;
}
function Inspector({ map, selection, pick, result, pinned, scenario, enter, layer, tf, setTf, update, probes, design, setDesign }: { map: MapData; selection: Selection; pick: (s: Selection) => void; result: Result | null; pinned: Result | null; scenario: Scenario; enter: (id: string) => void; layer: string; tf: TfPicks; setTf: (t: TfPicks) => void; update?: (patch: Partial<Scenario>) => void; probes?: ProbeActions; design?: Design; setDesign?: (d: Design) => void }) {
  const lines = (signal: string, name: string, color: string): Line[] => {
    if (!result) return [];
    const own = readTrace(result, signal), other = pinned && readTrace(pinned, signal);
    return [...(other ? [{ name: 'Comparison', x: pinned!.year, y: other, color: '#8a9692', dash: 'dash', width: 2 }] : []), ...(own ? [{ name, x: result.year, y: own, color }] : [])];
  };
  const hint = (what: string) => <p className="run-hint">Run the simulation to see {what}.</p>;
  const name = (id: string) => id === 'controller' ? 'Controller' : map.agents[id]?.label ?? id;
  const go = (id: string) => pick({ kind: 'agent', id });
  if (selection.kind === 'ident') return <IdentPanel scenario={scenario} update={update ?? (() => undefined)}/>;
  if (selection.kind === 'tf') return <TransferPanel input={tf.input} output={tf.output} feedback={scenario.feedback} K={[scenario.kp, scenario.ki, scenario.kd]} filtered={scenario.derivative_filter} swap={() => setTf({ input: tf.output, output: tf.input })} clear={() => setTf({})}/>;
  if (selection.kind === 'probe') {
    const p = probeOf(selection.id), info = probeInfo(map, p), color = p.q === 'f' ? COLOR[info.f.kind] : '#6b4fa0';
    return <><p className="eyebrow">Probe · port {info.f.port?.node}</p><h3>{info.title}</h3>
      <p className="muted small">{p.q === 'f' ? `The flow through the port: ${info.signal}.` : `The effort across the port: ${info.signal}, the node voltage against its return.`} Each port has one effort and one flow.</p>
      {info.signal && result ? <Chart title={info.title} unit={info.unit} height={240} lines={lines(info.signal, info.title, color)}/> : hint('this signal')}
      {probes && <div className="row probe-actions">
        <button className="secondary" onClick={() => probes.pin(p)}>{probes.pinned(p) ? 'Unpin from canvas' : 'Pin on canvas'}</button>
        <button className="secondary" onClick={() => probes.sense(p)}>{probes.sensed(p) ? 'Stop sending to CBS' : 'Send to CBS'}</button></div>}
      <div className="chain"><button onClick={() => pick({ kind: 'probe', id: `${p.flow}:${p.q === 'e' ? 'f' : 'e'}` })}>Show the {p.q === 'e' ? 'flow f' : 'effort e'} of this port</button><button onClick={() => pick({ kind: 'flow', id: p.flow })}>Port details</button></div></>;
  }
  if (selection.kind === 'flow') {
    const f = map.flows.find(x => x.id === selection.id) as Flow;
    const chain = f.chain.filter(n => f.id !== 'owner_subsidy' || (scenario.feedback ? n === 'B§PID' : n !== 'B§PID'));
    return <>
      <p className="eyebrow">{f.kind === 'real' ? 'Goods port' : f.kind === 'policy' ? 'Control signal' : 'Money port'}</p><h3>{f.label}</h3>
      <p className="direction"><button className="link" onClick={() => go(f.source)}>{name(f.source)}</button> → <button className="link" onClick={() => go(f.target)}>{name(f.target)}</button>{f.port && <> · node {f.port.node}</>}</p>
      <p className="muted">{f.description}</p>
      {result ? <><Chart title="A · Flow" unit={f.unit} height={210} lines={lines(f.signal, f.label, COLOR[f.kind])}/>{f.port && <Chart title="V · Incentive at the port" unit="Model units" height={200} lines={lines(`V(${f.port.node.toLowerCase()},${f.port.ret.toLowerCase()})`, 'Incentive', '#a8660c')}/>}</> : hint('this flow')}
      <h4>Components along this flow</h4><div className="chain">{chain.map(n => <button key={n} onClick={() => pick({ kind: 'element', id: n })}>{n}</button>)}</div>
    </>;
  }
  if (selection.kind === 'signal') {
    const s = [...map.disturbances, ...map.outputs].find(x => x.id === selection.id)!;
    if (s.id === 'y_reference' && scenario.feedback && scenario.share_control) {
      const shareTarget = result?.scenario.share_control ? lines('share_target', 'Rental-share target', '#b9770e') : [];
      return <><p className="eyebrow">Signals r (two goals)</p><h3>Targets</h3><p className="muted">Parliament sets two targets: the house price path and the rental share of housing services.</p>
        {result ? <><h4>r₁ · House price target</h4><Chart title="" unit={s.unit} height={220} lines={lines(s.signal, 'Price target', '#2b6599')}/>
          <h4>r₂ · Rental-share target</h4>{shareTarget.length ? <Chart title="" unit="%" height={220} lines={[...shareTarget, ...lines('rental_share', 'Measured rental share', '#3c6e4e')]}/> : hint('the rental-share target (run with the rental share loop on)')}</> : hint('these signals')}</>;
    }
    if (s.id === 'y_error' && scenario.feedback && scenario.share_control) {
      const shareGap = result?.scenario.share_control ? lines('I(Serror)', 'Rental-share gap', '#b9770e') : [];
      return <><p className="eyebrow">Signals e (two goals)</p><h3>Gaps</h3><p className="muted">Each PID gets its own gap: the price PID the price gap, the rental-share PID the gap between the target and the measured rental share.</p>
        {result ? <><h4>e₁ · Price gap</h4><Chart title="" unit={s.unit} height={220} lines={lines(s.signal, 'Price gap', '#3c6e4e')}/>
          <h4>e₂ · Rental-share gap</h4>{shareGap.length ? <Chart title="" unit="% points" height={220} lines={shareGap}/> : hint('the rental-share gap (run with the rental share loop on)')}</> : hint('these signals')}</>;
    }
    return <><p className="eyebrow">{selection.id.startsWith('d_') ? 'Historical shock or input' : 'Signal'}</p><h3>{s.label}</h3>
      {result ? <Chart title="" unit={s.unit} height={250} lines={lines(s.signal, s.label, s.id === 'y_yoy' ? '#3f9a1f' : selection.id.startsWith('d_') ? '#b3322a' : '#3c6e4e')}/> : hint('this signal')}
      {s.element && <><h4>Component</h4><div className="chain"><button onClick={() => pick({ kind: 'element', id: s.element! })}>{s.element}</button></div></>}</>;
  }
  if (selection.kind === 'shocks') {
    return <><p className="eyebrow">Disturbances d</p><h3>Historical shocks and inputs</h3><p className="muted">Six signals act on the system. Open the Housing Market to see where each one enters.</p>
      <div className="sensor-list">{map.disturbances.map(o => { const t = result && readTrace(result, o.signal); return <button key={o.id} onClick={() => pick({ kind: 'signal', id: o.id })}><span>{o.label}</span>{t && <b>{fmt(t[t.length - 1])}</b>}{t && <Spark y={t} color="#c5352a" at={t.length - 1}/>}</button>; })}</div></>;
  }
  if (selection.kind === 'sensor') {
    return <><p className="eyebrow">Sensor</p><h3>CBS · sensor</h3>
      <h4>Inside the sensor</h4>
      <div className="sensor-inside"><div><b>x₁</b> Construction payments<br/><b>x₂</b> New construction</div><span>→</span><div><b>y</b> House price index = x₁</div></div>
      <p className="muted small">Both measurements enter CBS. The house price index sent to the controller is the construction payments x₁, as in the thesis model. New construction x₂ is measured but not yet used in the index.</p>
      {probes && probes.list.length > 0 && <><h4>Probed signals sent to CBS</h4><div className="chain">{probes.list.map(p => <button key={`${p.flow}:${p.q}`} onClick={() => pick({ kind: 'probe', id: `${p.flow}:${p.q}` })}>{probeInfo(map, p).title}</button>)}</div></>}
      <h4>All read-outs</h4>
      <div className="sensor-list">{map.outputs.map(o => { const t = result && readTrace(result, o.signal); return <button key={o.id} onClick={() => pick({ kind: 'signal', id: o.id })}><span>{o.label}</span>{t && <b>{fmt(t[t.length - 1])}</b>}{t && <Spark y={t} color="#3f9a1f" at={t.length - 1}/>}</button>; })}</div></>;
  }
  if (selection.kind === 'element') {
    const e = map.elements.find(x => x.name === selection.id) as Element, state = stateOf(e, scenario);
    return <><p className="eyebrow">{e.role}</p><h3>{e.name}</h3>
      {state !== 'active' && <p className="state-note">{STATE_NOTE[state]}</p>}
      <p className="direction">Nodes {e.a} → {e.b}{e.agent && layer !== e.agent ? <> · <button className="link" onClick={() => enter(e.agent!)}>Open {name(e.agent)}</button></> : null}</p>
      {result ? <><Chart title="Flow" unit="Model units" height={200} lines={lines(e.trace, 'Flow', '#3f8f4f')}/>{e.a !== e.b && <Chart title="Incentive across" unit="Model units" height={200} lines={lines(`V(${e.a.toLowerCase()},${e.b.toLowerCase()})`, 'Incentive across', '#a8660c')}/>}</> : hint('this component')}
      <details className="netlist-line"><summary>Netlist line</summary><code>{e.netlist}</code></details>
      {e.flows.length > 0 && <><h4>Part of</h4><div className="chain">{e.flows.map(id => <button key={id} onClick={() => pick({ kind: 'flow', id })}>{map.flows.find(f => f.id === id)?.label}</button>)}</div></>}</>;
  }
  const id = selection.kind === 'agent' ? selection.id : layer;
  if (id === 'controller') {
    return <><p className="eyebrow">Outside the system</p><h3>Controller</h3><p className="muted">{map.controller.description}</p>
      {update && <GainSteps scenario={scenario} update={update}/>}
      {probes && <div className="step-pick"><h4>Step responses on the canvas</h4>
        <label>Pinned plots show the response to a unit step in <select value={probes.stepInput} onChange={e => probes.setStepInput(e.target.value)}>
          {scenario.feedback && <option value="y_reference">the target r</option>}<option value="u_open">the controller output u, loop open</option>{map.disturbances.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
        <p className="muted small">{probes.count ? `${probes.count} pinned plot${probes.count > 1 ? 's' : ''} switch to the step response while the controller is selected. Linear model, 15 years${probes.stepInput === 'u_open' ? ', loop open: the market on its own' : scenario.feedback ? ', loop closed' : ', loop open'}.` : 'Click a port, a disturbance or a subsidy arrow to pin a plot; it shows the step response here while you tune.'}</p></div>}
      {probes && <button className="secondary sens-pin" onClick={probes.addSens}>{probes.hasSens ? 'Remove S, T, KS from the canvas' : 'Pin S, T, KS on the canvas'}</button>}
      {update && design && setDesign && <ControllerLocus K={[scenario.kp, scenario.ki, scenario.kd]} filtered={scenario.derivative_filter} design={design} setDesign={setDesign}
        setK={(K: K3, preset?: string) => { update(preset ? { controller: preset as Scenario['controller'], kp: K[0], ki: K[1], kd: K[2] } : { controller: 'custom', kp: K[0], ki: Math.max(0.01, K[1]), kd: K[2] }); setDesign({ ...design, K, filtered: scenario.derivative_filter }); }}/>}
      <h4>Sends</h4><div className="chain">{map.flows.filter(f => f.source === 'controller').map(f => <button key={f.id} onClick={() => pick({ kind: 'flow', id: f.id })}>{f.label}</button>)}</div>
      {layer !== 'controller' && <button className="secondary open-agent" onClick={() => enter('controller')}>Show inside <ChevronRight size={15}/></button>}</>;
  }
  const agent = map.agents[id];
  if (!agent) return <><h3>Model</h3><p className="muted">Click the Housing Market to open it in place, then an agent to see its components. Click any arrow, port pair or component to plot it.</p></>;
  const inFlows = map.flows.filter(f => f.target === id), outFlows = map.flows.filter(f => f.source === id), layout = map.layouts[id];
  return <><p className="eyebrow">Agent</p><h3>{agent.label}</h3><p className="muted">{agent.description}</p>
    {layer !== id && <button className="secondary open-agent" onClick={() => enter(id)}>Show components <ChevronRight size={15}/></button>}
    {inFlows.length > 0 && <><h4>Receives</h4><div className="chain">{inFlows.map(f => <button key={f.id} onClick={() => pick({ kind: 'flow', id: f.id })}>{f.label}</button>)}</div></>}
    {outFlows.length > 0 && <><h4>Sends</h4><div className="chain">{outFlows.map(f => <button key={f.id} onClick={() => pick({ kind: 'flow', id: f.id })}>{f.label}</button>)}</div></>}
    {layout.not_drawn.length > 0 && <p className="not-drawn">Not drawn, not in the circuit: {layout.not_drawn.join(', ')}</p>}</>;
}

type View = { system: boolean; cpb: boolean; finance: boolean; controller: boolean; agents: string[]; cbs?: boolean };
const CPB_AGENTS = ['constructors', 'investors', 'firms', 'households'];
const CHANNEL: Record<string, string> = {
  construction_cost: 'c12', houses: 'c12', consumption: 'c12', income: 'c12', goods: 'c12',
  rental_services: 'row', owner_services: 'row', rent: 'row', imputed_rent: 'row',
  mortgages: 'c23', mortgage_interest: 'c23', savings: 'c23', savings_interest: 'c23', loans: 'bottom', loan_interest: 'bottom',
};
// Collapsed CPB box: where the six financial pairs leave it (px offsets), return rail 12 px on the +y / +x side.
const CPB_BOX: [number, number] = [300, 230];
const CPB_PORTS: Record<string, { p: Point; side: Side }> = {
  mortgages: { p: [300, 46], side: 'R' }, mortgage_interest: { p: [300, 92], side: 'R' }, savings: { p: [300, 138], side: 'R' }, savings_interest: { p: [300, 184], side: 'R' },
  loans: { p: [100, 230], side: 'B' }, loan_interest: { p: [200, 230], side: 'B' },
};
// Collapsed agents all have one size; the financial sector is as tall as the collapsed CPB box,
// so its four left ports line up with the CPB's four right ports.
const AGENT_BOX: Point = [250, 160], FIN_BOX: Point = [250, 230];
/** Port of a collapsed block: ports keep their side and order from the drawing, evenly spaced along that side. */
function evenPort(l: MapData['layouts'][string], flow: string, [W, H]: Point): { p: Point; side: Side; ret: Point } {
  const [w, h] = l.size, sideOf = ([x, y]: number[]): Side => x === 0 ? 'L' : x === w ? 'R' : y === 0 ? 'T' : 'B';
  const side = sideOf(l.ports[flow]), vertical = side === 'L' || side === 'R', k = vertical ? 1 : 0;
  const same = Object.keys(l.ports).filter(f => sideOf(l.ports[f]) === side).sort((a, b) => l.ports[a][k] - l.ports[b][k]);
  const t = (same.indexOf(flow) + 1) / (same.length + 1), sign = Math.sign(l.returns[flow][k] - l.ports[flow][k]) || 1;
  const p: Point = side === 'L' ? [0, H * t] : side === 'R' ? [W, H * t] : side === 'T' ? [W * t, 0] : [W * t, H];
  return { p, side, ret: vertical ? [p[0], p[1] + 12 * sign] : [p[0] + 12 * sign, p[1]] };
}

function useModelGraph(map: MapData | undefined, view: View, toggle: (k: string) => void, scenario: Scenario, result: Result | null, at: number, selection: Selection, select: (s: Selection) => void, menu: (s: Selection, e: React.MouseEvent) => void, flip?: () => void, probes?: ProbeState, step?: (k: GainKey, up: boolean) => void, lab = 1) {
  return useMemo(() => {
    if (!map) return { nodes: [] as Node[], edges: [] as Edge[], pinDefault: {} as Record<string, XY> };
    const value = (signal: string) => { const t = result && readTrace(result, signal); return t ? fmt(t[at]) : undefined; };
    const on = (s: Selection) => selection.kind === s.kind && selection.id === s.id;
    const nodes: Node[] = [], edges: Edge[] = [], railStart: Record<string, Point> = {}, pinDefault: Record<string, XY> = {};
    // width/height given: React Flow then never hides a block while waiting to measure it (the graph is rebuilt every frame during Play).
    const block = (id: string, r: Rect, data: Partial<BlockData>, z = 1) => nodes.push({ id, type: 'block', position: { x: r.x, y: r.y }, width: r.w, height: r.h, draggable: false, zIndex: z, data: { label: '', tone: '', width: r.w, height: r.h, ...data } });
    const sig = (id: string, points: Point[], data: Omit<SignalData, 'points'>) => edges.push({ id, source: 'anchor', target: 'anchor', type: 'signal', zIndex: 5, data: { points, lab, ...data, menu: data.target ? (e: React.MouseEvent) => menu(data.target!, e) : undefined } });
    const card = (id: string) => probes?.show ? (e?: React.MouseEvent) => { if (e) probes.show!({ flow: id, q: 's' }, e); } : undefined;
    const GX = 640, GY = 300;
    const R: Record<string, Rect> = {}, scale: Record<string, number> = {};
    const shift = (dx: number, dy: number, ids: string[]) => ids.forEach(i => { R[i].x += dx; R[i].y += dy; });
    const sized = (id: string) => { const open = view.agents.includes(id), [w, h] = map.layouts[id].size; scale[id] = open ? SCALE.expanded : 0; R[id] = open ? { x: 0, y: 0, w: w * SCALE.expanded, h: h * SCALE.expanded } : { x: 0, y: 0, w: AGENT_BOX[0], h: AGENT_BOX[1] }; };
    // Port of a flow on a block: agent (from its drawing), collapsed CPB box, or collapsed financial sector (drawn like Bank).
    const portOf = (node: string, flow: string): { p: Point; side: Side; ret: Point } => {
      const r = R[node];
      if (node === 'cpb') { const c = CPB_PORTS[flow]; const p: Point = [r.x + c.p[0], r.y + c.p[1]]; return { p, side: c.side, ret: c.side === 'R' ? [p[0], p[1] + 12] : [p[0] + 12, p[1]] }; }
      const l = map.layouts[node === 'finance' ? 'bank' : node], [w, h] = l.size, s = scale[node] ?? 0;
      if (!s) { const e = evenPort(l, flow, node === 'finance' ? FIN_BOX : AGENT_BOX); return { p: [r.x + e.p[0], r.y + e.p[1]], side: e.side, ret: [r.x + e.ret[0], r.y + e.ret[1]] }; }
      const [x, y] = l.ports[flow], [rx, ry] = l.returns[flow];
      return { p: [r.x + x * s, r.y + y * s], side: x === 0 ? 'L' : x === w ? 'R' : y === 0 ? 'T' : 'B', ret: [r.x + rx * s, r.y + ry * s] };
    };
    let group: Rect = { x: GX, y: GY, w: 250, h: 150 }, cpbRegion: Rect | null = null, finRegion: Rect | null = null;
    const g12 = 340, rowGap = 340, g23 = 340, framePad = 34;
    // Which disturbances are drawn: a shock whose scale is 0 is not (the bank's inputs are all zero with the bank off).
    const SCALE_OF: Record<string, keyof Scenario> = { d_income: 'income_scale', d_covid: 'covid_scale', d_crisis: 'crisis_scale', d_mortgages: 'mortgage_scale', d_interest: 'interest_scale' };
    const active = (d: { id: string; target?: string }) => (d.target !== 'bank' || scenario.bank) && !(SCALE_OF[d.id] && scenario[SCALE_OF[d.id]] === 0);
    if (view.system) {
      // ---- CPB model
      if (view.cpb) {
        CPB_AGENTS.forEach(sized);
        const rel = (a: string, f: string) => { const q = portOf(a, f).p; return [q[0] - R[a].x, q[1] - R[a].y]; };
        const A = R, col1 = Math.max(A.constructors.w, A.firms.w);
        A.investors.x = col1 + g12; A.investors.y = 0;
        A.households.x = A.investors.x; A.households.y = A.investors.h + rowGap;
        A.constructors.x = A.investors.x - g12 - A.constructors.w; A.constructors.y = rel('investors', 'construction_cost')[1] - rel('constructors', 'construction_cost')[1];
        A.firms.x = A.households.x - g12 - A.firms.w; A.firms.y = A.households.y + rel('households', 'consumption')[1] - rel('firms', 'consumption')[1];
        const x0 = Math.min(...CPB_AGENTS.map(i => A[i].x)), y0 = Math.min(...CPB_AGENTS.map(i => A[i].y));
        const x1 = Math.max(...CPB_AGENTS.map(i => A[i].x + A[i].w)), y1 = Math.max(...CPB_AGENTS.map(i => A[i].y + A[i].h));
        R.cpb = { x: x0 - framePad, y: y0 - framePad - 24, w: x1 - x0 + 2 * framePad, h: y1 - y0 + 2 * framePad + 24 };
      } else R.cpb = { x: 0, y: 0, w: CPB_BOX[0], h: CPB_BOX[1] };
      cpbRegion = R.cpb;
      // ---- Financial sector, aligned so the mortgage pair runs straight where possible
      const cpbMort = view.cpb ? portOf('investors', 'mortgages').p[1] : R.cpb.y + CPB_PORTS.mortgages.p[1];
      if (view.finance) {
        sized('bank');
        R.bank.x = R.cpb.x + R.cpb.w + g23 + framePad; R.bank.y = cpbMort - portOf('bank', 'mortgages').p[1];
        R.finance = { x: R.bank.x - framePad, y: R.bank.y - framePad - 24, w: R.bank.w + 2 * framePad, h: R.bank.h + 2 * framePad + 24 };
      } else {
        R.finance = { x: R.cpb.x + R.cpb.w + g23, y: cpbMort - evenPort(map.layouts.bank, 'mortgages', FIN_BOX).p[1], w: FIN_BOX[0], h: FIN_BOX[1] };
      }
      finRegion = R.finance;
      // ---- place the system frame
      // padT leaves room under the frame's header for the two measurement lanes x1, x2 (from Investors to CBS).
      const inside = Object.keys(R), padL = 130, padT = HEAD_FLOW * lab + 84, padR = 80, padB = 150;
      const minX = Math.min(...inside.map(i => R[i].x)), minY = Math.min(...inside.map(i => R[i].y));
      shift(GX + padL - minX, GY + padT - minY, inside);
      // Bank off: the financial sector is not drawn, so the frame closes around the CPB part only.
      const framed = scenario.bank ? inside : inside.filter(i => i !== 'finance' && i !== 'bank');
      const maxX = Math.max(...framed.map(i => R[i].x + R[i].w)), maxY = Math.max(...framed.map(i => R[i].y + R[i].h));
      group = { x: GX, y: GY, w: maxX + padR - GX, h: maxY + padB - GY };
      // ---- port pairs
      const ends = (f: Flow) => {
        const map1 = (a: string) => CPB_AGENTS.includes(a) ? (view.cpb ? a : 'cpb') : a === 'bank' ? (view.finance ? 'bank' : 'finance') : a;
        return [map1(f.source), map1(f.target)];
      };
      const shown = map.flows.filter(f => f.port && (CHANNEL[f.id] === 'c23' || CHANNEL[f.id] === 'bottom' || view.cpb));
      const inv = R.investors, hh = R.households, cpb = R.cpb, fin = R.finance;
      const channels: Record<string, [number, number]> = { c23: [cpb.x + cpb.w + 50, fin.x - 50], bottom: [maxY + 50, maxY + 105] };
      if (view.cpb) { channels.c12 = [inv.x - g12 + 55, inv.x - 55]; channels.row = [inv.y + inv.h + 55, hh.y - 160]; }
      const info: Record<string, { a: ReturnType<typeof portOf>; b: ReturnType<typeof portOf> }> = {};
      const wires: Wire[] = shown.map(f => { const [s1, t1] = ends(f), a = portOf(s1, f.id), b = portOf(t1, f.id); info[f.id] = { a, b }; return { id: f.id, P: a.p, sp: a.side, Q: b.p, channel: CHANNEL[f.id] }; });
      const paths = assignLanes(wires, channels), nth: Record<string, number> = {};
      shown.forEach(f => { railStart[f.id] = paths[f.id][0]; });
      shown.forEach(f => {
        const pts = paths[f.id], { a } = info[f.id], n0 = along([0, 0], [-(pts[1][1] - pts[0][1]), pts[1][0] - pts[0][0]], 1);
        const side = Math.sign(n0[0] * (a.ret[0] - a.p[0]) + n0[1] * (a.ret[1] - a.p[1])) || 1;
        nth[CHANNEL[f.id]] = (nth[CHANNEL[f.id]] ?? -1) + 1;
        edges.push({ id: f.id, source: 'anchor', target: 'anchor', type: 'rail', zIndex: 4, data: { points: pts, side, color: COLOR[f.kind], name: f.short, value: value(f.signal), labelT: nth[CHANNEL[f.id]] % 2 ? .7 : .3, selected: on({ kind: 'flow', id: f.id }), pick: f.port && probes?.show ? (e?: React.MouseEvent) => e && probes.show!({ flow: f.id, q: 'f' }, e) : () => select({ kind: 'flow', id: f.id }), menu: (e: React.MouseEvent) => menu({ kind: 'flow', id: f.id }, e), probe: f.port && probes?.show ? (q: 'e' | 'f', e: React.MouseEvent) => probes.show!({ flow: f.id, q }, e) : undefined, probed: (['e', 'f'] as const).filter(q => on({ kind: 'probe', id: `${f.id}:${q}` }) || !!probes?.pins.some(p => p.flow === f.id && p.q === q) || !!probes?.sensed.some(p => p.flow === f.id && p.q === q)) } });
      });
    }
    const gc = group.y + group.h / 2;
    // ---- controller, its ports set the subsidy and error heights
    const ctrlSize: Point = view.controller ? [CONTROLLER_SIZE[0] * SCALE.controller, CONTROLLER_SIZE[1] * SCALE.controller] : [210 * lab, 150 * lab];
    const target = view.system ? (view.cpb ? null : R.cpb) : group;
    // Top layer: every block centred on one line through the system; the two subsidies leave symmetric about it.
    const loopOnly = !view.system && !view.controller;
    const u2y = loopOnly ? gc - 24 : target ? target.y + target.h / 2 - .17 * ctrlSize[1] : R.households.y - 140;
    const mainY = loopOnly ? gc : u2y;
    // Open controller: a band of HEAD_FLOW above the circuit for its header, so the header never covers the P box.
    const ctrlHead = view.controller ? HEAD_FLOW * lab : 0;
    const ctrl: Rect = { x: group.x - 250 * lab - ctrlSize[0], y: mainY - ctrlSize[1] / 2 - ctrlHead, w: ctrlSize[0], h: ctrlSize[1] + ctrlHead };
    const u1y = loopOnly ? gc + 24 : ctrl.y + ctrlHead + ctrlSize[1] * 5 / 6;
    const sum: Rect = { x: ctrl.x - (loopOnly ? 150 : 130) * lab, y: mainY - 22, w: 44, h: 44 }, parl: Rect = { x: sum.x - (loopOnly ? 170 : 80) * lab - 180 * lab, y: mainY - 60 * lab, w: 180 * lab, h: 120 * lab };
    const cbsS = 0.42, cbsHead = HEAD_FLOW * lab;
    const sensor: Rect = view.cbs ? { x: group.x + group.w + 190 * lab, y: gc - cbsHead - CBS_Y.out * cbsS, w: CBS_SIZE[0] * cbsS, h: CBS_SIZE[1] * cbsS + cbsHead }
      : { x: group.x + group.w + 190 * lab, y: gc - 60 * lab, w: 180 * lab, h: 120 * lab };
    // Open CBS: the two measurements enter where its drawing expects them.
    const xIn = view.cbs ? { a: sensor.y + cbsHead + CBS_Y.x1 * cbsS - gc, b: sensor.y + cbsHead + CBS_Y.x2 * cbsS - gc } : { a: -26, b: 26 };
    block('anchor', { x: group.x, y: group.y, w: 1, h: 1 }, { tone: 'anchor' }, 0);
    block('parliament', parl, { label: 'Parliament', tone: scenario.feedback ? 'reference' : 'reference loop-off', selected: on({ kind: 'signal', id: 'y_reference' }) });
    block('sum', sum, { tone: scenario.feedback ? 'summing' : 'summing loop-off' });
    block('controller', ctrl, view.controller
      ? { label: 'Tax Authority · Controller', tone: 'controller', open: true, tab: 'above', headSpace: ctrlHead, toggle: () => toggle('controller'), children: <ControllerCircuit map={map} scenario={scenario} selection={selection} pick={select} step={step}/> }
      : { label: 'Tax Authority', tone: 'controller', toggle: () => toggle('controller'), selected: on({ kind: 'agent', id: 'controller' }) });
    block('sensor', sensor, view.cbs ? { label: 'CBS · how the index is made', tone: 'sensor-open', open: true, tab: 'above', headSpace: cbsHead, toggle: () => toggle('cbs'), children: <CbsCircuit result={result} at={at}/> }
      : { label: 'CBS', tone: 'sensor', selected: selection.kind === 'sensor', toggle: () => toggle('cbs') });
    if (!view.system) block('system', group, { label: 'Housing Market', tone: 'system-closed', toggle: () => toggle('system') });
    else {
      block('system', group, { label: 'Housing Market', tone: 'system-group', open: true, tab: 'tl', toggle: () => toggle('system') }, 0);
      block('cpb', R.cpb, view.cpb ? { label: 'CPB Four Quadrants', tone: 'sub-group', open: true, tab: 'tl', toggle: () => toggle('cpb') } : { label: 'CPB Four Quadrants', tone: 'sub-closed', toggle: () => toggle('cpb') }, view.cpb ? 1 : 2);
      block('finance', R.finance, view.finance ? { label: scenario.bank ? 'Financial sector' : 'Financial sector · off', tone: scenario.bank ? 'sub-group' : 'sub-group bank-off', open: true, tab: 'tl', toggle: () => toggle('finance') } : { label: scenario.bank ? 'Financial sector' : 'Financial sector · off', tone: scenario.bank ? 'sub-closed' : 'sub-closed bank-off', toggle: () => toggle('finance') }, view.finance ? 1 : 2);
      const agentBlock = (id: string) => {
        const open = view.agents.includes(id), a = map.agents[id];
        block(id, R[id], open ? { label: a.label, tone: 'agent', open, tab: TAB[id], toggle: () => toggle(id), children: <AgentCircuit map={map} agent={id} scenario={scenario} selection={selection} pick={select} menu={menu} inputs={map.disturbances.filter(d => d.target === id && active(d))} inputSide={id === 'bank' ? 'top' : 'left'}/> }
          : { label: a.label, tone: 'agent', toggle: () => toggle(id), selected: on({ kind: 'agent', id }) }, 3);
      };
      if (view.cpb) CPB_AGENTS.forEach(agentBlock);
      if (view.finance) agentBlock('bank');
    }
    // ---- loop signals (two goals when the rental share loop is on)
    const mimo = scenario.feedback && scenario.share_control;
    sig('r', [[parl.x + parl.w, mainY], [sum.x, mainY]], { color: scenario.feedback ? '#2b6599' : '#b8c2bd', dashed: !scenario.feedback, markDist: (sum.x - parl.x - parl.w) / 2, letter: 'r', name: mimo ? 'Targets' : 'Housing target', sub: probes?.stepAt === 'y_reference' ? 'Unit step +1 enters here' : mimo ? 'Price & share r' : 'Reference signal r', value: value('I(Reference)'), labelSide: 'above', selected: on({ kind: 'signal', id: 'y_reference' }), pick: card('y_reference') ?? (() => select({ kind: 'signal', id: 'y_reference' })) });
    sig('e', [[sum.x + sum.w, mainY], [ctrl.x, mainY]], { color: scenario.feedback ? '#1f2a26' : '#b8c2bd', letter: 'e', name: mimo ? 'Gaps' : 'Gap', sub: mimo ? 'Errors e' : 'Error e', value: scenario.feedback ? value('I(Error)') : undefined, dashed: !scenario.feedback, labelSide: 'above', selected: on({ kind: 'signal', id: 'y_error' }), pick: card('y_error') ?? (() => select({ kind: 'signal', id: 'y_error' })) });
    const subsidy = (id: string) => map.flows.find(f => f.id === id)!;
    ([['owner_subsidy', 'u2', u2y], ['rental_subsidy', 'u1', u1y]] as const).forEach(([id, letter, y], i) => {
      if (id === 'rental_subsidy' && !scenario.rental_subsidy) return; // switched off: no arrow
      const f = subsidy(id);
      let points: Point[] = [[ctrl.x + ctrl.w, y], [(target ?? group).x, y]];
      if (view.system && view.cpb) { const entry = map.layouts.households.signals.find(s => s.flow === id)!.path[0], x = R.households.x + entry[0] / map.layouts.households.size[0] * R.households.w; points = [[ctrl.x + ctrl.w, y], [x, y], [x, R.households.y]]; }
      sig(letter, points, { color: COLOR.policy, letter, sub: probes?.stepAt === 'u_open' && id === 'owner_subsidy' ? 'Unit step +1 enters here (loop open)' : undefined, markDist: view.system ? 110 * lab : len(points[0], points[1]) / 2, name: f.label, value: value(f.signal), labelSide: i === 0 ? 'above' : 'below', selected: on({ kind: 'flow', id }) || !!probes?.pins.some(p => p.flow === id), pick: probes?.show ? (e?: React.MouseEvent) => e && probes.show!({ flow: id, q: 's' }, e) : () => select({ kind: 'flow', id }), target: { kind: 'flow', id } });
    });
    // Two measurements go into CBS (supervisor 3.4/5.1). Drawn only: the controller's price is still the construction payments.
    // Housing Market open: both lines start where they are measured (Investors, or the CPB box when it is closed),
    // run up into the lane under the frame header, along it, down the right margin and out to CBS. x1 starts left of
    // x2 and runs outside it, so the two never cross.
    let x1pts: Point[] = [[group.x + group.w, gc + xIn.a], [sensor.x, gc + xIn.a]], x2pts: Point[] = [[group.x + group.w, gc + xIn.b], [sensor.x, gc + xIn.b]];
    if (view.system) {
      const src = view.cpb ? R.investors : R.cpb, b1 = group.y + HEAD_FLOW * lab + 26, b2 = b1 + 22, vx1 = group.x + group.w - 22, vx2 = vx1 - 22;
      const sx1 = src.x + src.w * .55, sx2 = src.x + src.w * .75;
      x1pts = [[sx1, src.y], [sx1, b1], [vx1, b1], [vx1, gc + xIn.a], [sensor.x, gc + xIn.a]];
      x2pts = [[sx2, src.y], [sx2, b2], [vx2, b2], [vx2, gc + xIn.b], [sensor.x, gc + xIn.b]];
    }
    const xMark = view.system ? { markAt: 4, markDist: 22 + 95 * lab } : {};
    sig('x1', x1pts, { color: '#e0782a', letter: 'x₁', name: 'Construction payments', value: value('I(Construction_cost)'), markDist: 95 * lab, ...xMark, labelSide: 'above', selected: on({ kind: 'signal', id: 'y_price' }), pick: card('x1') ?? (() => select({ kind: 'signal', id: 'y_price' })), target: { kind: 'signal', id: 'y_price' } });
    sig('x2', x2pts, { color: COLOR.real, letter: 'x₂', name: 'New construction', value: value('I(Construction)'), markDist: 95 * lab, ...xMark, labelSide: 'below', selected: on({ kind: 'flow', id: 'houses' }), pick: card('x2') ?? (() => select({ kind: 'flow', id: 'houses' })), target: { kind: 'flow', id: 'houses' } });
    // y always leaves the sensor; the feedback branch is grey and dashed with the loop switch open.
    sig('yout', [[sensor.x + sensor.w, gc], [sensor.x + sensor.w + 170 * lab, gc]], { color: LOOP, letter: 'y', name: mimo ? 'Price index & rental share' : 'House price index', sub: mimo ? 'Outputs y' : 'Output y', value: value('I(Construction_cost)'), markDist: 120, labelSide: 'above', selected: on({ kind: 'signal', id: 'y_price' }), pick: card('y_price') ?? (() => select({ kind: 'signal', id: 'y_price' })), target: { kind: 'signal', id: 'y_price' } });
    {
      const fbY = group.y + group.h + 90, tap = sensor.x + sensor.w + 60, fb = scenario.feedback;
      sig('y', [[tap, gc], [tap, fbY], [sum.x + sum.w / 2, fbY], [sum.x + sum.w / 2, sum.y + sum.h]], { color: fb ? LOOP : '#b8c2bd', dashed: !fb, switchAt: [tap - (tap - sum.x - sum.w / 2) / 4, fbY], switchOpen: !fb, onSwitch: flip, letter: 'y', markAt: 2, markDist: (tap - sum.x - sum.w / 2) / 2, name: mimo ? 'Price index & rental share' : 'House price index', sub: mimo ? 'Feedback signals' : 'Feedback signal', labelSide: 'above', pick: card('y_price') ?? (() => select({ kind: 'signal', id: 'y_price' })) });
    }
    // Invisible corners so 'Whole model' also fits the arrows outside the blocks.
    const fbBottom = group.y + group.h + 130;
    block('edgeL', { x: parl.x - 30 * lab, y: mainY, w: 1, h: 1 }, { tone: 'anchor' }, 0); block('edgeR', { x: sensor.x + sensor.w + 60 + 170 * lab, y: gc, w: 1, h: 1 }, { tone: 'anchor' }, 0);
    block('edgeT', { x: group.x, y: group.y - 270, w: 1, h: 1 }, { tone: 'anchor' }, 0); block('edgeB', { x: group.x, y: fbBottom, w: 1, h: 1 }, { tone: 'anchor' }, 0);
    // ---- disturbances
    // A shock whose scale is 0 is not drawn (the bank's inputs are all zero with the bank off).
    const top = group.y - 250, firmD = map.disturbances.filter(d => d.target === 'firms' && active(d)), bankD = map.disturbances.filter(d => d.target === 'bank' && active(d));
    const nActive = map.disturbances.filter(active).length;
    const place = (d: typeof firmD[number], side: 'left' | 'right', pts: Point[]) => sig(d.id, pts, { color: SHOCK, letter: 'd', name: d.label, sub: probes?.stepAt === d.id ? 'Unit step +1 enters here' : undefined, value: value(d.signal), markAt: 1, labelSide: side, selected: on({ kind: 'signal', id: d.id }) || !!probes?.pins.some(p => p.flow === d.id), pick: probes?.show ? (e?: React.MouseEvent) => e && probes.show!({ flow: d.id, q: 's' }, e) : () => select({ kind: 'signal', id: d.id }), target: { kind: 'signal', id: d.id } });
    if (!view.system) {
      const x = group.x + group.w / 2;
      if (nActive) sig('shocks', [[x, top + 60], [x, group.y]], { color: SHOCK, letter: 'd', name: 'Disturbance d', sub: probes?.stepAt && probes.stepAt !== 'y_reference' ? `Unit step +1 in ${map.disturbances.find(x => x.id === probes.stepAt)?.label ?? ''}` : `Exogenous shocks & paths (${nActive})`, markAt: 1, labelSide: 'right', selected: selection.kind === 'shocks', pick: () => select({ kind: 'shocks', id: '' }) });
    } else {
      if (view.cpb) { const F = R.firms; firmD.forEach((d, i) => { const x = group.x + 26 + i * 30, y = F.y + F.h * (i + 1) / (firmD.length + 1); place(d, 'left', [[x, top + (firmD.length - 1 - i) * 70], [x, y], [F.x, y]]); }); }
      else firmD.forEach((d, i) => { const x = cpbRegion!.x + 40 + i * 45; place(d, 'left', [[x, top + (firmD.length - 1 - i) * 70], [x, cpbRegion!.y]]); });
      const B = view.finance ? R.bank : finRegion!;
      bankD.forEach((d, i) => { const x = B.x + B.w * (i + 1) / (bankD.length + 1); place(d, 'right', [[x, top + i * 70], [x, B.y]]); });
    }
    // ---- probes: pinned plots and lines to CBS
    if (probes) {
      probes.charts.forEach(c => { if (c.kind === 'sens') pinDefault[c.id] = { x: ctrl.x, y: ctrl.y + ctrl.h + 160 }; });
      const col = { x: sensor.x + sensor.w + 260, y: group.y };
      // Big cards (guided tour): one row under the loop, and an invisible corner so 'Whole model' fits them too.
      const big = probes.cardSize, rowY = group.y + group.h + 200;
      if (big && probes.pins.length) block('edgeCards', { x: parl.x + probes.pins.length * (big.w + 60), y: rowY + big.h + 20, w: 1, h: 1 }, { tone: 'anchor' }, 0);
      probes.pins.forEach((p, i) => {
        const info = probeInfo(map, p), start = railStart[p.flow], W = big?.w ?? PIN_W, H = big?.h ?? PIN_H;
        const pos = probes.pos[`pin-${probeKey(p)}`] ?? (big ? { x: parl.x + i * (big.w + 60), y: rowY } : { x: col.x, y: col.y + i * 170 });
        pinDefault[`pin-${probeKey(p)}`] = pos;
        if (start) sig(`lead-${probeKey(p)}`, [start, [pos.x + W / 2, pos.y + H]], { color: '#6b4fa0', letter: p.q, dashed: true, markDist: 30 });
      });
      probes.sensed.forEach((p, i) => {
        const info = probeInfo(map, p), start = railStart[p.flow] ?? [group.x + group.w, group.y + group.h - 20 - 12 * i];
        const lowY = group.y + group.h + 40 + 14 * i, sx = sensor.x + 30 + 16 * i;
        sig(`probe-${probeKey(p)}`, [start, [start[0], lowY], [sx, lowY], [sx, sensor.y + sensor.h]], { color: '#6b4fa0', letter: p.q, dashed: true, markAt: 2, markDist: 40, name: info.f.short, pick: () => select({ kind: 'probe', id: probeKey(p) }) });
      });
    }
    // Bank off (the original CPB model): leave the financial sector out of the drawing altogether.
    if (!scenario.bank) {
      const bankFlows = new Set(map.flows.filter(f => f.source === 'bank' || f.target === 'bank').map(f => f.id));
      const bankShocks = new Set(map.disturbances.filter(d => d.target === 'bank').map(d => d.id));
      for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i].id === 'finance' || nodes[i].id === 'bank') nodes.splice(i, 1);
      for (let i = edges.length - 1; i >= 0; i--) if (bankFlows.has(edges[i].id) || bankShocks.has(edges[i].id)) edges.splice(i, 1);
    }
    // After a run, dots move along every connection in the direction of the flow (supervisor 2.5).
    if (result) edges.forEach(e => { (e.data as { animate?: boolean }).animate = true; });
    return { nodes, edges, pinDefault };
  }, [map, view, scenario, result, at, selection, menu, flip, probes, step, lab]);
}

function Canvas({ map, view, setView, scenario, result, at, selection, select, focus, menu, flip, probes, step, steps, lab = 1 }: { lab?: number; map: MapData; view: View; setView: (v: View) => void; scenario: Scenario; result: Result | null; at: number; selection: Selection; select: (s: Selection) => void; focus: { id: string; n: number }; menu: (s: Selection, e: React.MouseEvent) => void; flip: () => void; probes: ProbeState; step: (k: GainKey, up: boolean) => void; steps?: StepData }) {
  const flow = useReactFlow();
  const toggle = (k: string) => {
    if (k === 'system') setView({ system: !view.system, cpb: false, finance: false, controller: view.controller, agents: [] });
    else if (k === 'controller') setView({ ...view, controller: !view.controller });
    else if (k === 'cbs') setView({ ...view, cbs: !view.cbs });
    else if (k === 'cpb') setView({ ...view, cpb: !view.cpb, agents: view.agents.filter(a => !CPB_AGENTS.includes(a)) });
    else if (k === 'finance') setView({ ...view, finance: !view.finance, agents: view.agents.filter(a => a !== 'bank') });
    else setView({ ...view, agents: view.agents.includes(k) ? view.agents.filter(a => a !== k) : [...view.agents, k] });
  };
  const withShow = useMemo<ProbeState>(() => ({ ...probes, show: (p, e) => { const at = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }); probes.place(p, { x: at.x - PIN_W / 2, y: at.y - PIN_H - 14 }); } }), [probes, flow]);
  const graph = useModelGraph(map, view, toggle, scenario, result, at, selection, select, menu, flip, withShow, step, lab);
  const shown = graph.nodes;
  useEffect(() => {
    const id = focus.id;
    const t = window.setTimeout(() => { void (id ? flow.fitView({ nodes: [{ id }], duration: 600, padding: .12 }) : flow.fitView({ duration: 600, padding: .04 })); }, 40);
    return () => clearTimeout(t);
  }, [focus.n]);
  return <ReactFlow nodes={shown} edges={graph.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: .04 }} nodesConnectable={false} nodesDraggable={false} elementsSelectable={false} minZoom={.1} maxZoom={4} proOptions={{ hideAttribution: true }}
    onNodeClick={(_, n) => {
      if (n.id === 'sensor' && view.cbs) return;
      if (n.id === 'sensor') { const at = flow.screenToFlowPosition({ x: _.clientX, y: _.clientY }); probes.addChart({ id: 'cbs', kind: 'cbs' }, { x: at.x - 190, y: at.y - 230 }); }
      else if (n.id === 'parliament') select({ kind: 'signal', id: 'y_reference' });
      else if (n.id === 'sum') select({ kind: 'signal', id: 'y_error' });
      else if (n.id === 'controller') { select({ kind: 'agent', id: 'controller' }); if (!view.controller) toggle('controller'); }
      else if (['system', 'cpb', 'finance'].includes(n.id)) { const k = n.id as 'system' | 'cpb' | 'finance'; if (!view[k]) toggle(k); }
      else if (map.agents[n.id]) { select({ kind: 'agent', id: n.id }); if (!view.agents.includes(n.id)) toggle(n.id); }
    }}><Controls showInteractive={false}/><StickyHeaders nodes={graph.nodes as Node<BlockData>[]} lab={lab}/><PinLayer map={map} probes={withShow} result={result} at={at} fallback={graph.pinDefault} steps={steps}/></ReactFlow>;
}

const TOUR_CARD = { w: 700, h: 400 };  // plot cards in the guided tour, model units (readable at the whole-model zoom)
const CLOSED: View = { system: false, cpb: false, finance: false, controller: false, agents: [] };
type TfPicks = { input?: Pick; output?: Pick };
type MenuState = { x: number; y: number; target: Selection; label: string };
export function ModelMap({ scenario, result, pinned, busy, run, setFeedback, update, design, setDesign, cbs, lag, left, cpb, tour }: { tour?: { n: number; pins: Probe[] }; scenario: Scenario; result: Result | null; pinned: Result | null; busy: boolean; run: () => void; setFeedback: (on: boolean) => void; update: (patch: Partial<Scenario>) => void; design: Design; setDesign: (d: Design) => void; cbs?: CbsData; lag: number; left?: React.ReactNode; cpb?: { year: number[]; yoy: number[] } }) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [map, setMap] = useState<MapData>();
  const [error, setError] = useState('');
  const [view, setViewState] = useState<View>(CLOSED);
  const [focus, setFocus] = useState({ id: '', n: 0 });
  const [selection, setSelection] = useState<Selection>(NONE);
  const [index, setIndex] = useState<number>();
  const [tf, setTf] = useState<TfPicks>({});
  const [menuAt, setMenuAt] = useState<MenuState | null>(null);
  const [dock, setDock] = useState(true);
  // Label size: block headers, signal names and the closed Parliament / Tax Authority / CBS blocks (for screenshots).
  const [lab, setLab] = useState(() => { try { const v = Number(localStorage.getItem('hpl.labelSize')); return v >= 1 && v <= 2.5 ? v : 1.3; } catch { return 1.3; } });
  useEffect(() => { try { localStorage.setItem('hpl.labelSize', String(lab)); } catch { /* storage blocked */ } }, [lab]);
  const [shooting, setShooting] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const shootCanvas = async () => {
    // The canvas, plus the side panels when they are open (collapsed handles are left out).
    const body = bodyRef.current, canvas = canvasRef.current; if (!body || !canvas) return;
    setShooting(true);
    try { await savePng(dock || (left && leftOpen) ? body : canvas, 'housing-model-canvas'); }
    catch (e) { console.error(e); alert('Screenshot failed: ' + (e instanceof Error ? e.message : String(e))); }
    finally { setShooting(false); }
  };
  const [pins, setPins] = useState<Probe[]>([]);
  const [sensed, setSensed] = useState<Probe[]>([]);
  const [pinPos, setPinPos] = useState<Record<string, { x: number; y: number }>>({});
  const [charts, setCharts] = useState<ChartCard[]>([]);
  // Tour step: closed blocks, the whole model in view, and only this step's plot cards (they play with the new run).
  useEffect(() => {
    if (!tour) return;
    setViewState(CLOSED); setSelection(NONE); setCharts([]); setSensed([]); setPinPos({}); setPins(tour.pins); setFocus(f => ({ id: '', n: f.n + 1 }));
  }, [tour?.n]);
  const [bodeFrom, setBodeFrom] = useState<Probe | null>(null);
  const ctx = useMemo<Ctx>(() => ({ K: [scenario.kp, scenario.ki, scenario.kd], filtered: scenario.derivative_filter, feedback: scenario.feedback, settling: design.settling, overshoot: design.overshoot }), [scenario.kp, scenario.ki, scenario.kd, scenario.derivative_filter, scenario.feedback, design.settling, design.overshoot]);
  const latest = useRef({ scenario, update }); latest.current = { scenario, update };
  const tuning = selection.kind === 'agent' && selection.id === 'controller';
  // System identification: pinned plots show the open-loop step response to u, as while tuning.
  const ident = selection.kind === 'ident', stepping = tuning || ident;
  const [stepChoice, setStepInput] = useState('y_reference');
  // Loop open: the target does nothing, so the default step is the controller output u.
  const stepInput = ident ? 'u_open' : !scenario.feedback && stepChoice === 'y_reference' ? 'u_open' : stepChoice;
  const [steps, setSteps] = useState<StepData>(null);
  useEffect(() => {
    if (!stepping || !map || !pins.length) { setSteps(null); return; }
    const outs = pins.map(p => probeInfo(map, p).step).filter(Boolean);
    const timer = window.setTimeout(() => {
      api<NonNullable<StepData>>('/analysis/steps', { input: { kind: 'signal', id: stepInput }, outputs: outs, feedback: scenario.feedback && stepInput !== 'u_open', K: [scenario.kp, scenario.ki, scenario.kd], filtered: scenario.derivative_filter, scale: scenario.param_scale ?? {} })
        .then(setSteps).catch(e => setSteps({ input: '', responses: Object.fromEntries(outs.map(o => [`${o!.kind}:${o!.id}`, { error: (e as Error).message }])) }));
    }, 120);
    return () => clearTimeout(timer);
  }, [stepping, map, pins, stepInput, scenario.feedback, scenario.kp, scenario.ki, scenario.kd, scenario.derivative_filter, scenario.param_scale]);
  const stepGain = useCallback((k: GainKey, up: boolean) => latest.current.update(stepPatch(latest.current.scenario, k, up)), []);
  const same = (a: Probe) => (b: Probe) => a.flow === b.flow && a.q === b.q;
  const toggleIn = (set: React.Dispatch<React.SetStateAction<Probe[]>>) => (p: Probe) => set(old => old.some(same(p)) ? old.filter(x => !same(p)(x)) : [...old, p]);
  const probeState = useMemo<ProbeState>(() => ({ cardSize: tour ? TOUR_CARD : undefined, pins, sensed, unpin: p => setPins(old => old.filter(x => !same(p)(x))), dock: p => { setDock(true); setSelection(p.q === 's' && LOOP_SIGNALS[p.flow] ? LOOP_SIGNALS[p.flow].dock : { kind: 'probe', id: `${p.flow}:${p.q}` }); }, stepAt: stepping ? stepInput : undefined, charts, bodeFrom, setBodeFrom, ctx, removeChart: id => setCharts(old => old.filter(c => c.id !== id)), cbs, lag, cpb, openSensor: () => { setDock(true); setSelection({ kind: 'sensor', id: '' }); },
    addChart: (c, at) => { setCharts(old => old.some(x => x.id === c.id) ? old : [...old, c]); setPinPos(old => ({ ...old, [c.id]: at })); },
    addBode: (from, to, at) => { const id = `bode-${probeKey(from)}-${probeKey(to)}`; setCharts(old => old.some(c => c.id === id) ? old : [...old, { id, kind: 'bode', from, to }]); setPinPos(old => ({ ...old, [id]: at })); setBodeFrom(null); }, pos: pinPos, setPos: (id, q) => setPinPos(old => ({ ...old, [id]: q })), place: (p, at) => { setPins(old => old.some(same(p)) ? old : [...old, p]); setPinPos(old => ({ ...old, [`pin-${p.flow}:${p.q}`]: at })); }, sense: toggleIn(setSensed) }), [pins, sensed, pinPos, tuning, stepInput, charts, bodeFrom, ctx, cbs, lag, cpb, !!tour]);
  const actions: ProbeActions = { addSens: () => setCharts(old => old.some(c => c.kind === 'sens') ? old.filter(c => c.kind !== 'sens') : [...old, { id: 'sens', kind: 'sens' }]), hasSens: charts.some(c => c.kind === 'sens'), pinned: p => pins.some(same(p)), sensed: p => sensed.some(same(p)), pin: toggleIn(setPins), sense: toggleIn(setSensed), list: sensed, count: pins.length, stepInput, setStepInput };
  const canvasRef = useRef<HTMLDivElement>(null);
  const labelOf = (t: Selection) => !map ? t.id : t.kind === 'flow' ? map.flows.find(f => f.id === t.id)?.label ?? t.id : t.kind === 'signal' ? [...map.disturbances, ...map.outputs].find(o => o.id === t.id)?.label ?? t.id : t.id;
  const openMenu = useCallback((target: Selection, e: React.MouseEvent) => {
    e.preventDefault(); const r = canvasRef.current!.getBoundingClientRect();
    setMenuAt({ x: e.clientX - r.left, y: e.clientY - r.top, target, label: '' });
  }, []);
  useEffect(() => { const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuAt(null); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, []);
  const choose = (role: 'input' | 'output') => {
    if (!menuAt) return; const t = menuAt.target as { kind: Pick['kind']; id: string };
    setTf(old => ({ ...old, [role]: { kind: t.kind, id: t.id, label: labelOf(t) } })); setSelection({ kind: 'tf', id: '' }); setMenuAt(null);
  };
  useEffect(() => { api<MapData>('/model/map').then(setMap).catch(e => setError(e.message)); }, []);
  const at = result ? Math.min(index ?? Math.floor(result.year.length / 2), result.year.length - 1) : 0;
  // Play: the year marker runs through the simulation (about 7 s), so the plots and values unfold in time.
  // A new run starts playing from the first year.
  const [playing, setPlaying] = useState(false);
  useEffect(() => { if (result) { setIndex(0); setPlaying(true); } }, [result]);
  useEffect(() => {
    if (!playing || !result) return;
    const n = result.year.length, t = window.setInterval(() => setIndex(i => { const next = Math.min((i ?? 0) + 2, n - 1); if (next >= n - 1) setPlaying(false); return next; }), 50);
    return () => clearInterval(t);
  }, [playing, result]);
  const togglePlay = () => { if (!result) return; if (!playing && at >= result.year.length - 1) setIndex(0); setPlaying(p => !p); };
  const setView = (next: View) => {
    const opened = next.agents.find(a => !view.agents.includes(a)) ?? (next.controller && !view.controller ? 'controller' : next.cbs && !view.cbs ? 'sensor' : next.cpb && !view.cpb ? 'cpb' : next.finance && !view.finance ? 'finance' : next.system && !view.system ? 'system' : '');
    const parent = (a: string) => CPB_AGENTS.includes(a) ? 'cpb' : a === 'bank' ? 'finance' : 'system';
    const closedAgent = view.agents.find(a => !next.agents.includes(a));
    const closed = closedAgent ? parent(closedAgent) : (view.cpb && !next.cpb) || (view.finance && !next.finance) ? 'system' : '';
    setViewState(next); setFocus(f => ({ id: opened || (next.system ? closed : ''), n: f.n + 1 }));
  };
  const enter = (id: string) => setView(id === 'controller' ? { ...view, controller: true } : { ...view, system: true, cpb: view.cpb || CPB_AGENTS.includes(id), finance: view.finance || id === 'bank', agents: view.agents.includes(id) ? view.agents : [...view.agents, id] });
  if (error) return <div role="alert" className="notice bad">{error}</div>;
  if (!map) return <section className="panel"><p className="muted">Loading the model map…</p></section>;
  return <section className="panel map-panel">
    <div className="map-head"><div className="row">
      <button className="ghost" onClick={() => setFocus(f => ({ id: '', n: f.n + 1 }))}><Maximize2 size={14}/> Whole model</button>
      <button className="ghost" disabled={!view.system && !view.controller} onClick={() => setView(CLOSED)}><Minus size={14}/> Collapse all</button>
      <button className={ident ? 'secondary' : 'ghost'} title="Open loop: poles and step response from the subsidy to the house price, and change the model parameters" onClick={() => { if (ident) { setSelection({ kind: 'none', id: '' }); return; } setDock(true); setSelection({ kind: 'ident', id: '' }); setPins(old => old.some(p => p.flow === 'y_price' && p.q === 's') ? old : [...old, { flow: 'y_price', q: 's' }]); }}><Activity size={14}/> Identify system</button>
      <button className="ghost" data-no-shot title="Save the canvas (and the open side panels) as a high-resolution PNG (3x)" disabled={shooting} onClick={shootCanvas}>{shooting ? <LoaderCircle className="spin" size={14}/> : <Camera size={14}/>} Screenshot canvas</button>
      <label className="label-size" title="Size of block headers, signal names and the Parliament, Tax Authority and CBS blocks">Label size <output>{lab.toFixed(1)}×</output><input type="range" aria-label="Label size" min={1} max={2.5} step={0.1} value={lab} onChange={e => setLab(Number(e.target.value))}/></label>
    </div>
      <div className="segmented small" role="group" aria-label="Feedback"><button className={!scenario.feedback ? 'active' : ''} aria-pressed={!scenario.feedback} onClick={() => setFeedback(false)}>Open loop</button><button className={scenario.feedback ? 'active' : ''} aria-pressed={scenario.feedback} onClick={() => setFeedback(true)}>Closed loop</button></div>
      {result ? <label className="year-slider"><button type="button" className="ghost play" data-no-shot aria-label={playing ? 'Pause' : 'Play through time'} title={playing ? 'Pause' : 'Play: run the plots through time'} onClick={e => { e.preventDefault(); togglePlay(); }}>{playing ? <Pause size={14}/> : <Play size={14}/>}</button>Values in <output>{result.year[at].toFixed(1)}</output><input type="range" aria-label="Year for the values on the map" min={0} max={result.year.length - 1} value={at} onChange={e => { setPlaying(false); setIndex(Number(e.target.value)); }}/></label> : <button className="primary" disabled={busy} onClick={run}>Run to show values</button>}</div>
    <div className="map-body" ref={bodyRef} style={{ gridTemplateColumns: `${left ? (leftOpen ? '290px ' : '34px ') : ''}minmax(0,1fr) ${!dock ? '34px' : selection.kind === 'ident' ? '520px' : selection.kind === 'agent' && selection.id === 'controller' ? '460px' : '340px'}` }}>
      {left && (leftOpen ? <aside className="inspector left-dock"><button className="dock-toggle" aria-label="Collapse scenario panel" title="Collapse" onClick={() => setLeftOpen(false)}><Minus size={14}/></button>{left}</aside>
        : <button className="dock-handle" data-no-shot aria-label="Open scenario panel" title="Open scenario panel" onClick={() => setLeftOpen(true)}><ChevronRight size={16}/><span>Scenario</span></button>)}
      <div className="map-canvas" ref={canvasRef} style={{ ['--lab' as string]: lab }} onClick={() => setMenuAt(null)}><ReactFlowProvider><Canvas map={map} view={view} setView={setView} scenario={scenario} result={result} at={at} selection={selection} select={setSelection} focus={focus} menu={openMenu} flip={() => setFeedback(!scenario.feedback)} probes={probeState} step={stepGain} steps={stepping ? steps : null} lab={lab}/></ReactFlowProvider>
        {menuAt && <div className="ctx-menu" role="menu" style={{ left: menuAt.x, top: menuAt.y }} onClick={e => e.stopPropagation()}>
          <p>{labelOf(menuAt.target)}</p>
          <button role="menuitem" disabled={menuAt.target.kind === 'element' && !/^(I|V)/.test(menuAt.target.id) || (menuAt.target.kind === 'signal' && !menuAt.target.id.startsWith('d_'))} onClick={() => choose('input')}>Use as input</button>
          <button role="menuitem" disabled={menuAt.target.kind === 'signal' && menuAt.target.id.startsWith('d_')} onClick={() => choose('output')}>Use as output</button>
          <button role="menuitem" onClick={() => { setSelection(menuAt.target); setMenuAt(null); }}>Plot over time</button>
          {menuAt.target.kind === 'flow' && map.flows.some(f => f.id === menuAt.target.id && (f.source === 'bank' || f.target === 'bank')) && <button role="menuitem" onClick={() => { update({ bank: !scenario.bank }); setMenuAt(null); }}>{scenario.bank ? 'Close the bank ports (original CPB model)' : 'Reopen the bank ports'}</button>}
        </div>}
        <div className="map-key"><span className="k money">Money port pair</span><span className="k real">Goods port pair</span><span className="k shock">d: shock</span><span className="k policy">u: subsidy</span><span className="muted">f: flow, e: incentive. Click + or a block to open it in place. Right-click two flows for a transfer function.</span></div>
      </div>
      {dock ? <aside className="inspector" aria-live="polite"><button className="dock-toggle" aria-label="Collapse panel" title="Collapse panel" onClick={() => setDock(false)}><Minus size={14}/></button><Inspector map={map} selection={selection} pick={setSelection} result={result} pinned={pinned} scenario={scenario} enter={enter} layer="" tf={tf} setTf={setTf} update={update} probes={actions} design={design} setDesign={setDesign}/></aside>
        : <button className="dock-handle" data-no-shot aria-label="Open panel" title="Open panel" onClick={() => setDock(true)}><ChevronLeft size={16}/><span>Panel</span></button>}
    </div>
  </section>;
}
